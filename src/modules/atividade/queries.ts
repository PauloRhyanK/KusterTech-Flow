import { autorizar, ErroDeAutorizacao, exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { moduloAtivo } from '@/lib/modulos'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import { estadoDoProjeto, type SituacaoDoRepositorio } from '@/modules/github/model'
import { intervaloDaIntegracao } from '@/modules/github/service'
import {
  agregarPorProjeto,
  classificarOrigem,
  contarAtividade,
  cortarTitulo,
  inicioDaJanela,
  LIMITE_DE_MERGES,
  type ContagemDeAtividade,
  type LinhaDeAtividade,
  type Origem,
  type PrDaAtividade,
} from './model'

export interface AtividadeGeral {
  linhas: LinhaDeAtividade[]
  totalHoje: number
  dadosDe: Date | null
  desatualizado: boolean
}

export interface MergeRecente {
  id: string
  numero: number
  titulo: string
  origem: Origem
  mergeadoEm: Date
  url: string
}

export interface AtividadeDoProjeto extends ContagemDeAtividade {
  ultimosMerges: MergeRecente[]
  dadosDe: Date | null
  desatualizado: boolean
}

export function podeVerAtividade(sujeito: Sujeito): boolean {
  return (
    moduloAtivo('atividade') &&
    podeVerVisaoGlobal(sujeito) &&
    autorizar(sujeito, 'desenvolvimento.ler')
  )
}

function exigirLeitura(sujeito: Sujeito): void {
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  if (!podeVerVisaoGlobal(sujeito)) {
    throw new ErroDeAutorizacao('desenvolvimento.ler')
  }
}

// Só abertos e mergeados na janela: o recorte é feito no banco, não em memória.
function prsDaJanela(agora: Date, projetoId?: string) {
  return db.pullRequestGitHub.findMany({
    where: {
      repositorio: {
        projetoId: projetoId ?? { not: null },
        projeto: { arquivadoEm: null },
      },
      OR: [
        { estado: 'ABERTO' },
        { estado: 'MERGEADO', mergeadoNoGitHub: { gte: inicioDaJanela(agora) } },
      ],
    },
    select: {
      estado: true,
      autor: true,
      branch: true,
      mergeadoNoGitHub: true,
      repositorio: { select: { projetoId: true } },
    },
  })
}

function reposVinculados(projetoId?: string) {
  return db.repositorioGitHub.findMany({
    where: { projetoId: projetoId ?? { not: null }, projeto: { arquivadoEm: null } },
    select: {
      projetoId: true,
      sincronizadoEm: true,
      ultimaFalhaEm: true,
      removidoDaInstalacaoEm: true,
      projeto: { select: { id: true, nome: true } },
    },
  })
}

function paraPrDaAtividade(prs: Awaited<ReturnType<typeof prsDaJanela>>): PrDaAtividade[] {
  return prs.flatMap((pr) =>
    pr.repositorio.projetoId
      ? [
          {
            projetoId: pr.repositorio.projetoId,
            estado: pr.estado,
            autor: pr.autor,
            branch: pr.branch,
            mergeadoNoGitHub: pr.mergeadoNoGitHub,
          },
        ]
      : [],
  )
}

// A sincronização mais antiga é a idade honesta dos números (null se nenhum sincronizou).
function sincronizacaoMaisAntiga(repos: readonly SituacaoDoRepositorio[]): Date | null {
  let maisAntiga: Date | null = null
  for (const r of repos) {
    if (r.sincronizadoEm && (!maisAntiga || r.sincronizadoEm < maisAntiga)) {
      maisAntiga = r.sincronizadoEm
    }
  }
  return maisAntiga
}

function desatualizados(
  repos: readonly SituacaoDoRepositorio[],
  agora: Date,
  intervalo: number,
): boolean {
  return estadoDoProjeto(repos, true, agora, intervalo) !== 'conectada'
}

export async function obterAtividade(sujeito: Sujeito, agora: Date): Promise<AtividadeGeral> {
  exigirLeitura(sujeito)

  const [prs, repos] = await Promise.all([prsDaJanela(agora), reposVinculados()])

  const intervalo = intervaloDaIntegracao()
  const reposPorProjeto = new Map<
    string,
    { projeto: { id: string; nome: string }; repos: SituacaoDoRepositorio[] }
  >()
  for (const r of repos) {
    if (!r.projeto) continue
    const atual = reposPorProjeto.get(r.projeto.id) ?? { projeto: r.projeto, repos: [] }
    atual.repos.push(r)
    reposPorProjeto.set(r.projeto.id, atual)
  }

  const projetos = new Map<string, { id: string; nome: string; desatualizado: boolean }>()
  for (const [id, { projeto, repos: doProjeto }] of reposPorProjeto) {
    projetos.set(id, { ...projeto, desatualizado: desatualizados(doProjeto, agora, intervalo) })
  }

  const linhas = agregarPorProjeto(paraPrDaAtividade(prs), projetos, agora)
  return {
    linhas,
    totalHoje: linhas.reduce((soma, l) => soma + l.mergeadosHoje, 0),
    dadosDe: sincronizacaoMaisAntiga(repos),
    desatualizado: [...projetos.values()].some((p) => p.desatualizado),
  }
}

export async function obterAtividadeDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
  agora: Date,
): Promise<AtividadeDoProjeto> {
  exigirLeitura(sujeito)

  const [prs, repos, merges] = await Promise.all([
    prsDaJanela(agora, projetoId),
    reposVinculados(projetoId),
    db.pullRequestGitHub.findMany({
      where: {
        repositorio: { projetoId, projeto: { arquivadoEm: null } },
        estado: 'MERGEADO',
        mergeadoNoGitHub: { not: null },
      },
      orderBy: [{ mergeadoNoGitHub: 'desc' }, { id: 'asc' }],
      take: LIMITE_DE_MERGES,
      select: {
        id: true,
        numero: true,
        titulo: true,
        autor: true,
        branch: true,
        mergeadoNoGitHub: true,
        urlHtml: true,
      },
    }),
  ])

  return {
    ...contarAtividade(paraPrDaAtividade(prs), agora),
    ultimosMerges: merges.flatMap((m) =>
      m.mergeadoNoGitHub
        ? [
            {
              id: m.id,
              numero: m.numero,
              titulo: cortarTitulo(m.titulo),
              origem: classificarOrigem(m),
              mergeadoEm: m.mergeadoNoGitHub,
              url: m.urlHtml,
            },
          ]
        : [],
    ),
    dadosDe: sincronizacaoMaisAntiga(repos),
    // Projeto sem repositório vinculado não tem dado nenhum a envelhecer.
    desatualizado: repos.length > 0 && desatualizados(repos, agora, intervaloDaIntegracao()),
  }
}
