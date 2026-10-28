import { autorizar, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import type { OrigemEvidencia } from '@/modules/ambientes/model'
import type { EstadoIntegracao } from '@/modules/github/model'
import { exigirLeituraGlobal } from '@/modules/github/service'
import {
  carregarPublicacaoDoRepositorio,
  composicaoMaisRecenteDaVersao,
  desatualizada,
  estadosDaVersao,
  homologacoesPorIssue,
  originaisDasCorrecoes,
  prepararAvaliacao,
  type AvaliacaoPreparada,
  type LinhaDaComposicao,
} from './avaliacao'
import { localizarVersaoNoAmbiente } from './candidata'
import {
  avaliarAutorizacaoProd,
  estadosDePublicacao,
  resumirEstadosDaMilestone,
  type AvaliacaoDeAutorizacao,
  type EstadosDePublicacao,
  type ItemDaComposicao,
} from './model'

export interface ComposicaoApresentada {
  id: string
  estado: 'IDENTIFICADA' | 'INCERTA'
  hash: string
  origemDaBase: 'AUTORIZACAO' | 'EVIDENCIA_PROD' | 'SEM_BASE'
  commitBaseCurto: string | null
  calculadaEm: Date
  desatualizada: boolean
  itens: ItemDaComposicao[]
  tituloPorIssueId: Record<string, string>
  // Avaliada sobre a confirmação vazia: mostra o que falta, não o que o usuário confirmou.
  avaliacao: AvaliacaoDeAutorizacao
}

export interface VersaoCurta {
  id: string
  rotulo: string
  commitCurto: string
}

export interface DivergenciaApresentada {
  id: string
  commitCurto: string
  origem: OrigemEvidencia
  ocorridaEm: Date
  detectadaEm: Date
  reconhecida: { porNome: string; em: Date } | null
}

export interface PublicacaoDoRepositorio {
  repositorio: {
    id: string
    nomeCompleto: string
    estado: EstadoIntegracao
    sincronizadoEm: Date | null
  }
  emProd: {
    versaoId: string
    rotulo: string
    commitCurto: string
    origem: OrigemEvidencia
    ocorridaEm: Date
    estados: EstadosDePublicacao
  } | null
  candidata: {
    versao: VersaoCurta
    composicao: ComposicaoApresentada | null
    autorizacao: { autorNome: string; criadaEm: Date; justificativa: string | null } | null
    estados: EstadosDePublicacao
  } | null
  autorizacoes: {
    id: string
    rotulo: string
    criadaEm: Date
    autorNome: string
    revogadaEm: Date | null
    motivoRevogacao: string | null
  }[]
  divergencias: DivergenciaApresentada[]
}

export interface PublicacoesDoProjeto {
  projeto: { id: string; nome: string }
  ambientes: { qa: boolean; prod: boolean }
  podeAutorizar: boolean
  repositorios: PublicacaoDoRepositorio[]
  versaoSelecionada: {
    repositorioId: string
    versao: VersaoCurta
    composicao: ComposicaoApresentada
    somenteLeitura: boolean
  } | null
}

const curto = (sha: string) => sha.slice(0, 7)
const LIMITE_DE_AUTORIZACOES = 10
const LIMITE_DE_DIVERGENCIAS = 20

async function apresentar(
  composicao: LinhaDaComposicao,
  integracao: EstadoIntegracao,
  repositorio: { sincronizadoEm: Date | null },
): Promise<{ apresentada: ComposicaoApresentada; qa: AvaliacaoPreparada['qa'] }> {
  const preparada = await prepararAvaliacao(db, { composicao, integracao })
  return {
    apresentada: {
      id: composicao.id,
      estado: composicao.estado,
      hash: composicao.hashComposicao,
      origemDaBase: composicao.origemDaBase,
      commitBaseCurto: composicao.origemDaBase === 'SEM_BASE' ? null : curto(composicao.commitBase),
      calculadaEm: composicao.calculadaEm,
      desatualizada: desatualizada(repositorio, composicao),
      itens: composicao.itens,
      tituloPorIssueId: preparada.tituloPorIssueId,
      avaliacao: avaliarAutorizacaoProd({
        ...preparada.entrada,
        confirmacao: {
          contextoConferido: false,
          desconhecidosConferidos: false,
          verificadasPorHumano: [],
          justificativa: null,
        },
      }),
    },
    qa: preparada.qa,
  }
}

// Publicações do projeto (D31): leitura da visão global; o contexto de cliente não vê nada daqui.
export async function obterPublicacoesDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
  versaoId: string | null,
  agora: Date = new Date(),
): Promise<PublicacoesDoProjeto> {
  exigirLeituraGlobal(sujeito)

  const projeto = await db.projeto.findUnique({
    where: { id: projetoId },
    select: { id: true, nome: true },
  })
  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }

  const ambientes = await db.ambiente.findMany({
    where: { projetoId, tipo: { in: ['QA', 'PROD'] } },
    select: { tipo: true },
  })
  const repos = await db.repositorioGitHub.findMany({
    where: { projetoId },
    orderBy: { nomeCompleto: 'asc' },
    select: { id: true },
  })

  const repositorios: PublicacaoDoRepositorio[] = []
  for (const { id } of repos) {
    const carregada = await carregarPublicacaoDoRepositorio(db, id, agora)
    if (!carregada) continue
    const { situacao, integracao } = carregada
    const repositorio = {
      id,
      nomeCompleto: situacao.repositorio.nomeCompleto,
      estado: integracao,
      sincronizadoEm: situacao.repositorio.sincronizadoEm,
    }

    const emProd = situacao.emProd
    let candidata: PublicacaoDoRepositorio['candidata'] = null
    if (situacao.candidata) {
      const apresentada = carregada.composicao
        ? await apresentar(carregada.composicao, integracao, situacao.repositorio)
        : null
      candidata = {
        versao: {
          id: situacao.candidata.versaoId,
          rotulo: situacao.candidata.rotulo,
          commitCurto: curto(situacao.candidata.commitSha),
        },
        composicao: apresentada?.apresentada ?? null,
        autorizacao: carregada.autorizacaoVigente,
        estados: await estadosDaVersao(db, {
          versaoId: situacao.candidata.versaoId,
          integracao,
          prod: situacao.prod,
          emProd,
          qa: apresentada?.qa,
        }),
      }
    }

    const autorizacoes = await db.autorizacaoProd.findMany({
      where: { repositorioId: id },
      orderBy: { criadaEm: 'desc' },
      take: LIMITE_DE_AUTORIZACOES,
      select: {
        id: true,
        criadaEm: true,
        revogadaEm: true,
        motivoRevogacao: true,
        versaoAlvo: { select: { rotulo: true } },
        autor: { select: { nome: true } },
      },
    })

    const divergencias = await db.divergenciaDeDeploy.findMany({
      where: { versao: { repositorioId: id } },
      orderBy: { detectadaEm: 'desc' },
      take: LIMITE_DE_DIVERGENCIAS,
      select: {
        id: true,
        detectadaEm: true,
        reconhecidaEm: true,
        versao: { select: { commitSha: true } },
        evidencia: { select: { origem: true, ocorridaEm: true } },
        reconhecidaPor: { select: { nome: true } },
      },
    })

    repositorios.push({
      repositorio,
      emProd: emProd
        ? {
            versaoId: emProd.versaoId,
            rotulo: emProd.rotulo,
            commitCurto: curto(emProd.commitSha),
            origem: emProd.origem,
            ocorridaEm: emProd.ocorridaEm,
            estados: await estadosDaVersao(db, {
              versaoId: emProd.versaoId,
              integracao,
              prod: situacao.prod,
              emProd,
            }),
          }
        : null,
      candidata,
      autorizacoes: autorizacoes.map((a) => ({
        id: a.id,
        rotulo: a.versaoAlvo.rotulo,
        criadaEm: a.criadaEm,
        autorNome: a.autor.nome,
        revogadaEm: a.revogadaEm,
        motivoRevogacao: a.motivoRevogacao,
      })),
      divergencias: divergencias.map((d) => ({
        id: d.id,
        commitCurto: curto(d.versao.commitSha),
        origem: d.evidencia.origem,
        ocorridaEm: d.evidencia.ocorridaEm,
        detectadaEm: d.detectadaEm,
        reconhecida:
          d.reconhecidaEm && d.reconhecidaPor
            ? { porNome: d.reconhecidaPor.nome, em: d.reconhecidaEm }
            : null,
      })),
    })
  }

  return {
    projeto,
    ambientes: {
      qa: ambientes.some((a) => a.tipo === 'QA'),
      prod: ambientes.some((a) => a.tipo === 'PROD'),
    },
    podeAutorizar: autorizar(sujeito, 'publicacao.autorizar'),
    repositorios,
    versaoSelecionada: versaoId ? await versaoSelecionada(projetoId, versaoId, repositorios) : null,
  }
}

// `?versao=` (pedido do Incremento 7): a composição mais recente da versão, no topo. Só leitura
// quando a versão não é a candidata do repositório.
async function versaoSelecionada(
  projetoId: string,
  versaoId: string,
  repositorios: readonly PublicacaoDoRepositorio[],
): Promise<PublicacoesDoProjeto['versaoSelecionada']> {
  const versao = await db.versao.findFirst({
    where: { id: versaoId, projetoId },
    select: { id: true, rotulo: true, commitSha: true, repositorioId: true },
  })
  if (!versao) return null
  const composicao = await composicaoMaisRecenteDaVersao(db, versao.id)
  if (!composicao) return null
  const doRepositorio = repositorios.find((r) => r.repositorio.id === versao.repositorioId)
  if (!doRepositorio) return null
  const { apresentada } = await apresentar(
    composicao,
    doRepositorio.repositorio.estado,
    doRepositorio.repositorio,
  )
  const candidata = doRepositorio.candidata
  return {
    repositorioId: versao.repositorioId,
    versao: { id: versao.id, rotulo: versao.rotulo, commitCurto: curto(versao.commitSha) },
    composicao: apresentada,
    somenteLeitura: candidata?.versao.id !== versao.id,
  }
}

interface IssueParaEstados {
  id: string
  repositorioId: string
}

// Os quatro estados de cada issue (D68), em lote: uma leitura por tipo de dado, sem N+1.
async function estadosDasIssues(
  projetoId: string,
  issues: readonly IssueParaEstados[],
): Promise<{ prodConfigurado: boolean; porIssue: Map<string, EstadosDePublicacao> }> {
  const prod = await db.ambiente.findFirst({
    where: { projetoId, tipo: 'PROD' },
    select: { id: true, criadoEm: true },
  })
  const porIssue = new Map<string, EstadosDePublicacao>()
  if (!prod) return { prodConfigurado: false, porIssue }

  const ids = issues.map((i) => i.id)
  // Errata §3.8, item 6: a correção não tem item próprio e herda a situação da issue original.
  const originais = await originaisDasCorrecoes(db, ids)
  const homologacoes = await homologacoesPorIssue(db, [
    ...new Set([...ids, ...[...originais.values()].flat()]),
  ])

  const versaoEmProdPorRepositorio = new Map<
    string,
    Awaited<ReturnType<typeof localizarVersaoNoAmbiente>>
  >()
  for (const repositorioId of new Set(issues.map((i) => i.repositorioId))) {
    versaoEmProdPorRepositorio.set(
      repositorioId,
      await localizarVersaoNoAmbiente(db, repositorioId, prod.id),
    )
  }
  const versaoIds = [
    ...new Set([...versaoEmProdPorRepositorio.values()].flatMap((v) => (v ? [v.versaoId] : []))),
  ]

  const [presencas, divergencias, verificacoes, itensAutorizados] = await Promise.all([
    db.presencaIssueVersao.findMany({
      where: { issueId: { in: ids }, versaoId: { in: versaoIds } },
      select: { issueId: true, versaoId: true, estado: true },
    }),
    db.divergenciaDeDeploy.findMany({
      where: { versaoId: { in: versaoIds }, evidencia: { ambienteId: prod.id } },
      select: { versaoId: true },
    }),
    db.verificacaoProd.findMany({
      where: { versaoId: { in: versaoIds } },
      orderBy: { criadaEm: 'desc' },
      select: { versaoId: true, origem: true },
    }),
    db.autorizacaoItem.findMany({
      where: { issueId: { in: ids } },
      select: { issueId: true, autorizacao: { select: { criadaEm: true, revogadaEm: true } } },
    }),
  ])
  const estadoDaPresenca = new Map(presencas.map((p) => [`${p.issueId}:${p.versaoId}`, p.estado]))
  const comDivergencia = new Set(divergencias.map((d) => d.versaoId))
  const verificacaoDaVersao = new Map<string, { origem: OrigemEvidencia }>()
  for (const v of verificacoes) {
    if (!verificacaoDaVersao.has(v.versaoId)) verificacaoDaVersao.set(v.versaoId, v)
  }
  // A autorização mais recente com item da issue; a revogada também conta (mostra "revogada").
  const autorizacaoDaIssue = new Map<string, { criadaEm: Date; revogadaEm: Date | null }>()
  for (const { issueId, autorizacao } of itensAutorizados) {
    const atual = autorizacaoDaIssue.get(issueId)
    if (!atual || autorizacao.criadaEm > atual.criadaEm)
      autorizacaoDaIssue.set(issueId, autorizacao)
  }

  const vazio = { estados: [], correcoesBloqueadoras: [] }
  for (const issue of issues) {
    const donas = [issue.id, ...(originais.get(issue.id) ?? [])]
    const dados = donas.map((id) => homologacoes.get(id) ?? vazio)
    const versaoEmProd = versaoEmProdPorRepositorio.get(issue.repositorioId) ?? null
    const presenca = versaoEmProd
      ? (estadoDaPresenca.get(`${issue.id}:${versaoEmProd.versaoId}`) ?? 'SEM_EVIDENCIA')
      : null
    const presente = presenca === 'PRESENCA_CONFIRMADA' || presenca === 'CONFIRMACAO_MANUAL'

    porIssue.set(
      issue.id,
      estadosDePublicacao({
        qa: {
          estados: dados.flatMap((d) => d.estados),
          correcoesBloqueadoras: dados.reduce((t, d) => t + d.correcoesBloqueadoras.length, 0),
        },
        autorizacao: autorizacaoDaIssue.get(issue.id) ?? null,
        deploy: presenca ? { tipo: 'presenca', estado: presenca } : null,
        divergente: presente && !!versaoEmProd && comDivergencia.has(versaoEmProd.versaoId),
        verificacao:
          presente && versaoEmProd
            ? (verificacaoDaVersao.get(versaoEmProd.versaoId) ?? null)
            : null,
      }),
    )
  }
  return { prodConfigurado: true, porIssue }
}

// Estados de publicação da issue (só visão global, D31).
export async function obterPublicacaoDaIssue(
  sujeito: Sujeito,
  projetoId: string,
  issueId: string,
): Promise<{ prodConfigurado: boolean; estados: EstadosDePublicacao | null }> {
  exigirLeituraGlobal(sujeito)

  const issue = await db.issueGitHub.findFirst({
    where: { id: issueId, repositorio: { projetoId } },
    select: { id: true, repositorioId: true },
  })
  if (!issue) {
    throw new ErroDeDominio('Issue não encontrada.')
  }
  const { prodConfigurado, porIssue } = await estadosDasIssues(projetoId, [issue])
  return { prodConfigurado, estados: porIssue.get(issue.id) ?? null }
}

// Resumo da milestone sobre as issues no escopo (`foraDoEscopo = false`) de repositórios vinculados.
export async function obterPublicacaoDaMilestone(
  sujeito: Sujeito,
  projetoId: string,
  milestoneId: string,
): Promise<{ prodConfigurado: boolean; resumo: ReturnType<typeof resumirEstadosDaMilestone> }> {
  exigirLeituraGlobal(sujeito)

  const milestone = await db.milestone.findFirst({
    where: { id: milestoneId, projetoId },
    select: {
      issues: {
        where: { foraDoEscopo: false, issue: { repositorio: { projetoId } } },
        select: { issue: { select: { id: true, repositorioId: true } } },
      },
    },
  })
  if (!milestone) {
    throw new ErroDeDominio('Milestone não encontrada.')
  }
  const issues = milestone.issues.map((v) => v.issue)
  const { prodConfigurado, porIssue } = await estadosDasIssues(projetoId, issues)
  return { prodConfigurado, resumo: resumirEstadosDaMilestone([...porIssue.values()]) }
}
