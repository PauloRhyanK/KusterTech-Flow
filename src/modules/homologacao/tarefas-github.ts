import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { criarVinculoDeCorrecao } from '@/modules/entregas/service'
import { ErroDeIntegracao } from '@/modules/github/erros'
import type { FonteGitHub, RefRepositorio } from '@/modules/github/fonte'
import { resumirErroParaLog, type CategoriaDeFalha } from '@/modules/github/model'
import { destinoDaFalhaDaTarefa, MENSAGEM_RESULTADO_INCERTO } from './model'

const LIMITE_POR_CICLO = 20
const PRESA_APOS_MS = 10 * 60_000
const TEXTO_FALHA = 'Não foi possível concluir a tarefa no GitHub.'

const dadosReabrir = z.object({ issueId: z.string(), numero: z.number().int() })
const dadosCriar = z.object({
  issueOriginalId: z.string(),
  titulo: z.string(),
  corpo: z.string(),
  foraDoEscopo: z.boolean().default(false),
  justificativa: z.string().nullish(),
})

type Resultado = { numero: number; githubId: string; urlHtml: string }

type Tarefa = NonNullable<Awaited<ReturnType<typeof carregar>>>
type Placar = { concluidas: number; adiadas: number; falhas: number }

function carregar(id: string) {
  return db.tarefaGitHub.findUnique({
    where: { id },
    include: {
      repositorio: { select: { githubId: true, instalacaoId: true, nomeCompleto: true } },
      solicitacao: {
        select: {
          id: true,
          item: {
            select: {
              id: true,
              issueId: true,
              versaoAvaliadaId: true,
              ultimoEventoId: true,
              homologacao: { select: { clienteId: true, milestoneId: true } },
            },
          },
        },
      },
    },
  })
}

// O evento de triagem do sistema encadeia no item da solicitação e vira o seu último evento.
async function registrarEvento(
  tx: Prisma.TransactionClient,
  tarefa: Tarefa,
  texto: string,
  agora: Date,
): Promise<void> {
  const item = tarefa.solicitacao?.item
  if (!item) return
  const evento = await tx.eventoTimeline.create({
    data: {
      clienteId: item.homologacao.clienteId,
      milestoneId: item.homologacao.milestoneId,
      issueId: item.issueId,
      versaoId: item.versaoAvaliadaId,
      tipo: 'TRIAGEM',
      visibilidade: 'INTERNA',
      origem: 'SISTEMA',
      texto,
      eventoAnteriorId: item.ultimoEventoId,
      criadoEm: agora,
    },
    select: { id: true },
  })
  await tx.homologacaoItem.update({ where: { id: item.id }, data: { ultimoEventoId: evento.id } })
}

async function concluir(tarefa: Tarefa, resultado: Resultado, agora: Date): Promise<void> {
  await db.$transaction(async (tx) => {
    let issueId: string
    if (tarefa.tipo === 'REABRIR_ISSUE') {
      const dados = dadosReabrir.parse(tarefa.dados)
      await tx.issueGitHub.update({
        where: { id: dados.issueId },
        data: {
          estado: 'ABERTA',
          fechadaNoGitHub: null,
          atualizadaNoGitHub: agora,
          sincronizadaEm: agora,
        },
      })
      issueId = dados.issueId
    } else {
      const dados = dadosCriar.parse(tarefa.dados)
      const githubId = BigInt(resultado.githubId)
      const dadosDaIssue = {
        repositorioId: tarefa.repositorioId,
        numero: resultado.numero,
        titulo: dados.titulo,
        corpo: dados.corpo,
        estado: 'ABERTA' as const,
        autor: null,
        urlHtml: resultado.urlHtml,
        criadaNoGitHub: agora,
        atualizadaNoGitHub: agora,
        fechadaNoGitHub: null,
        sincronizadaEm: agora,
      }
      const criada = await tx.issueGitHub.upsert({
        where: { githubId },
        create: { githubId, ...dadosDaIssue },
        update: dadosDaIssue,
        select: { id: true },
      })
      issueId = criada.id
      await criarVinculoDeCorrecao(tx, {
        issueOriginalId: dados.issueOriginalId,
        issueCorrecaoId: criada.id,
        criadoPorId: tarefa.solicitadaPorId,
      })
      if (dados.foraDoEscopo && tarefa.solicitacao) {
        const milestoneId = tarefa.solicitacao.item.homologacao.milestoneId
        await tx.milestoneIssue.updateMany({
          where: { milestoneId, issueId: criada.id },
          data: { foraDoEscopo: true, justificativaForaDoEscopo: dados.justificativa ?? null },
        })
        await tx.solicitacaoDeCorrecao.update({
          where: { id: tarefa.solicitacao.id },
          data: { foraDoEscopo: true, justificativa: dados.justificativa ?? null },
        })
      }
    }

    await tx.tarefaGitHub.update({
      where: { id: tarefa.id },
      data: {
        estado: 'CONCLUIDA',
        resultado,
        concluidaEm: agora,
        iniciadaEm: null,
        proximaTentativaEm: null,
      },
    })
    if (tarefa.solicitacao) {
      await tx.solicitacaoDeCorrecao.update({
        where: { id: tarefa.solicitacao.id },
        data:
          tarefa.tipo === 'REABRIR_ISSUE'
            ? { estado: 'REABERTA_NO_GITHUB' }
            : { estado: 'CORRECAO_CRIADA', issueCorrecaoId: issueId },
      })
    }
    await registrarEvento(
      tx,
      tarefa,
      tarefa.tipo === 'REABRIR_ISSUE'
        ? `Issue #${resultado.numero} reaberta no GitHub.`
        : `Issue de correção #${resultado.numero} criada no GitHub.`,
      agora,
    )
  })
}

async function falhar(
  tarefa: Tarefa,
  destino: ReturnType<typeof destinoDaFalhaDaTarefa>,
  agora: Date,
): Promise<void> {
  await db.$transaction(async (tx) => {
    if (destino.estado === 'PENDENTE') {
      await tx.tarefaGitHub.update({
        where: { id: tarefa.id },
        data: {
          estado: 'PENDENTE',
          iniciadaEm: null,
          proximaTentativaEm: destino.proximaTentativaEm,
        },
      })
      return
    }
    await tx.tarefaGitHub.update({
      where: { id: tarefa.id },
      data: {
        estado: 'FALHOU',
        falhaMotivo: destino.motivo,
        concluidaEm: agora,
        iniciadaEm: null,
        proximaTentativaEm: null,
      },
    })
    await registrarEvento(tx, tarefa, TEXTO_FALHA, agora)
  })
}

async function recuperarPresas(agora: Date, placar: Placar): Promise<void> {
  const presas = await db.tarefaGitHub.findMany({
    where: {
      estado: 'PENDENTE',
      iniciadaEm: { lt: new Date(agora.getTime() - PRESA_APOS_MS) },
    },
    select: { id: true, tipo: true },
  })
  for (const { id, tipo } of presas) {
    const tarefa = await carregar(id)
    if (!tarefa) continue
    if (tipo === 'REABRIR_ISSUE') {
      // Reabrir é idempotente: pode ser repetida.
      await db.tarefaGitHub.updateMany({
        where: { id, estado: 'PENDENTE', iniciadaEm: { not: null } },
        data: { iniciadaEm: null },
      })
    } else {
      // Não se sabe se o GitHub criou a issue: nunca repete.
      await falhar(tarefa, { estado: 'FALHOU', motivo: MENSAGEM_RESULTADO_INCERTO }, agora)
      placar.falhas += 1
    }
  }
}

async function executar(
  fonte: FonteGitHub,
  tarefa: Tarefa,
  agora: Date,
  placar: Placar,
): Promise<void> {
  const repo: RefRepositorio = tarefa.repositorio
  try {
    let resultado: Resultado
    if (tarefa.tipo === 'REABRIR_ISSUE') {
      const { numero } = dadosReabrir.parse(tarefa.dados)
      const issue = await fonte.reabrirIssue(repo, numero)
      resultado = {
        numero: issue.numero,
        githubId: String(issue.githubId),
        urlHtml: issue.urlHtml,
      }
    } else {
      const dados = dadosCriar.parse(tarefa.dados)
      const criada = await fonte.criarIssue(repo, { titulo: dados.titulo, corpo: dados.corpo })
      resultado = {
        numero: criada.numero,
        githubId: String(criada.githubId),
        urlHtml: criada.urlHtml,
      }
    }
    await concluir(tarefa, resultado, agora)
    placar.concluidas += 1
  } catch (erro) {
    const integracao = erro instanceof ErroDeIntegracao ? erro : null
    const categoria: CategoriaDeFalha = integracao?.categoria ?? 'desconhecida'
    log.warn(
      { tarefa: 'executar-tarefas-github', tarefaId: tarefa.id, erro: resumirErroParaLog(erro) },
      'tarefa no GitHub falhou',
    )
    // `tentativas` já inclui esta execução (gravada ao reivindicar).
    const destino = destinoDaFalhaDaTarefa(
      tarefa.tipo,
      categoria,
      tarefa.tentativas,
      integracao?.tentarApos,
      agora,
    )
    await falhar(tarefa, destino, agora)
    if (destino.estado === 'PENDENTE') placar.adiadas += 1
    else placar.falhas += 1
  }
}

// Só o worker escreve no GitHub (decisão 4 do plano mestre). No máximo uma vez por criação.
export async function executarTarefasGitHub(
  fonte: FonteGitHub | null,
  agora: Date,
): Promise<Placar> {
  const placar: Placar = { concluidas: 0, adiadas: 0, falhas: 0 }
  if (!fonte) return placar

  await recuperarPresas(agora, placar)

  const candidatas = await db.tarefaGitHub.findMany({
    where: {
      estado: 'PENDENTE',
      iniciadaEm: null,
      OR: [{ proximaTentativaEm: null }, { proximaTentativaEm: { lte: agora } }],
    },
    orderBy: { criadaEm: 'asc' },
    take: LIMITE_POR_CICLO,
    select: { id: true },
  })

  for (const { id } of candidatas) {
    // Reivindicar antes de falar com o GitHub: outro ciclo não pega a mesma tarefa.
    const { count } = await db.tarefaGitHub.updateMany({
      where: { id, estado: 'PENDENTE', iniciadaEm: null },
      data: { iniciadaEm: agora, tentativas: { increment: 1 } },
    })
    if (count === 0) continue
    const tarefa = await carregar(id)
    if (!tarefa) continue
    await executar(fonte, tarefa, agora, placar)
  }
  return placar
}
