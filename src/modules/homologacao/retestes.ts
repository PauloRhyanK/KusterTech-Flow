import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { resumirErroParaLog } from '@/modules/github/model'
import {
  detectarReteste,
  PRESENCAS_QUE_LIBERAM,
  type CorrecaoAcompanhada,
  type PresencaEmQa,
} from './model'

export class ItemMudou extends Error {
  constructor() {
    super('O item mudou desde a leitura.')
  }
}

interface ItemParaReteste {
  id: string
  issueId: string
  ultimoEventoId: string | null
  homologacao: { clienteId: string; milestoneId: string }
}

// Efeito comum do reteste, detectado ou confirmado (5b, decisões 2 e 4): estado, versão avaliada,
// evento e solicitações na mesma transação. Devolve falso quando o item mudou desde a leitura.
export async function aplicarReteste(
  tx: Prisma.TransactionClient,
  e: {
    item: ItemParaReteste
    versaoId: string
    solicitacoesResolvidas: readonly string[]
    evento: {
      tipo: 'RETESTE_DETECTADO' | 'RETESTE_CONFIRMADO'
      origem: 'SISTEMA' | 'HUMANO'
      autorId: string | null
      texto: string
    }
    agora: Date
  },
): Promise<boolean> {
  const { item } = e
  const evento = await tx.eventoTimeline.create({
    data: {
      clienteId: item.homologacao.clienteId,
      milestoneId: item.homologacao.milestoneId,
      issueId: item.issueId,
      versaoId: e.versaoId,
      tipo: e.evento.tipo,
      visibilidade: 'COMPARTILHAVEL',
      origem: e.evento.origem,
      autorId: e.evento.autorId,
      texto: e.evento.texto,
      estadoAnterior: 'CORRECAO_SOLICITADA',
      estadoNovo: 'AGUARDANDO_RETESTE',
      eventoAnteriorId: item.ultimoEventoId,
      criadoEm: e.agora,
    },
    select: { id: true },
  })
  const atualizados = await tx.homologacaoItem.updateMany({
    where: { id: item.id, estado: 'CORRECAO_SOLICITADA', ultimoEventoId: item.ultimoEventoId },
    data: {
      estado: 'AGUARDANDO_RETESTE',
      versaoAvaliadaId: e.versaoId,
      ultimoEventoId: evento.id,
    },
  })
  if (atualizados.count === 0) {
    // Desfaz o evento: o item mudou entre a leitura e a escrita.
    throw new ItemMudou()
  }
  if (e.solicitacoesResolvidas.length > 0) {
    await tx.solicitacaoDeCorrecao.updateMany({
      where: { id: { in: [...e.solicitacoesResolvidas] }, estado: { not: 'RESOLVIDA' } },
      data: { estado: 'RESOLVIDA', resolvidaEm: e.agora, versaoDaResolucaoId: e.versaoId },
    })
  }
  await tx.homologacao.updateMany({
    where: { clienteId: item.homologacao.clienteId, milestoneId: item.homologacao.milestoneId },
    data: { atualizadoEm: e.agora },
  })
  return true
}

function textoDoReteste(
  correcoes: readonly { numero: number; reaberta: boolean }[],
  rotulo: string,
  manual: boolean,
): string {
  const sufixo = manual ? ' Presença confirmada manualmente.' : ''
  if (correcoes.length === 1) {
    const { numero, reaberta } = correcoes[0]!
    const inicio = reaberta ? `Issue #${numero} corrigida e` : `Correção #${numero}`
    return `${inicio} presente em QA na versão ${rotulo}; aguardando reteste.${sufixo}`
  }
  const numeros = correcoes.map((c) => `#${c.numero}`)
  const lista = `${numeros.slice(0, -1).join(', ')} e ${numeros.at(-1)}`
  return `Correções ${lista} presentes em QA na versão ${rotulo}; aguardando reteste.${sufixo}`
}

// Detecção automática (5b, decisão 3): só olha itens com correção solicitada e só muda o item do
// cliente afetado. Falha de um item não impede os demais.
export async function detectarRetestes(
  agora: Date,
): Promise<{ avaliados: number; retestes: number }> {
  const itens = await db.homologacaoItem.findMany({
    where: { estado: 'CORRECAO_SOLICITADA' },
    select: {
      id: true,
      issueId: true,
      estado: true,
      versaoAvaliadaId: true,
      ultimoEventoId: true,
      homologacao: {
        select: {
          clienteId: true,
          milestoneId: true,
          milestone: { select: { projetoId: true } },
        },
      },
      solicitacoes: {
        orderBy: { criadoEm: 'asc' },
        select: {
          id: true,
          estado: true,
          issueCorrecao: {
            select: { id: true, numero: true, estado: true, fechadaNoGitHub: true },
          },
          tarefasGitHub: {
            where: { estado: 'CONCLUIDA' },
            orderBy: { concluidaEm: 'desc' },
            take: 1,
            select: { concluidaEm: true },
          },
        },
      },
      issue: { select: { numero: true, estado: true, fechadaNoGitHub: true } },
    },
  })

  let retestes = 0
  for (const item of itens) {
    try {
      const alvos = item.solicitacoes.map((s) => {
        const reaberta = s.estado === 'REABERTA_NO_GITHUB'
        const issue =
          s.estado === 'CORRECAO_CRIADA' && s.issueCorrecao
            ? s.issueCorrecao
            : reaberta
              ? { id: item.issueId, ...item.issue }
              : null
        return { s, issue, reaberta }
      })
      const correcoes: CorrecaoAcompanhada[] = alvos.map(({ s, issue }) => ({
        solicitacaoId: s.id,
        estado: s.estado,
        issueAlvoId: issue?.id ?? null,
        liberadaEm: s.tarefasGitHub[0]?.concluidaEm ?? null,
        issueAlvoFechadaEm: issue?.estado === 'FECHADA' ? issue.fechadaNoGitHub : null,
      }))

      const alvoIds = [...new Set(correcoes.flatMap((c) => (c.issueAlvoId ? [c.issueAlvoId] : [])))]
      const presencasEmQa = await presencasEmQaDas(item.homologacao.milestone.projetoId, alvoIds)

      const resultado = detectarReteste({
        estadoDoItem: item.estado,
        versaoAvaliadaId: item.versaoAvaliadaId,
        correcoes,
        presencasEmQa,
      })
      if (!resultado.reteste) continue

      const versao = await db.versao.findUniqueOrThrow({
        where: { id: resultado.versaoId },
        select: { rotulo: true },
      })
      const usadas = alvos.filter(({ s }) => resultado.solicitacoesResolvidas.includes(s.id))
      const texto = textoDoReteste(
        usadas.flatMap(({ issue, reaberta }) =>
          issue ? [{ numero: issue.numero, reaberta }] : [],
        ),
        versao.rotulo,
        resultado.origem === 'presenca-manual',
      )
      await db.$transaction((tx) =>
        aplicarReteste(tx, {
          item,
          versaoId: resultado.versaoId,
          solicitacoesResolvidas: resultado.solicitacoesResolvidas,
          evento: { tipo: 'RETESTE_DETECTADO', origem: 'SISTEMA', autorId: null, texto },
          agora,
        }),
      )
      retestes += 1
    } catch (erro) {
      if (erro instanceof ItemMudou) continue
      log.error(
        { tarefa: 'detectar-retestes', itemId: item.id, erro: resumirErroParaLog(erro) },
        'falha ao detectar reteste de um item',
      )
    }
  }
  return { avaliados: itens.length, retestes }
}

// Presença das issues-alvo em versões com evidência SUCESSO no QA do projeto; `implantadaEm` é a
// menor `ocorridaEm` dessas evidências (base §3.7, item 2).
async function presencasEmQaDas(
  projetoId: string,
  issueIds: readonly string[],
): Promise<PresencaEmQa[]> {
  if (issueIds.length === 0) return []
  const presencas = await db.presencaIssueVersao.findMany({
    where: {
      issueId: { in: [...issueIds] },
      estado: { in: [...PRESENCAS_QUE_LIBERAM] },
      versao: {
        projetoId,
        evidencias: { some: { situacao: 'SUCESSO', ambiente: { projetoId, tipo: 'QA' } } },
      },
    },
    select: {
      issueId: true,
      versaoId: true,
      estado: true,
      versao: {
        select: {
          evidencias: {
            where: { situacao: 'SUCESSO', ambiente: { projetoId, tipo: 'QA' } },
            select: { ocorridaEm: true },
          },
        },
      },
    },
  })
  return presencas.map((p) => ({
    issueId: p.issueId,
    versaoId: p.versaoId,
    estado: p.estado,
    implantadaEm: new Date(Math.min(...p.versao.evidencias.map((e) => e.ocorridaEm.getTime()))),
  }))
}
