import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import { estadoDoRepositorio } from '@/modules/github/model'
import { intervaloDaIntegracao } from '@/modules/github/service'
import {
  ACAO_PARA_PERMISSAO,
  type AcaoDeHomologacao,
  type EstadoItemHomologacao,
  type TipoEventoTimeline,
  transicaoDeHomologacao,
} from './model'
import { obterVersaoCorrenteEmQA } from './versao-corrente'

export interface EntradaDeAcao {
  acao: AcaoDeHomologacao
  itemId: string
  clienteId: string
  milestoneId: string
  issueId: string
  versaoId: string | null
  ultimoEventoId: string | null
  texto: string | null
  visibilidade: 'INTERNA' | 'COMPARTILHAVEL'
}

const NAO_ENCONTRADA = 'Homologação não encontrada.'
const LIMITE_DO_TEXTO = 4000

const TIPO_DO_EVENTO: Record<
  AcaoDeHomologacao,
  Extract<
    TipoEventoTimeline,
    'DISPONIBILIZACAO' | 'APROVACAO' | 'SOLICITACAO_CORRECAO' | 'COMENTARIO'
  >
> = {
  DISPONIBILIZAR: 'DISPONIBILIZACAO',
  APROVAR: 'APROVACAO',
  SOLICITAR_CORRECAO: 'SOLICITACAO_CORRECAO',
  COMENTAR: 'COMENTARIO',
}

function validarTexto(acao: AcaoDeHomologacao, bruto: string | null): string | null {
  const texto = (bruto ?? '').trim()
  if (acao === 'COMENTAR') {
    if (texto.length < 1 || texto.length > LIMITE_DO_TEXTO) {
      throw new ErroDeDominio('Escreva o comentário.')
    }
  } else if (acao === 'SOLICITAR_CORRECAO') {
    if (texto.length < 10 || texto.length > LIMITE_DO_TEXTO) {
      throw new ErroDeDominio('Descreva a correção com pelo menos 10 caracteres.')
    }
  } else if (texto.length > LIMITE_DO_TEXTO) {
    throw new ErroDeDominio('O texto pode ter até 4000 caracteres.')
  }
  return texto === '' ? null : texto
}

// Única escrita de homologação vinda da web. Estado e evento nascem na mesma transação
// (invariante 4); a autorização usa o cliente do item gravado no banco, nunca o do formulário.
export async function registrarAcaoDeHomologacao(
  sujeito: Sujeito,
  e: EntradaDeAcao,
  agora: Date = new Date(),
): Promise<{ eventoId: string; novoEstado: EstadoItemHomologacao; clienteNome: string }> {
  const item = await db.homologacaoItem.findUnique({
    where: { id: e.itemId },
    select: {
      id: true,
      estado: true,
      issueId: true,
      ultimoEventoId: true,
      homologacao: {
        select: {
          id: true,
          clienteId: true,
          milestoneId: true,
          cliente: { select: { nome: true } },
          milestone: { select: { projetoId: true, arquivadaEm: true } },
        },
      },
      issue: {
        select: {
          repositorioId: true,
          repositorio: {
            select: { sincronizadoEm: true, ultimaFalhaEm: true, removidoDaInstalacaoEm: true },
          },
        },
      },
    },
  })
  if (!item) {
    throw new ErroDeDominio(NAO_ENCONTRADA)
  }
  const { homologacao } = item

  exigirPermissao(sujeito, ACAO_PARA_PERMISSAO[e.acao], { clienteId: homologacao.clienteId })

  const escopado = !podeVerVisaoGlobal(sujeito)
  if (escopado && item.estado === 'AGUARDANDO_DISPONIBILIZACAO') {
    throw new ErroDeDominio(NAO_ENCONTRADA)
  }

  if (
    e.clienteId !== homologacao.clienteId ||
    e.milestoneId !== homologacao.milestoneId ||
    e.issueId !== item.issueId
  ) {
    throw new ErroDeDominio('Os dados da ação não conferem com a homologação. Recarregue a página.')
  }

  const associado = await db.milestoneCliente.findUnique({
    where: {
      milestoneId_clienteId: {
        milestoneId: homologacao.milestoneId,
        clienteId: homologacao.clienteId,
      },
    },
    select: { milestoneId: true },
  })
  if (!associado || homologacao.milestone.arquivadaEm !== null) {
    throw new ErroDeDominio('Este cliente não está mais associado a esta milestone.')
  }

  const texto = validarTexto(e.acao, e.texto)

  const repositorioId = item.issue.repositorioId
  const corrente = await obterVersaoCorrenteEmQA(homologacao.milestone.projetoId, repositorioId)
  const presenca = corrente
    ? await db.presencaIssueVersao.findUnique({
        where: { issueId_versaoId: { issueId: item.issueId, versaoId: corrente.id } },
        select: { estado: true },
      })
    : null

  const transicao = transicaoDeHomologacao(item.estado, e.acao, {
    presencaNaVersaoAtual: presenca?.estado ?? null,
    versaoAtualId: corrente?.id ?? null,
    versaoInformadaId: e.versaoId,
    ultimoEventoAtualId: item.ultimoEventoId,
    ultimoEventoInformadoId: e.ultimoEventoId,
    integracaoIndisponivel:
      estadoDoRepositorio(item.issue.repositorio, agora, intervaloDaIntegracao()) ===
      'indisponivel',
  })
  if ('recusa' in transicao) {
    throw new ErroDeDominio(transicao.recusa)
  }
  const { novoEstado } = transicao
  const mudaEstado = e.acao !== 'COMENTAR'

  let versaoDoEventoId = corrente?.id ?? null
  if (!mudaEstado && e.versaoId) {
    const informada = await db.versao.findUnique({
      where: { id: e.versaoId },
      select: { repositorioId: true },
    })
    if (informada?.repositorioId === repositorioId) {
      versaoDoEventoId = e.versaoId
    }
  }

  // Só o comentário de quem tem visão global escolhe a visibilidade; o resto é compartilhável.
  const visibilidade = e.acao === 'COMENTAR' && !escopado ? e.visibilidade : 'COMPARTILHAVEL'

  const eventoId = await db.$transaction(async (tx) => {
    const evento = await tx.eventoTimeline.create({
      data: {
        clienteId: homologacao.clienteId,
        milestoneId: homologacao.milestoneId,
        issueId: item.issueId,
        versaoId: versaoDoEventoId,
        tipo: TIPO_DO_EVENTO[e.acao],
        visibilidade,
        origem: 'HUMANO',
        autorId: sujeito.usuarioId,
        texto,
        estadoAnterior: mudaEstado ? item.estado : null,
        estadoNovo: mudaEstado ? novoEstado : null,
        eventoAnteriorId: item.ultimoEventoId,
        criadoEm: agora,
      },
      select: { id: true },
    })

    if (mudaEstado) {
      const atualizados = await tx.homologacaoItem.updateMany({
        where: { id: item.id, ultimoEventoId: item.ultimoEventoId },
        data: {
          estado: novoEstado,
          ultimoEventoId: evento.id,
          versaoAvaliadaId: corrente?.id ?? null,
        },
      })
      if (atualizados.count === 0) {
        throw new ErroDeDominio(
          'Esta homologação mudou desde que você abriu a página. Confira o estado atual e tente de novo.',
        )
      }
    }
    if (e.acao === 'SOLICITAR_CORRECAO') {
      await tx.solicitacaoDeCorrecao.create({
        data: { itemId: item.id, eventoId: evento.id },
      })
    }
    await tx.homologacao.update({
      where: { id: homologacao.id },
      data: { atualizadoEm: agora },
    })
    return evento.id
  })

  return { eventoId, novoEstado, clienteNome: homologacao.cliente.nome }
}
