import { autorizar, exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
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
  type AcaoDeHomologacao,
  apresentarEstadoDoItem,
  classificarNaFila,
  type EstadoItemHomologacao,
  type FiltroDaFila,
  type FiltrosDaFila,
  hrefDaFila,
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
      classe: classificarNaFila(r.estado, capacidadesDe(r.homologacao.cliente.id)),
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
