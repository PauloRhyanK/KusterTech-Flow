import type { Prisma } from '@prisma/client'
import { estadoDoProjeto, type EstadoIntegracao } from '@/modules/github/model'
import { intervaloDaIntegracao } from '@/modules/github/service'
import { ehCorrecaoBloqueadora, type EstadoItemHomologacao } from '@/modules/homologacao/model'
import { MOTIVO_COMPOSICAO_ALTERADA } from './composicoes'
import {
  localizarSituacaoDePublicacao,
  type SituacaoDePublicacao,
  type VersaoEmAmbiente,
} from './candidata'
import {
  deployEhDivergente,
  estadosDePublicacao,
  type EntradaDeAutorizacao,
  type EstadosDePublicacao,
  type ItemDaComposicao,
  type SituacaoItemAutorizacao,
} from './model'

type ItemDeIssue = Extract<ItemDaComposicao, { tipo: 'issue' }>
type Cliente = Prisma.TransactionClient

export interface LinhaDaComposicao {
  id: string
  projetoId: string
  repositorioId: string
  versaoAlvoId: string
  commitBase: string
  commitAlvo: string
  origemDaBase: 'AUTORIZACAO' | 'EVIDENCIA_PROD' | 'SEM_BASE'
  hashComposicao: string
  estado: 'IDENTIFICADA' | 'INCERTA'
  itens: ItemDaComposicao[]
  aprovacoesAnteriores: EntradaDeAutorizacao['aprovacoesAnteriores']
  calculadaEm: Date
}

export interface AutorizacaoVigente {
  id: string
  autorNome: string
  criadaEm: Date
  justificativa: string | null
}

export interface PublicacaoCarregada {
  situacao: SituacaoDePublicacao
  integracao: EstadoIntegracao
  composicao: LinhaDaComposicao | null
  // Decisão 12: o repositório foi sincronizado depois do cálculo da composição.
  desatualizada: boolean
  autorizacaoVigente: AutorizacaoVigente | null
}

export async function estadoDeIntegracaoDoRepositorio(
  cliente: Cliente,
  repositorio: SituacaoDePublicacao['repositorio'],
  agora: Date,
): Promise<EstadoIntegracao> {
  const integracao = await cliente.integracaoGitHub.findUnique({
    where: { id: 'github' },
    select: { configurada: true },
  })
  return estadoDoProjeto(
    [repositorio],
    integracao?.configurada ?? false,
    agora,
    intervaloDaIntegracao(),
  )
}

export function desatualizada(
  repositorio: { sincronizadoEm: Date | null },
  composicao: { calculadaEm: Date },
): boolean {
  return repositorio.sincronizadoEm !== null && repositorio.sincronizadoEm > composicao.calculadaEm
}

function comoLinha(
  c: Prisma.ComposicaoDePublicacaoGetPayload<Record<string, never>>,
): LinhaDaComposicao {
  return {
    id: c.id,
    projetoId: c.projetoId,
    repositorioId: c.repositorioId,
    versaoAlvoId: c.versaoAlvoId,
    commitBase: c.commitBase,
    commitAlvo: c.commitAlvo,
    origemDaBase: c.origemDaBase,
    hashComposicao: c.hashComposicao,
    estado: c.estado,
    itens: c.itens as unknown as ItemDaComposicao[],
    aprovacoesAnteriores:
      c.aprovacoesAnteriores as unknown as EntradaDeAutorizacao['aprovacoesAnteriores'],
    calculadaEm: c.calculadaEm,
  }
}

export async function autorizacaoVigenteDaVersao(
  cliente: Cliente,
  versaoAlvoId: string,
): Promise<AutorizacaoVigente | null> {
  const a = await cliente.autorizacaoProd.findFirst({
    where: { versaoAlvoId, revogadaEm: null },
    orderBy: { criadaEm: 'desc' },
    select: {
      id: true,
      criadaEm: true,
      justificativa: true,
      autor: { select: { nome: true } },
    },
  })
  return a
    ? { id: a.id, autorNome: a.autor.nome, criadaEm: a.criadaEm, justificativa: a.justificativa }
    : null
}

// Leitura única do que decide a publicação de um repositório: a tela e o service usam a mesma,
// o service dentro da transação que grava (A16, invariante 8).
export async function carregarPublicacaoDoRepositorio(
  cliente: Cliente,
  repositorioId: string,
  agora: Date,
): Promise<PublicacaoCarregada | null> {
  const situacao = await localizarSituacaoDePublicacao(cliente, repositorioId)
  if (!situacao) return null
  const integracao = await estadoDeIntegracaoDoRepositorio(cliente, situacao.repositorio, agora)
  if (!situacao.candidata || !situacao.base) {
    return {
      situacao,
      integracao,
      composicao: null,
      desatualizada: false,
      autorizacaoVigente: null,
    }
  }
  const linha = await cliente.composicaoDePublicacao.findUnique({
    where: {
      versaoAlvoId_commitBase: {
        versaoAlvoId: situacao.candidata.versaoId,
        commitBase: situacao.base.commitBase,
      },
    },
  })
  const composicao = linha ? comoLinha(linha) : null
  return {
    situacao,
    integracao,
    composicao,
    desatualizada: composicao ? desatualizada(situacao.repositorio, composicao) : false,
    autorizacaoVigente: await autorizacaoVigenteDaVersao(cliente, situacao.candidata.versaoId),
  }
}

export async function composicaoMaisRecenteDaVersao(
  cliente: Cliente,
  versaoAlvoId: string,
): Promise<LinhaDaComposicao | null> {
  const linha = await cliente.composicaoDePublicacao.findFirst({
    where: { versaoAlvoId },
    orderBy: { calculadaEm: 'desc' },
  })
  return linha ? comoLinha(linha) : null
}

type HomologacoesDaIssue = EntradaDeAutorizacao['issues'][number]['homologacoes']

export interface DadosDeHomologacao {
  homologacoes: HomologacoesDaIssue[number][]
  estados: EstadoItemHomologacao[]
  correcoesBloqueadoras: { cliente: string }[]
}

export async function homologacoesPorIssue(
  cliente: Cliente,
  issueIds: readonly string[],
): Promise<Map<string, DadosDeHomologacao>> {
  const itens = await cliente.homologacaoItem.findMany({
    where: { issueId: { in: [...issueIds] } },
    select: {
      issueId: true,
      estado: true,
      versaoAvaliada: { select: { id: true, rotulo: true } },
      homologacao: { select: { cliente: { select: { nome: true } } } },
      solicitacoes: { select: { estado: true, foraDoEscopo: true } },
    },
    orderBy: { id: 'asc' },
  })
  const mapa = new Map<string, DadosDeHomologacao>()
  for (const id of issueIds)
    mapa.set(id, { homologacoes: [], estados: [], correcoesBloqueadoras: [] })
  for (const i of itens) {
    const dados = mapa.get(i.issueId)
    if (!dados) continue
    const nome = i.homologacao.cliente.nome
    dados.homologacoes.push({ cliente: nome, estado: i.estado, versaoAvaliada: i.versaoAvaliada })
    dados.estados.push(i.estado)
    for (const s of i.solicitacoes) {
      if (ehCorrecaoBloqueadora(s)) dados.correcoesBloqueadoras.push({ cliente: nome })
    }
  }
  return mapa
}

// Errata §3.8, item 6: a correção não tem item próprio; herda os itens da issue original.
export async function originaisDasCorrecoes(
  cliente: Cliente,
  issueIds: readonly string[],
): Promise<Map<string, string[]>> {
  const vinculos = await cliente.issueVinculo.findMany({
    where: { issueCorrecaoId: { in: [...issueIds] } },
    select: { issueCorrecaoId: true, issueOriginalId: true },
  })
  const mapa = new Map<string, string[]>()
  for (const v of vinculos) {
    mapa.set(v.issueCorrecaoId, [...(mapa.get(v.issueCorrecaoId) ?? []), v.issueOriginalId])
  }
  return mapa
}

export interface AvaliacaoPreparada {
  entrada: Omit<EntradaDeAutorizacao, 'confirmacao'>
  tituloPorIssueId: Record<string, string>
  // QA da versão para os quatro estados (próprios e herdados das issues originais).
  qa: { estados: EstadoItemHomologacao[]; correcoesBloqueadoras: number }
}

// Monta a entrada de `avaliarAutorizacaoProd` com o estado atual das homologações; só a
// confirmação do usuário falta.
export async function prepararAvaliacao(
  cliente: Cliente,
  e: { composicao: LinhaDaComposicao; integracao: EstadoIntegracao },
): Promise<AvaliacaoPreparada> {
  const itens = e.composicao.itens.filter((i): i is ItemDeIssue => i.tipo === 'issue')
  const ids = itens.map((i) => i.issueId)
  const originais = await originaisDasCorrecoes(cliente, ids)
  const todos = [...new Set([...ids, ...[...originais.values()].flat()])]
  const dados = await homologacoesPorIssue(cliente, todos)
  const vazio: DadosDeHomologacao = { homologacoes: [], estados: [], correcoesBloqueadoras: [] }

  const issues = itens.map((item) => {
    const proprios = dados.get(item.issueId) ?? vazio
    const corrigeIssues = (originais.get(item.issueId) ?? []).map((id) => {
      const o = dados.get(id) ?? vazio
      return { homologacoes: o.homologacoes, correcoesBloqueadoras: o.correcoesBloqueadoras }
    })
    return {
      issueId: item.issueId,
      numero: item.numero,
      homologacoes: proprios.homologacoes,
      correcoesBloqueadoras: proprios.correcoesBloqueadoras,
      ...(corrigeIssues.length > 0 ? { corrigeIssues } : {}),
    }
  })

  const titulos = await cliente.issueGitHub.findMany({
    where: { id: { in: ids } },
    select: { id: true, titulo: true },
  })

  // Decisão 7: a autorização anterior do mesmo alvo, revogada por mudança de composição.
  const anterior = await cliente.autorizacaoProd.findFirst({
    where: {
      versaoAlvoId: e.composicao.versaoAlvoId,
      revogadaEm: { not: null },
      motivoRevogacao: MOTIVO_COMPOSICAO_ALTERADA,
    },
    orderBy: { revogadaEm: 'desc' },
    select: { composicaoAutorizada: true, itens: { select: { issueId: true, situacao: true } } },
  })

  const estados = issues.flatMap((i) => [
    ...(dados.get(i.issueId)?.estados ?? []),
    ...(originais.get(i.issueId) ?? []).flatMap((o) => dados.get(o)?.estados ?? []),
  ])
  const correcoesBloqueadoras = issues.reduce(
    (total, i) =>
      total +
      i.correcoesBloqueadoras.length +
      (i.corrigeIssues ?? []).reduce((t, o) => t + o.correcoesBloqueadoras.length, 0),
    0,
  )

  return {
    entrada: {
      alvoId: e.composicao.versaoAlvoId,
      composicao: { estado: e.composicao.estado, itens: e.composicao.itens },
      integracao: e.integracao,
      issues,
      aprovacoesAnteriores: e.composicao.aprovacoesAnteriores,
      autorizacaoAnterior: anterior
        ? {
            itens: anterior.composicaoAutorizada as unknown as ItemDaComposicao[],
            situacoes: anterior.itens.map((i) => ({
              issueId: i.issueId,
              situacao: i.situacao as SituacaoItemAutorizacao,
            })),
          }
        : null,
    },
    tituloPorIssueId: Object.fromEntries(titulos.map((t) => [t.id, t.titulo])),
    qa: { estados, correcoesBloqueadoras },
  }
}

// Os quatro estados de uma versão (D68), cada um do seu dado.
export async function estadosDaVersao(
  cliente: Cliente,
  e: {
    versaoId: string
    integracao: EstadoIntegracao
    prod: SituacaoDePublicacao['prod']
    emProd: VersaoEmAmbiente | null
    qa?: AvaliacaoPreparada['qa']
  },
): Promise<EstadosDePublicacao> {
  let qa = e.qa
  if (!qa) {
    const composicao = await composicaoMaisRecenteDaVersao(cliente, e.versaoId)
    qa = composicao
      ? (await prepararAvaliacao(cliente, { composicao, integracao: e.integracao })).qa
      : { estados: [], correcoesBloqueadoras: 0 }
  }

  const autorizacoes = await cliente.autorizacaoProd.findMany({
    where: { versaoAlvoId: e.versaoId },
    orderBy: { criadaEm: 'desc' },
    select: { criadaEm: true, revogadaEm: true },
  })
  const evidencia = e.prod
    ? await cliente.evidenciaDeploy.findFirst({
        where: { ambienteId: e.prod.id, versaoId: e.versaoId },
        orderBy: [{ ocorridaEm: 'desc' }, { registradaEm: 'desc' }],
      })
    : null
  const verificacao = await cliente.verificacaoProd.findFirst({
    where: { versaoId: e.versaoId },
    orderBy: { criadaEm: 'desc' },
    select: { origem: true },
  })

  return estadosDePublicacao({
    qa,
    autorizacao: autorizacoes[0] ?? null,
    deploy: evidencia
      ? { tipo: 'evidencia', situacao: evidencia.situacao, origem: evidencia.origem }
      : null,
    divergente:
      !!evidencia &&
      !!e.prod &&
      deployEhDivergente({
        ambienteCriadoEm: e.prod.criadoEm,
        evidencia,
        autorizacoes,
      }),
    verificacao,
  })
}
