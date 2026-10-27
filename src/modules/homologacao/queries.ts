import { autorizar, exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import type { EventoDaTimeline } from '@/lib/ui/timeline'
import type { EstadoImplantacao } from '@/modules/ambientes/model'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import { estadoDoRepositorio } from '@/modules/github/model'
import { exigirLeituraGlobal, intervaloDaIntegracao } from '@/modules/github/service'
import {
  ACAO_PARA_PERMISSAO,
  type AcaoDeHomologacao,
  apresentarEstadoDoItem,
  type EstadoItemHomologacao,
  tituloDoEvento,
  transicaoDeHomologacao,
} from './model'
import { obterVersaoCorrenteEmQA } from './versao-corrente'

export type SituacaoDaHomologacaoDaIssue =
  | 'sem-ambiente-qa'
  | 'fora-de-milestone'
  | 'escolher-milestone'
  | 'fora-da-fila'
  | 'aguardando-disponibilizacao-oculta'
  | 'com-item'

export interface HomologacaoDaIssue {
  cliente: { id: string; nome: string }
  milestones: { id: string; titulo: string }[]
  milestone: { id: string; titulo: string } | null
  situacao: SituacaoDaHomologacaoDaIssue
  versaoCorrente: { id: string; rotulo: string } | null
  presenca: EstadoImplantacao | null
  item: {
    id: string
    estado: EstadoItemHomologacao
    ultimoEventoId: string | null
    versaoAvaliada: { id: string; rotulo: string } | null
  } | null
  eventos: EventoDaTimeline[]
  acoes: { acao: AcaoDeHomologacao; disponivel: true }[]
  recusa: string | null
  podeEscolherVisibilidade: boolean
}

// Ordem fixa das ações na resposta.
const ORDEM_DAS_ACOES: readonly AcaoDeHomologacao[] = [
  'DISPONIBILIZAR',
  'APROVAR',
  'SOLICITAR_CORRECAO',
  'COMENTAR',
]

function hrefDaIssueNoCliente(
  clienteId: string,
  projetoId: string,
  issueId: string,
  milestoneId: string,
): string {
  return `/clientes/${clienteId}/projetos/${projetoId}/entregas/issues/${issueId}?milestone=${milestoneId}`
}

function vazia(): Pick<
  HomologacaoDaIssue,
  'versaoCorrente' | 'presenca' | 'item' | 'eventos' | 'acoes' | 'recusa'
> {
  return { versaoCorrente: null, presenca: null, item: null, eventos: [], acoes: [], recusa: null }
}

// Milestones em que a issue é homologada pelo cliente: ativas, associadas a ele e com a issue
// dentro do escopo (a entrada na fila ignora `foraDoEscopo`, decisão 2 do 5a).
async function milestonesDaIssueNoCliente(
  projetoId: string,
  issueId: string,
  clienteId: string,
): Promise<{ id: string; titulo: string }[]> {
  const vinculos = await db.milestoneIssue.findMany({
    where: {
      issueId,
      foraDoEscopo: false,
      milestone: { projetoId, arquivadaEm: null, clientes: { some: { clienteId } } },
    },
    select: { milestone: { select: { id: true, titulo: true, tituloNormalizado: true } } },
  })
  return vinculos
    .map((v) => v.milestone)
    .sort((a, b) => a.tituloNormalizado.localeCompare(b.tituloNormalizado, 'pt-BR'))
    .map(({ id, titulo }) => ({ id, titulo }))
}

export async function obterHomologacaoDaIssue(
  sujeito: Sujeito,
  entrada: { clienteId: string; projetoId: string; issueId: string; milestoneId: string | null },
): Promise<HomologacaoDaIssue> {
  const { clienteId, projetoId, issueId } = entrada
  exigirPermissao(sujeito, 'clientes.ler', { clienteId })

  const associado = await db.projetoCliente.findUnique({
    where: { projetoId_clienteId: { projetoId, clienteId } },
    select: { cliente: { select: { id: true, nome: true } } },
  })
  if (!associado) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }
  const cliente = associado.cliente

  const issue = await db.issueGitHub.findFirst({
    where: { id: issueId, repositorio: { projetoId } },
    select: {
      id: true,
      repositorioId: true,
      repositorio: {
        select: { sincronizadoEm: true, ultimaFalhaEm: true, removidoDaInstalacaoEm: true },
      },
    },
  })
  if (!issue) {
    throw new ErroDeDominio('Issue não encontrada.')
  }

  const escopado = !podeVerVisaoGlobal(sujeito)
  const base = { cliente, podeEscolherVisibilidade: !escopado }

  const ambienteQa = await db.ambiente.findUnique({
    where: { projetoId_tipo: { projetoId, tipo: 'QA' } },
    select: { id: true },
  })
  if (!ambienteQa) {
    return { ...base, ...vazia(), milestones: [], milestone: null, situacao: 'sem-ambiente-qa' }
  }

  const milestones = await milestonesDaIssueNoCliente(projetoId, issueId, clienteId)
  if (milestones.length === 0) {
    return { ...base, ...vazia(), milestones, milestone: null, situacao: 'fora-de-milestone' }
  }

  // Milestone do parâmetro só vale se for uma das do cliente; sem ela, uma única milestone é a escolhida.
  const milestone =
    milestones.find((m) => m.id === entrada.milestoneId) ??
    (milestones.length === 1 ? milestones[0]! : null)
  if (!milestone) {
    return { ...base, ...vazia(), milestones, milestone: null, situacao: 'escolher-milestone' }
  }

  const versaoCorrente = await obterVersaoCorrenteEmQA(projetoId, issue.repositorioId)
  const presenca = versaoCorrente
    ? ((
        await db.presencaIssueVersao.findUnique({
          where: { issueId_versaoId: { issueId, versaoId: versaoCorrente.id } },
          select: { estado: true },
        })
      )?.estado ?? null)
    : null
  const resumo = { ...base, milestones, milestone, versaoCorrente, presenca }

  const item = await db.homologacaoItem.findFirst({
    where: { issueId, homologacao: { clienteId, milestoneId: milestone.id } },
    select: {
      id: true,
      estado: true,
      ultimoEventoId: true,
      versaoAvaliada: { select: { id: true, rotulo: true } },
    },
  })
  if (!item) {
    return { ...resumo, ...vazia(), versaoCorrente, presenca, situacao: 'fora-da-fila' }
  }
  if (escopado && item.estado === 'AGUARDANDO_DISPONIBILIZACAO') {
    return {
      ...resumo,
      ...vazia(),
      versaoCorrente,
      presenca,
      situacao: 'aguardando-disponibilizacao-oculta',
    }
  }

  const registros = await db.eventoTimeline.findMany({
    where: {
      clienteId,
      milestoneId: milestone.id,
      issueId,
      ...(escopado ? { visibilidade: 'COMPARTILHAVEL' } : {}),
    },
    orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      tipo: true,
      origem: true,
      visibilidade: true,
      texto: true,
      estadoNovo: true,
      criadoEm: true,
      autor: { select: { nome: true } },
      versao: { select: { id: true, rotulo: true } },
    },
  })
  const eventos = registros.map<EventoDaTimeline>((e) => ({
    id: e.id,
    titulo: tituloDoEvento(e.tipo),
    origem: e.origem === 'SISTEMA' ? 'sistema' : 'humano',
    autor: e.autor?.nome ?? null,
    quando: e.criadoEm,
    versao: e.versao,
    visibilidade: e.visibilidade === 'INTERNA' ? 'interna' : 'compartilhavel',
    texto: e.texto,
    estado: e.estadoNovo ? apresentarEstadoDoItem(e.estadoNovo) : undefined,
  }))

  // A tela abre com o estado atual, então os "informados" da transição são os atuais; o
  // service revalida de verdade no envio.
  const contexto = {
    presencaNaVersaoAtual: presenca,
    versaoAtualId: versaoCorrente?.id ?? null,
    versaoInformadaId: versaoCorrente?.id ?? null,
    ultimoEventoAtualId: item.ultimoEventoId,
    ultimoEventoInformadoId: item.ultimoEventoId,
    integracaoIndisponivel:
      estadoDoRepositorio(issue.repositorio, new Date(), intervaloDaIntegracao()) ===
      'indisponivel',
  }
  const acoes: HomologacaoDaIssue['acoes'] = []
  let recusa: string | null = null
  for (const acao of ORDEM_DAS_ACOES) {
    if (!autorizar(sujeito, ACAO_PARA_PERMISSAO[acao], { clienteId })) continue
    const resultado = transicaoDeHomologacao(item.estado, acao, contexto)
    if ('novoEstado' in resultado) {
      acoes.push({ acao, disponivel: true })
      continue
    }
    // "Já foi disponibilizada" não explica nada a quem já vê o item em andamento.
    const informativa = !(
      acao === 'DISPONIBILIZAR' && item.estado !== 'AGUARDANDO_DISPONIBILIZACAO'
    )
    if (recusa === null && informativa) {
      recusa = resultado.recusa
    }
  }

  return { ...resumo, item, eventos, acoes, recusa, situacao: 'com-item' }
}

export interface HomologacaoDaIssueDoCliente {
  clienteId: string
  clienteNome: string
  milestoneId: string
  milestoneTitulo: string
  estado: EstadoItemHomologacao | null
  href: string
}

// Visão global: um registro por cliente e milestone em que a issue é homologada, só para
// direcionar ao contexto do cliente (decisão 7 do 5a).
export async function listarHomologacaoDaIssuePorCliente(
  sujeito: Sujeito,
  projetoId: string,
  issueId: string,
): Promise<HomologacaoDaIssueDoCliente[]> {
  exigirLeituraGlobal(sujeito)

  const issue = await db.issueGitHub.findFirst({
    where: { id: issueId, repositorio: { projetoId } },
    select: { id: true },
  })
  if (!issue) {
    throw new ErroDeDominio('Issue não encontrada.')
  }

  const vinculos = await db.milestoneIssue.findMany({
    where: { issueId, foraDoEscopo: false, milestone: { projetoId, arquivadaEm: null } },
    select: {
      milestone: {
        select: {
          id: true,
          titulo: true,
          tituloNormalizado: true,
          clientes: {
            where: { cliente: { arquivadoEm: null } },
            select: { cliente: { select: { id: true, nome: true } } },
          },
        },
      },
    },
  })
  const itens = await db.homologacaoItem.findMany({
    where: { issueId, homologacao: { milestone: { projetoId } } },
    select: { estado: true, homologacao: { select: { clienteId: true, milestoneId: true } } },
  })
  const estadoPorPar = new Map(
    itens.map((i) => [`${i.homologacao.clienteId}|${i.homologacao.milestoneId}`, i.estado]),
  )

  return vinculos
    .flatMap(({ milestone }) =>
      milestone.clientes.map(({ cliente }) => ({
        ordem: milestone.tituloNormalizado,
        linha: {
          clienteId: cliente.id,
          clienteNome: cliente.nome,
          milestoneId: milestone.id,
          milestoneTitulo: milestone.titulo,
          estado: estadoPorPar.get(`${cliente.id}|${milestone.id}`) ?? null,
          href: hrefDaIssueNoCliente(cliente.id, projetoId, issueId, milestone.id),
        },
      })),
    )
    .sort(
      (a, b) =>
        a.linha.clienteNome.localeCompare(b.linha.clienteNome, 'pt-BR') ||
        a.ordem.localeCompare(b.ordem, 'pt-BR'),
    )
    .map((x) => x.linha)
}
