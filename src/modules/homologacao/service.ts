import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import { estadoDoRepositorio } from '@/modules/github/model'
import { intervaloDaIntegracao } from '@/modules/github/service'
import {
  ACAO_PARA_PERMISSAO,
  type AcaoDeRegistro,
  MENSAGEM_CORPO,
  MENSAGEM_JUSTIFICATIVA,
  MENSAGEM_RESPOSTA,
  MENSAGEM_TITULO,
  type EstadoItemHomologacao,
  type TipoEventoTimeline,
  transicaoDeHomologacao,
} from './model'
import { obterVersaoCorrenteEmQA } from './versao-corrente'

export interface EntradaDeAcao {
  acao: AcaoDeRegistro
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
  AcaoDeRegistro,
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

function validarTexto(acao: AcaoDeRegistro, bruto: string | null): string | null {
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

export type DecisaoDeTriagem =
  | { tipo: 'reabrir' }
  | {
      tipo: 'criar_correcao'
      titulo: string
      corpo: string
      foraDoEscopo: boolean
      justificativa: string | null
    }
  | { tipo: 'responder'; resposta: string; visibilidade: 'INTERNA' | 'COMPARTILHAVEL' }

const SOLICITACAO_NAO_ENCONTRADA = 'Solicitação não encontrada.'
const SEM_INTEGRACAO =
  'A integração com o GitHub não está configurada; não é possível reabrir nem criar issues agora.'

function justificativaValida(bruta: string | null): string {
  const justificativa = (bruta ?? '').trim()
  if (justificativa.length < 10 || justificativa.length > 1000) {
    throw new ErroDeDominio(MENSAGEM_JUSTIFICATIVA)
  }
  return justificativa
}

// Limites da triagem num só lugar: a action só confere o formato dos campos.
export function validarDecisaoDeTriagem(decisao: DecisaoDeTriagem): DecisaoDeTriagem {
  if (decisao.tipo === 'reabrir') {
    return decisao
  }
  if (decisao.tipo === 'responder') {
    const resposta = decisao.resposta.trim()
    if (resposta.length < 1 || resposta.length > 2000) {
      throw new ErroDeDominio(MENSAGEM_RESPOSTA)
    }
    return { ...decisao, resposta }
  }
  const titulo = decisao.titulo.trim()
  if (titulo.length < 1 || titulo.length > 200) {
    throw new ErroDeDominio(MENSAGEM_TITULO)
  }
  const corpo = decisao.corpo.trim()
  if (corpo.length > 5000) {
    throw new ErroDeDominio(MENSAGEM_CORPO)
  }
  return {
    ...decisao,
    titulo,
    corpo,
    justificativa: decisao.foraDoEscopo ? justificativaValida(decisao.justificativa) : null,
  }
}

async function carregarSolicitacaoParaTriagem(tx: Prisma.TransactionClient, id: string) {
  return tx.solicitacaoDeCorrecao.findUnique({
    where: { id },
    select: {
      id: true,
      estado: true,
      foraDoEscopo: true,
      issueCorrecaoId: true,
      atualizadoEm: true,
      tarefasGitHub: { select: { estado: true } },
      item: {
        select: {
          id: true,
          issueId: true,
          versaoAvaliadaId: true,
          ultimoEventoId: true,
          issue: {
            select: {
              numero: true,
              estado: true,
              repositorioId: true,
              repositorio: { select: { projetoId: true, removidoDaInstalacaoEm: true } },
            },
          },
          homologacao: {
            select: {
              id: true,
              clienteId: true,
              milestoneId: true,
              milestone: { select: { projetoId: true, arquivadaEm: true } },
            },
          },
        },
      },
    },
  })
}

type SolicitacaoParaTriagem = NonNullable<
  Awaited<ReturnType<typeof carregarSolicitacaoParaTriagem>>
>

// Evento de triagem do humano, encadeado no item e gravado como seu último evento.
async function registrarEventoDeTriagem(
  tx: Prisma.TransactionClient,
  s: SolicitacaoParaTriagem,
  e: {
    autorId: string
    texto: string
    visibilidade: 'INTERNA' | 'COMPARTILHAVEL'
    agora: Date
  },
): Promise<void> {
  const evento = await tx.eventoTimeline.create({
    data: {
      clienteId: s.item.homologacao.clienteId,
      milestoneId: s.item.homologacao.milestoneId,
      issueId: s.item.issueId,
      versaoId: s.item.versaoAvaliadaId,
      tipo: 'TRIAGEM',
      visibilidade: e.visibilidade,
      origem: 'HUMANO',
      autorId: e.autorId,
      texto: e.texto,
      eventoAnteriorId: s.item.ultimoEventoId,
      criadoEm: e.agora,
    },
    select: { id: true },
  })
  // Mesma guarda da ação do usuário: se outro evento entrou no item desde a leitura, desfaz tudo.
  const encadeado = await tx.homologacaoItem.updateMany({
    where: { id: s.item.id, ultimoEventoId: s.item.ultimoEventoId },
    data: { ultimoEventoId: evento.id },
  })
  if (encadeado.count === 0) {
    throw new ErroDeDominio(
      'Esta homologação mudou desde que você abriu a página. Confira o estado atual e tente de novo.',
    )
  }
}

async function exigirSolicitacaoDoCliente(
  tx: Prisma.TransactionClient,
  solicitacaoId: string,
  clienteId: string,
): Promise<SolicitacaoParaTriagem> {
  const s = await carregarSolicitacaoParaTriagem(tx, solicitacaoId)
  if (!s || s.item.homologacao.clienteId !== clienteId) {
    throw new ErroDeDominio(SOLICITACAO_NAO_ENCONTRADA)
  }
  if (s.estado === 'RESOLVIDA') {
    throw new ErroDeDominio('Esta solicitação já foi resolvida.')
  }
  return s
}

// Triagem manual (D27, 5b decisão 1): reabrir e criar correção só gravam a tarefa; o worker
// fala com o GitHub. Responder sem tarefa fecha a solicitação na hora.
export async function triarSolicitacao(
  sujeito: Sujeito,
  e: { clienteId: string; solicitacaoId: string; decisao: DecisaoDeTriagem },
  agora: Date = new Date(),
): Promise<{ tarefaId: string | null }> {
  exigirPermissao(sujeito, 'homologacao.triar', { clienteId: e.clienteId })
  const decisao = validarDecisaoDeTriagem(e.decisao)

  return db.$transaction(async (tx) => {
    const s = await exigirSolicitacaoDoCliente(tx, e.solicitacaoId, e.clienteId)
    if (s.estado !== 'ABERTA') {
      throw new ErroDeDominio('Esta solicitação já foi triada.')
    }
    if (s.tarefasGitHub.some((t) => t.estado === 'PENDENTE')) {
      throw new ErroDeDominio('Já existe uma tarefa no GitHub em andamento para esta solicitação.')
    }
    const { homologacao, issue } = s.item
    if (homologacao.milestone.arquivadaEm !== null) {
      throw new ErroDeDominio('Esta milestone está arquivada.')
    }

    // Guarda otimista: duas triagens simultâneas da mesma solicitação não gravam duas tarefas.
    const reivindicada = await tx.solicitacaoDeCorrecao.updateMany({
      where: {
        id: s.id,
        estado: 'ABERTA',
        atualizadoEm: s.atualizadoEm,
      },
      data: {
        triadaEm: agora,
        triadaPorId: sujeito.usuarioId,
        ...(decisao.tipo === 'responder' ? { estado: 'RESPONDIDA_SEM_TAREFA' as const } : {}),
      },
    })
    if (reivindicada.count === 0) {
      throw new ErroDeDominio('Esta solicitação já foi triada.')
    }

    if (decisao.tipo === 'responder') {
      await registrarEventoDeTriagem(tx, s, {
        autorId: sujeito.usuarioId,
        texto: decisao.resposta,
        visibilidade: decisao.visibilidade,
        agora,
      })
      return { tarefaId: null }
    }

    if (decisao.tipo === 'reabrir' && issue.estado === 'ABERTA') {
      throw new ErroDeDominio(
        `A issue #${issue.numero} já está aberta no GitHub; escolha criar uma correção ou responder.`,
      )
    }
    const integracao = await tx.integracaoGitHub.findUnique({
      where: { id: 'github' },
      select: { configurada: true },
    })
    if (
      !integracao?.configurada ||
      issue.repositorio.removidoDaInstalacaoEm !== null ||
      issue.repositorio.projetoId !== homologacao.milestone.projetoId
    ) {
      throw new ErroDeDominio(SEM_INTEGRACAO)
    }

    const tarefaId = randomUUID()
    if (decisao.tipo === 'reabrir') {
      await tx.tarefaGitHub.create({
        data: {
          id: tarefaId,
          tipo: 'REABRIR_ISSUE',
          repositorioId: issue.repositorioId,
          dados: { issueId: s.item.issueId, numero: issue.numero },
          solicitacaoId: s.id,
          solicitadaPorId: sujeito.usuarioId,
        },
      })
      await registrarEventoDeTriagem(tx, s, {
        autorId: sujeito.usuarioId,
        texto: `Triagem: reabrir a issue #${issue.numero} no GitHub.`,
        visibilidade: 'INTERNA',
        agora,
      })
      return { tarefaId }
    }

    const rodape = `Registrada pela Central de Operações (tarefa ${tarefaId}).`
    await tx.tarefaGitHub.create({
      data: {
        id: tarefaId,
        tipo: 'CRIAR_ISSUE',
        repositorioId: issue.repositorioId,
        dados: {
          issueOriginalId: s.item.issueId,
          titulo: decisao.titulo,
          corpo: decisao.corpo === '' ? rodape : `${decisao.corpo}\n\n${rodape}`,
          foraDoEscopo: decisao.foraDoEscopo,
          justificativa: decisao.justificativa,
        },
        solicitacaoId: s.id,
        solicitadaPorId: sujeito.usuarioId,
      },
    })
    await registrarEventoDeTriagem(tx, s, {
      autorId: sujeito.usuarioId,
      texto:
        'Triagem: criar issue de correção vinculada.' +
        (decisao.foraDoEscopo ? ` Fora do escopo desta milestone: ${decisao.justificativa}` : ''),
      visibilidade: 'INTERNA',
      agora,
    })
    return { tarefaId }
  })
}

// Classificar como fora do escopo tira a correção da lista de bloqueadoras (D22).
export async function reclassificarSolicitacao(
  sujeito: Sujeito,
  e: { clienteId: string; solicitacaoId: string; justificativa: string },
  agora: Date = new Date(),
): Promise<void> {
  exigirPermissao(sujeito, 'homologacao.triar', { clienteId: e.clienteId })
  const justificativa = justificativaValida(e.justificativa)

  await db.$transaction(async (tx) => {
    const s = await exigirSolicitacaoDoCliente(tx, e.solicitacaoId, e.clienteId)
    if (s.foraDoEscopo) {
      throw new ErroDeDominio('Esta correção já está classificada como fora do escopo.')
    }
    const atualizada = await tx.solicitacaoDeCorrecao.updateMany({
      where: { id: s.id, foraDoEscopo: false, estado: { not: 'RESOLVIDA' } },
      data: { foraDoEscopo: true, justificativa },
    })
    if (atualizada.count === 0) {
      throw new ErroDeDominio('Esta solicitação mudou. Recarregue a página.')
    }
    if (s.issueCorrecaoId) {
      await tx.milestoneIssue.updateMany({
        where: { milestoneId: s.item.homologacao.milestoneId, issueId: s.issueCorrecaoId },
        data: { foraDoEscopo: true, justificativaForaDoEscopo: justificativa },
      })
    }
    await registrarEventoDeTriagem(tx, s, {
      autorId: sujeito.usuarioId,
      texto: `Correção classificada como fora do escopo: ${justificativa}`,
      visibilidade: 'INTERNA',
      agora,
    })
  })
}
