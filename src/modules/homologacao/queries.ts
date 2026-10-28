import { autorizar, exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import type { TomDeEstado } from '@/lib/ui/badge-de-estado'
import type { EventoDaTimeline } from '@/lib/ui/timeline'
import type { EstadoImplantacao } from '@/modules/ambientes/model'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import { estadoDoRepositorio } from '@/modules/github/model'
import {
  exigirLeituraGlobal,
  intervaloDaIntegracao,
  lerSituacao,
  type SituacaoDaIntegracao,
} from '@/modules/github/service'
import type { Contexto } from '@/modules/projetos/model'
import { obterProjeto } from '@/modules/projetos/service'
import {
  ACAO_PARA_PERMISSAO,
  type AcaoDeRegistro,
  apresentarEstadoDoItem,
  classificarNaFila,
  type EstadoItemHomologacao,
  type FiltroDaFila,
  type FiltrosDaFila,
  detectarReteste,
  hrefDaFila,
  type MotivoSemReteste,
  resumoDaHomologacao,
  situacaoDaCorrecao,
  tituloDoEvento,
  transicaoDeHomologacao,
} from './model'
import { obterVersaoCorrenteEmQA, versoesCorrentesEmQA } from './versao-corrente'

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
  acoes: { acao: AcaoDeRegistro; disponivel: true }[]
  recusa: string | null
  podeEscolherVisibilidade: boolean
}

// Ordem fixa das ações na resposta.
const ORDEM_DAS_ACOES: readonly AcaoDeRegistro[] = [
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

export interface ItemDaFila {
  id: string
  clienteId: string
  clienteNome: string
  issueNumero: number
  issueTitulo: string
  repositorio: string
  estado: EstadoItemHomologacao
  versaoRotulo: string | null
  atualizadoEm: Date
  href: string
}

export interface FilaDeHomologacao {
  situacao: 'sem-ambiente-qa' | 'sem-milestones-com-cliente' | 'sem-itens' | 'com-itens'
  integracao: SituacaoDaIntegracao | null
  clientes: { id: string; nome: string }[]
  milestones: { id: string; titulo: string }[]
  contagens: Record<FiltroDaFila, number>
  grupos: { milestone: { id: string; titulo: string }; itens: ItemDaFila[] }[]
}

const porTexto = (a: string, b: string) => a.localeCompare(b, 'pt-BR')

// Fila do projeto (D65): global direciona ao contexto do cliente; no contexto do cliente o
// `clienteId` é forçado e o escopado não vê itens ainda não disponibilizados (D26).
export async function listarFilaDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
  contexto: Contexto,
  filtrosPedidos: FiltrosDaFila,
): Promise<FilaDeHomologacao> {
  await obterProjeto(sujeito, projetoId, contexto)
  const escopado = !podeVerVisaoGlobal(sujeito)
  const filtros: FiltrosDaFila =
    contexto.tipo === 'cliente' ? { ...filtrosPedidos, clienteId: null } : filtrosPedidos
  const base =
    contexto.tipo === 'cliente'
      ? `/clientes/${contexto.clienteId}/projetos/${projetoId}/homologacao`
      : `/projetos/${projetoId}/homologacao`
  const doCliente = contexto.tipo === 'cliente' ? { id: contexto.clienteId } : {}

  const integracao =
    contexto.tipo === 'global' ? (await lerSituacao(projetoId, new Date())).situacao : null
  const vazia = (situacao: FilaDeHomologacao['situacao']): FilaDeHomologacao => ({
    situacao,
    integracao,
    clientes: [],
    milestones: [],
    contagens: { 'requer-minha-acao': 0, 'aguardando-outros': 0, aprovados: 0, todos: 0 },
    grupos: [],
  })

  const ambienteQa = await db.ambiente.findUnique({
    where: { projetoId_tipo: { projetoId, tipo: 'QA' } },
    select: { id: true },
  })
  if (!ambienteQa) {
    return vazia('sem-ambiente-qa')
  }

  const milestonesComCliente = await db.milestone.count({
    where: {
      projetoId,
      arquivadaEm: null,
      clientes: { some: { cliente: { arquivadoEm: null, ...doCliente } } },
    },
  })
  if (milestonesComCliente === 0) {
    return vazia('sem-milestones-com-cliente')
  }

  const registros = await db.homologacaoItem.findMany({
    where: {
      ...(escopado ? { estado: { not: 'AGUARDANDO_DISPONIBILIZACAO' } } : {}),
      homologacao: {
        milestone: { projetoId, arquivadaEm: null },
        cliente: { arquivadoEm: null, ...doCliente },
      },
    },
    select: {
      id: true,
      estado: true,
      atualizadoEm: true,
      versaoAvaliada: { select: { rotulo: true } },
      solicitacoes: {
        where: { estado: 'ABERTA' },
        select: { tarefasGitHub: { where: { estado: 'PENDENTE' }, select: { id: true } } },
      },
      issue: {
        select: {
          id: true,
          numero: true,
          titulo: true,
          repositorio: { select: { nomeCompleto: true } },
        },
      },
      homologacao: {
        select: {
          cliente: { select: { id: true, nome: true } },
          milestone: {
            select: {
              id: true,
              titulo: true,
              tituloNormalizado: true,
              prazo: true,
              clientes: { select: { clienteId: true } },
            },
          },
        },
      },
    },
  })
  // Só valem os pares (cliente, milestone) que ainda estão associados (D25, D46).
  const vigentes = registros.filter((r) =>
    r.homologacao.milestone.clientes.some((m) => m.clienteId === r.homologacao.cliente.id),
  )
  if (vigentes.length === 0) {
    return vazia('sem-itens')
  }

  const clientes = new Map<string, string>()
  const milestones = new Map<string, { titulo: string; normalizado: string }>()
  for (const r of vigentes) {
    clientes.set(r.homologacao.cliente.id, r.homologacao.cliente.nome)
    const m = r.homologacao.milestone
    milestones.set(m.id, { titulo: m.titulo, normalizado: m.tituloNormalizado })
  }

  const capacidades = new Map<string, Parameters<typeof classificarNaFila>[1]>()
  const capacidadesDe = (clienteId: string) => {
    let c = capacidades.get(clienteId)
    if (!c) {
      c = {
        disponibilizar: autorizar(sujeito, 'homologacao.disponibilizar', { clienteId }),
        aprovar: autorizar(sujeito, 'homologacao.aprovar', { clienteId }),
        solicitarCorrecao: autorizar(sujeito, 'homologacao.solicitar_correcao', { clienteId }),
        triar: autorizar(sujeito, 'homologacao.triar', { clienteId }),
      }
      capacidades.set(clienteId, c)
    }
    return c
  }

  // Contagens: depois de cliente/milestone, antes do filtro de situação.
  const recortados = vigentes
    .filter((r) => !filtros.clienteId || r.homologacao.cliente.id === filtros.clienteId)
    .filter((r) => !filtros.milestoneId || r.homologacao.milestone.id === filtros.milestoneId)
    .map((r) => ({
      r,
      // Solicitação ABERTA sem tarefa pendente = correção a triar (base §3.8, item 7).
      classe: classificarNaFila(
        r.estado,
        capacidadesDe(r.homologacao.cliente.id),
        r.solicitacoes.some((s) => s.tarefasGitHub.length === 0),
      ),
    }))
  const contagens: Record<FiltroDaFila, number> = {
    'requer-minha-acao': 0,
    'aguardando-outros': 0,
    aprovados: 0,
    todos: recortados.length,
  }
  for (const { classe } of recortados) {
    contagens[classe] += 1
  }

  const porMilestone = new Map<
    string,
    {
      milestone: { id: string; titulo: string }
      prazo: Date | null
      normalizado: string
      itens: ItemDaFila[]
    }
  >()
  for (const { r, classe } of recortados) {
    if (filtros.filtro !== 'todos' && classe !== filtros.filtro) continue
    const m = r.homologacao.milestone
    const cliente = r.homologacao.cliente
    const retorno = `${hrefDaFila(base, filtros)}#item-${r.id}`
    const grupo = porMilestone.get(m.id) ?? {
      milestone: { id: m.id, titulo: m.titulo },
      prazo: m.prazo,
      normalizado: m.tituloNormalizado,
      itens: [],
    }
    grupo.itens.push({
      id: r.id,
      clienteId: cliente.id,
      clienteNome: cliente.nome,
      issueNumero: r.issue.numero,
      issueTitulo: r.issue.titulo,
      repositorio: r.issue.repositorio.nomeCompleto,
      estado: r.estado,
      versaoRotulo: r.versaoAvaliada?.rotulo ?? null,
      atualizadoEm: r.atualizadoEm,
      href: `${hrefDaIssueNoCliente(cliente.id, projetoId, r.issue.id, m.id)}&retorno=${encodeURIComponent(retorno)}`,
    })
    porMilestone.set(m.id, grupo)
  }

  const grupos = [...porMilestone.values()]
    .sort((a, b) => {
      if (a.prazo && b.prazo) {
        const d = a.prazo.getTime() - b.prazo.getTime()
        if (d !== 0) return d
      } else if (a.prazo || b.prazo) {
        return a.prazo ? -1 : 1
      }
      return porTexto(a.normalizado, b.normalizado)
    })
    .map((g) => ({
      milestone: g.milestone,
      itens: g.itens.sort(
        (a, b) =>
          porTexto(a.repositorio, b.repositorio) ||
          a.issueNumero - b.issueNumero ||
          porTexto(a.clienteNome, b.clienteNome),
      ),
    }))

  return {
    situacao: 'com-itens',
    integracao,
    clientes: [...clientes]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => porTexto(a.nome, b.nome)),
    milestones: [...milestones]
      .sort((a, b) => porTexto(a[1].normalizado, b[1].normalizado))
      .map(([id, m]) => ({ id, titulo: m.titulo })),
    contagens,
    grupos,
  }
}

export interface ResumoApresentado {
  texto: string
  tom: TomDeEstado
}

function hrefDaMilestoneNoCliente(clienteId: string, projetoId: string, milestoneId: string) {
  return `/clientes/${clienteId}/projetos/${projetoId}/entregas/milestones/${milestoneId}?aba=homologacao`
}

const MILESTONE_NAO_ENCONTRADA = 'Milestone não encontrada.'

export interface LinhaDaHomologacaoDaMilestone {
  issueId: string
  numero: number
  titulo: string
  repositorio: string
  estado: EstadoItemHomologacao | null
  // Item que existe mas ainda não foi disponibilizado ao cliente escopado (D26).
  oculta: boolean
  presenca: EstadoImplantacao | null
  href: string | null
}

export interface HomologacaoDaMilestoneNoCliente {
  semAmbienteQa: boolean
  resumo: ResumoApresentado
  versoes: { repositorio: string; rotulo: string | null }[]
  linhas: LinhaDaHomologacaoDaMilestone[]
}

// Aba Homologação da milestone no contexto do cliente (D63): só as issues do escopo da
// milestone, com o item do cliente quando ele já pode vê-lo.
export async function homologacaoDaMilestoneNoCliente(
  sujeito: Sujeito,
  clienteId: string,
  projetoId: string,
  milestoneId: string,
): Promise<HomologacaoDaMilestoneNoCliente> {
  exigirPermissao(sujeito, 'clientes.ler', { clienteId })

  const milestone = await db.milestone.findFirst({
    where: { id: milestoneId, projetoId, clientes: { some: { clienteId } } },
    select: {
      issues: {
        where: { foraDoEscopo: false },
        select: {
          issue: {
            select: {
              id: true,
              numero: true,
              titulo: true,
              repositorioId: true,
              repositorio: { select: { nomeCompleto: true } },
            },
          },
        },
      },
    },
  })
  if (!milestone) {
    throw new ErroDeDominio(MILESTONE_NAO_ENCONTRADA)
  }
  const escopado = !podeVerVisaoGlobal(sujeito)
  const issues = milestone.issues
    .map((v) => v.issue)
    .sort(
      (a, b) =>
        porTexto(a.repositorio.nomeCompleto, b.repositorio.nomeCompleto) || a.numero - b.numero,
    )

  const ambienteQa = await db.ambiente.findUnique({
    where: { projetoId_tipo: { projetoId, tipo: 'QA' } },
    select: { id: true },
  })
  const correntes = ambienteQa
    ? await versoesCorrentesEmQA(projetoId)
    : new Map<string, { id: string; rotulo: string }>()

  const [itens, presencas] = await Promise.all([
    db.homologacaoItem.findMany({
      where: { issueId: { in: issues.map((i) => i.id) }, homologacao: { clienteId, milestoneId } },
      select: { issueId: true, estado: true },
    }),
    db.presencaIssueVersao.findMany({
      where: {
        issueId: { in: issues.map((i) => i.id) },
        versaoId: { in: [...correntes.values()].map((v) => v.id) },
      },
      select: { issueId: true, versaoId: true, estado: true },
    }),
  ])
  const estadoPorIssue = new Map(itens.map((i) => [i.issueId, i.estado]))
  const presencaPorPar = new Map(presencas.map((p) => [`${p.issueId}|${p.versaoId}`, p.estado]))

  const retorno = encodeURIComponent(hrefDaMilestoneNoCliente(clienteId, projetoId, milestoneId))
  const visiveis: EstadoItemHomologacao[] = []
  const linhas = issues.map<LinhaDaHomologacaoDaMilestone>((issue) => {
    const real = estadoPorIssue.get(issue.id) ?? null
    const oculta = real === 'AGUARDANDO_DISPONIBILIZACAO' && escopado
    const estado = oculta ? null : real
    if (estado) visiveis.push(estado)
    const corrente = correntes.get(issue.repositorioId)
    return {
      issueId: issue.id,
      numero: issue.numero,
      titulo: issue.titulo,
      repositorio: issue.repositorio.nomeCompleto,
      estado,
      oculta,
      presenca: corrente ? (presencaPorPar.get(`${issue.id}|${corrente.id}`) ?? null) : null,
      href: estado
        ? `${hrefDaIssueNoCliente(clienteId, projetoId, issue.id, milestoneId)}&retorno=${retorno}`
        : null,
    }
  })

  const repositorios = new Map(issues.map((i) => [i.repositorioId, i.repositorio.nomeCompleto]))
  const versoes = [...repositorios]
    .map(([id, repositorio]) => ({ repositorio, rotulo: correntes.get(id)?.rotulo ?? null }))
    .sort((a, b) => porTexto(a.repositorio, b.repositorio))

  return {
    semAmbienteQa: ambienteQa === null,
    resumo: resumoDaHomologacao(visiveis),
    versoes,
    linhas,
  }
}

export interface ConsolidadoDaMilestone {
  clientes: { clienteId: string; nome: string; resumo: ResumoApresentado; href: string }[]
}

// Aba Homologação da milestone na visão global (D62): uma linha por cliente, só contagens.
export async function consolidadoDaMilestone(
  sujeito: Sujeito,
  projetoId: string,
  milestoneId: string,
): Promise<ConsolidadoDaMilestone> {
  exigirLeituraGlobal(sujeito)

  const milestone = await db.milestone.findFirst({
    where: { id: milestoneId, projetoId },
    select: {
      clientes: {
        where: { cliente: { arquivadoEm: null } },
        select: { cliente: { select: { id: true, nome: true } } },
      },
    },
  })
  if (!milestone) {
    throw new ErroDeDominio(MILESTONE_NAO_ENCONTRADA)
  }
  const itens = await db.homologacaoItem.findMany({
    where: { homologacao: { milestoneId } },
    select: { estado: true, homologacao: { select: { clienteId: true } } },
  })
  const estadosPorCliente = new Map<string, EstadoItemHomologacao[]>()
  for (const i of itens) {
    const lista = estadosPorCliente.get(i.homologacao.clienteId) ?? []
    lista.push(i.estado)
    estadosPorCliente.set(i.homologacao.clienteId, lista)
  }

  return {
    clientes: milestone.clientes
      .map(({ cliente }) => ({
        clienteId: cliente.id,
        nome: cliente.nome,
        resumo: resumoDaHomologacao(estadosPorCliente.get(cliente.id) ?? []),
        href: hrefDaMilestoneNoCliente(cliente.id, projetoId, milestoneId),
      }))
      .sort((a, b) => porTexto(a.nome, b.nome)),
  }
}

interface ItemParaResumo {
  estado: EstadoItemHomologacao
  clienteId: string
  clienteNome: string
  projetoId: string
  projetoNome: string
  milestoneId: string
  milestoneTitulo: string
}

// Itens vigentes (cliente ainda associado à milestone e não arquivado) de um projeto ou de
// um cliente. O escopado não conta o que ainda não foi disponibilizado a ele (D26).
async function carregarItensVigentes(
  sujeito: Sujeito,
  filtro: { projetoId?: string; clienteId?: string },
  opcoes: { milestonesAtivas: boolean },
): Promise<ItemParaResumo[]> {
  const escopado = !podeVerVisaoGlobal(sujeito)
  const registros = await db.homologacaoItem.findMany({
    where: {
      ...(escopado ? { estado: { not: 'AGUARDANDO_DISPONIBILIZACAO' } } : {}),
      homologacao: {
        cliente: { arquivadoEm: null, ...(filtro.clienteId ? { id: filtro.clienteId } : {}) },
        milestone: {
          ...(filtro.projetoId ? { projetoId: filtro.projetoId } : {}),
          ...(opcoes.milestonesAtivas ? { arquivadaEm: null, projeto: { arquivadoEm: null } } : {}),
        },
      },
    },
    select: {
      estado: true,
      homologacao: {
        select: {
          cliente: { select: { id: true, nome: true } },
          milestone: {
            select: {
              id: true,
              titulo: true,
              projeto: { select: { id: true, nome: true } },
              clientes: { select: { clienteId: true } },
            },
          },
        },
      },
    },
  })
  return registros
    .filter((r) =>
      r.homologacao.milestone.clientes.some((m) => m.clienteId === r.homologacao.cliente.id),
    )
    .map((r) => ({
      estado: r.estado,
      clienteId: r.homologacao.cliente.id,
      clienteNome: r.homologacao.cliente.nome,
      projetoId: r.homologacao.milestone.projeto.id,
      projetoNome: r.homologacao.milestone.projeto.nome,
      milestoneId: r.homologacao.milestone.id,
      milestoneTitulo: r.homologacao.milestone.titulo,
    }))
}

// Indicador "Homologação: …" da lista de milestones (D20: separado do progresso de desenvolvimento).
export async function resumoDeHomologacaoPorMilestone(
  sujeito: Sujeito,
  projetoId: string,
  contexto: Contexto,
): Promise<Map<string, ResumoApresentado>> {
  await obterProjeto(sujeito, projetoId, contexto)
  const clienteId = contexto.tipo === 'cliente' ? contexto.clienteId : undefined

  const [milestones, itens] = await Promise.all([
    db.milestone.findMany({
      where: { projetoId, ...(clienteId ? { clientes: { some: { clienteId } } } : {}) },
      select: {
        id: true,
        clientes: { where: { cliente: { arquivadoEm: null } }, select: { clienteId: true } },
      },
    }),
    carregarItensVigentes(sujeito, { projetoId, clienteId }, { milestonesAtivas: false }),
  ])
  const estadosPorMilestone = new Map<string, EstadoItemHomologacao[]>()
  for (const i of itens) {
    const lista = estadosPorMilestone.get(i.milestoneId) ?? []
    lista.push(i.estado)
    estadosPorMilestone.set(i.milestoneId, lista)
  }

  const resumos = new Map<string, ResumoApresentado>()
  for (const m of milestones) {
    const resumo = resumoDaHomologacao(estadosPorMilestone.get(m.id) ?? [])
    if (contexto.tipo === 'cliente') {
      resumos.set(m.id, resumo)
    } else if (m.clientes.length === 0) {
      resumos.set(m.id, { texto: 'Sem clientes associados', tom: 'neutro' })
    } else {
      const n = m.clientes.length
      resumos.set(m.id, {
        texto: `${n} ${n === 1 ? 'cliente' : 'clientes'} · ${resumo.texto}`,
        tom: resumo.tom,
      })
    }
  }
  return resumos
}

export interface PendenciaDeHomologacao {
  projetoId: string
  projetoNome: string
  milestoneId: string
  milestoneTitulo: string
  clienteId: string
  clienteNome: string
  resumo: ResumoApresentado
  href: string
}

// Uma linha por (cliente, milestone) com algum item ainda não aprovado; o resumo conta só os pendentes.
function agruparPendencias(
  itens: readonly ItemParaResumo[],
  hrefDe: (i: ItemParaResumo) => string,
): PendenciaDeHomologacao[] {
  const grupos = new Map<string, { base: ItemParaResumo; estados: EstadoItemHomologacao[] }>()
  for (const i of itens) {
    if (i.estado === 'APROVADA') continue
    const chave = `${i.clienteId}|${i.milestoneId}`
    const grupo = grupos.get(chave) ?? { base: i, estados: [] }
    grupo.estados.push(i.estado)
    grupos.set(chave, grupo)
  }
  return [...grupos.values()]
    .map(({ base, estados }) => ({
      projetoId: base.projetoId,
      projetoNome: base.projetoNome,
      milestoneId: base.milestoneId,
      milestoneTitulo: base.milestoneTitulo,
      clienteId: base.clienteId,
      clienteNome: base.clienteNome,
      resumo: resumoDaHomologacao(estados),
      href: hrefDe(base),
    }))
    .sort(
      (a, b) =>
        porTexto(a.projetoNome, b.projetoNome) ||
        porTexto(a.milestoneTitulo, b.milestoneTitulo) ||
        porTexto(a.clienteNome, b.clienteNome),
    )
}

export async function pendenciasDoCliente(
  sujeito: Sujeito,
  clienteId: string,
): Promise<PendenciaDeHomologacao[]> {
  exigirPermissao(sujeito, 'clientes.ler', { clienteId })
  const itens = await carregarItensVigentes(sujeito, { clienteId }, { milestonesAtivas: true })
  return agruparPendencias(itens, (i) =>
    hrefDaFila(`/clientes/${clienteId}/projetos/${i.projetoId}/homologacao`, {
      filtro: 'todos',
      clienteId: null,
      milestoneId: i.milestoneId,
    }),
  )
}

export async function pendenciasDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
  contexto: Contexto,
): Promise<PendenciaDeHomologacao[]> {
  await obterProjeto(sujeito, projetoId, contexto)
  const clienteId = contexto.tipo === 'cliente' ? contexto.clienteId : undefined
  const itens = await carregarItensVigentes(
    sujeito,
    { projetoId, clienteId },
    { milestonesAtivas: true },
  )
  return agruparPendencias(itens, (i) =>
    contexto.tipo === 'cliente'
      ? hrefDaFila(`/clientes/${contexto.clienteId}/projetos/${projetoId}/homologacao`, {
          filtro: 'todos',
          clienteId: null,
          milestoneId: i.milestoneId,
        })
      : hrefDaFila(`/projetos/${projetoId}/homologacao`, {
          filtro: 'todos',
          clienteId: i.clienteId,
          milestoneId: i.milestoneId,
        }),
  )
}

export interface CorrecaoNaTela {
  id: string
  eventoId: string
  criadaEm: Date
  situacao: { texto: string; tom: TomDeEstado }
  foraDoEscopo: boolean
  justificativa: string | null
  issueAlvo: { numero: number; titulo: string; urlHtml: string; href: string } | null
  tarefa: {
    tipo: 'REABRIR_ISSUE' | 'CRIAR_ISSUE'
    estado: 'PENDENTE' | 'CONCLUIDA' | 'FALHOU'
    falhaMotivo: string | null
    concluidaEm: Date | null
  } | null
  triavel: boolean
  reabrivel: boolean
  reclassificavel: boolean
  repositorioPublico: boolean
  issueOriginal: { numero: number; titulo: string }
}

// Blocos "Correção" da timeline da issue no contexto do cliente (5b.3). A triagem só é
// oferecida a quem tem `homologacao.triar`; os demais veem a situação.
export async function obterCorrecoesDaIssue(
  sujeito: Sujeito,
  clienteId: string,
  projetoId: string,
  issueId: string,
  milestoneId: string | null = null,
): Promise<{
  itemId: string | null
  correcoes: CorrecaoNaTela[]
  podeTriar: boolean
  integracaoConfigurada: boolean
}> {
  exigirPermissao(sujeito, 'projetos.ler', { clienteId })
  const podeTriar = autorizar(sujeito, 'homologacao.triar')

  const itens = await db.homologacaoItem.findMany({
    where: {
      issueId,
      homologacao: {
        clienteId,
        ...(milestoneId ? { milestoneId } : {}),
        milestone: { projetoId, arquivadaEm: null },
      },
    },
    select: {
      id: true,
      estado: true,
      homologacao: { select: { milestoneId: true } },
      issue: {
        select: {
          id: true,
          numero: true,
          titulo: true,
          estado: true,
          urlHtml: true,
          repositorio: { select: { privado: true } },
        },
      },
      solicitacoes: {
        orderBy: { criadoEm: 'asc' },
        select: {
          id: true,
          eventoId: true,
          estado: true,
          foraDoEscopo: true,
          justificativa: true,
          criadoEm: true,
          issueCorrecao: { select: { id: true, numero: true, titulo: true, urlHtml: true } },
          tarefasGitHub: {
            orderBy: { criadaEm: 'desc' },
            take: 1,
            select: { tipo: true, estado: true, falhaMotivo: true, concluidaEm: true },
          },
        },
      },
    },
  })

  const integracao = await db.integracaoGitHub.findUnique({
    where: { id: 'github' },
    select: { configurada: true },
  })
  const integracaoConfigurada = integracao?.configurada === true

  const correcoes: CorrecaoNaTela[] = []
  for (const item of itens) {
    const hrefDa = (id: string) =>
      hrefDaIssueNoCliente(clienteId, projetoId, id, item.homologacao.milestoneId)
    for (const s of item.solicitacoes) {
      const tarefa = s.tarefasGitHub[0] ?? null
      const alvo = s.issueCorrecao ?? (s.estado === 'RESPONDIDA_SEM_TAREFA' ? null : item.issue)
      const issueAlvo =
        alvo && s.estado !== 'ABERTA'
          ? {
              numero: alvo.numero,
              titulo: alvo.titulo,
              urlHtml: alvo.urlHtml,
              href: hrefDa(alvo.id),
            }
          : null
      correcoes.push({
        id: s.id,
        eventoId: s.eventoId,
        criadaEm: s.criadoEm,
        situacao: situacaoDaCorrecao({
          estado: s.estado,
          tarefa,
          numeroAlvo: issueAlvo?.numero ?? null,
        }),
        foraDoEscopo: s.foraDoEscopo,
        justificativa: s.justificativa,
        issueAlvo,
        tarefa,
        triavel: podeTriar && s.estado === 'ABERTA' && tarefa?.estado !== 'PENDENTE',
        reabrivel: item.issue.estado === 'FECHADA',
        reclassificavel: podeTriar && s.estado !== 'RESOLVIDA' && !s.foraDoEscopo,
        repositorioPublico: !item.issue.repositorio.privado,
        issueOriginal: { numero: item.issue.numero, titulo: item.issue.titulo },
      })
    }
  }

  return {
    itemId: itens.length === 1 ? itens[0]!.id : null,
    correcoes,
    podeTriar,
    integracaoConfigurada,
  }
}

export type SituacaoDoReteste =
  | { disponivel: false }
  | {
      disponivel: true
      motivo: MotivoSemReteste
      versoesEmQa: { id: string; rotulo: string; implantadaEm: Date }[]
    }

// Por que o reteste não foi detectado e que versões o admin pode escolher ao confirmar (5b.4).
export async function obterSituacaoDoReteste(
  sujeito: Sujeito,
  clienteId: string,
  itemId: string,
): Promise<SituacaoDoReteste> {
  if (!autorizar(sujeito, 'homologacao.triar', { clienteId })) {
    return { disponivel: false }
  }
  const item = await db.homologacaoItem.findUnique({
    where: { id: itemId },
    select: {
      estado: true,
      issueId: true,
      versaoAvaliadaId: true,
      homologacao: { select: { clienteId: true, milestone: { select: { projetoId: true } } } },
      issue: { select: { repositorioId: true, numero: true, estado: true, fechadaNoGitHub: true } },
      solicitacoes: {
        select: {
          id: true,
          estado: true,
          issueCorrecao: { select: { id: true, estado: true, fechadaNoGitHub: true } },
          tarefasGitHub: {
            where: { estado: 'CONCLUIDA' },
            orderBy: { concluidaEm: 'desc' },
            take: 1,
            select: { concluidaEm: true },
          },
        },
      },
    },
  })
  if (!item || item.homologacao.clienteId !== clienteId) {
    throw new ErroDeDominio('Item não encontrado.')
  }
  const projetoId = item.homologacao.milestone.projetoId
  const qa = { situacao: 'SUCESSO' as const, ambiente: { projetoId, tipo: 'QA' as const } }

  const versoes = await db.versao.findMany({
    where: { projetoId, repositorioId: item.issue.repositorioId, evidencias: { some: qa } },
    select: { id: true, rotulo: true, evidencias: { where: qa, select: { ocorridaEm: true } } },
  })
  const versoesEmQa = versoes
    .map((v) => ({
      id: v.id,
      rotulo: v.rotulo,
      implantadaEm: new Date(Math.min(...v.evidencias.map((e) => e.ocorridaEm.getTime()))),
    }))
    .sort((a, b) => b.implantadaEm.getTime() - a.implantadaEm.getTime())

  const alvos = item.solicitacoes.map((s) => {
    const issue =
      s.estado === 'CORRECAO_CRIADA'
        ? s.issueCorrecao
        : s.estado === 'REABERTA_NO_GITHUB'
          ? { id: item.issueId, ...item.issue }
          : null
    return { s, issue }
  })
  const alvoIds = alvos.flatMap(({ issue }) => (issue ? [issue.id] : []))
  const presencas = await db.presencaIssueVersao.findMany({
    where: { issueId: { in: alvoIds }, versaoId: { in: versoesEmQa.map((v) => v.id) } },
    select: { issueId: true, versaoId: true, estado: true },
  })
  const implantadaEm = new Map(versoesEmQa.map((v) => [v.id, v.implantadaEm]))

  const resultado = detectarReteste({
    estadoDoItem: item.estado,
    versaoAvaliadaId: item.versaoAvaliadaId,
    correcoes: alvos.map(({ s, issue }) => ({
      solicitacaoId: s.id,
      estado: s.estado,
      issueAlvoId: issue?.id ?? null,
      liberadaEm: s.tarefasGitHub[0]?.concluidaEm ?? null,
      issueAlvoFechadaEm: issue?.estado === 'FECHADA' ? issue.fechadaNoGitHub : null,
    })),
    presencasEmQa: presencas.map((p) => ({ ...p, implantadaEm: implantadaEm.get(p.versaoId)! })),
  })
  return {
    disponivel: true,
    motivo: resultado.reteste ? 'sem-presenca-em-qa' : resultado.motivo,
    versoesEmQa,
  }
}
