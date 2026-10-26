import { ErroDeAutorizacao, exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import {
  type EstadoIntegracao,
  estadoDoProjeto,
  estadoDoRepositorio,
  INTERVALO_PADRAO_MS,
} from './model'

const ID_INTEGRACAO = 'github'

export interface RepositorioVinculado {
  id: string
  nomeCompleto: string
  urlHtml: string
  estado: EstadoIntegracao
  sincronizadoEm: Date | null
  ultimaFalhaMotivo: string | null
}

export interface SituacaoDaIntegracao {
  configurada: boolean
  fonte: 'app' | 'fixtures' | null
  catalogoSincronizadoEm: Date | null
  falhaDoCatalogo: string | null
  estadoDoProjeto: EstadoIntegracao
}

export function intervaloDaIntegracao(): number {
  return Number(process.env.GITHUB_INTERVALO_MS) || INTERVALO_PADRAO_MS
}

export function exigirLeituraGlobal(sujeito: Sujeito): void {
  exigirPermissao(sujeito, 'projetos.ler')
  if (!podeVerVisaoGlobal(sujeito)) {
    throw new ErroDeAutorizacao('projetos.ler')
  }
}

export async function lerSituacao(projetoId: string, agora: Date) {
  const [integracao, repositorios] = await Promise.all([
    db.integracaoGitHub.findUnique({ where: { id: ID_INTEGRACAO } }),
    db.repositorioGitHub.findMany({ where: { projetoId }, orderBy: { nomeCompleto: 'asc' } }),
  ])
  const intervalo = intervaloDaIntegracao()
  const configurada = integracao?.configurada ?? false
  const fonte = integracao ? (integracao.fonte === 'fixtures' ? 'fixtures' : 'app') : null

  const vinculados: RepositorioVinculado[] = repositorios.map((r) => ({
    id: r.id,
    nomeCompleto: r.nomeCompleto,
    urlHtml: r.urlHtml,
    estado: estadoDoRepositorio(r, agora, intervalo),
    sincronizadoEm: r.sincronizadoEm,
    ultimaFalhaMotivo: r.removidoDaInstalacaoEm
      ? 'A Central não tem mais acesso a este repositório.'
      : r.ultimaFalhaMotivo,
  }))

  const situacao: SituacaoDaIntegracao = {
    configurada,
    fonte,
    catalogoSincronizadoEm: integracao?.catalogoSincronizadoEm ?? null,
    falhaDoCatalogo: integracao?.ultimaFalhaMotivo ?? null,
    estadoDoProjeto: estadoDoProjeto(repositorios, configurada, agora, intervalo),
  }
  return { situacao, vinculados }
}

export async function obterRepositoriosDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
): Promise<{
  situacao: SituacaoDaIntegracao
  vinculados: RepositorioVinculado[]
  disponiveis: { id: string; nomeCompleto: string }[]
}> {
  exigirLeituraGlobal(sujeito)

  const { situacao, vinculados } = await lerSituacao(projetoId, new Date())
  const disponiveis = await db.repositorioGitHub.findMany({
    where: { projetoId: null, removidoDaInstalacaoEm: null },
    orderBy: { nomeCompleto: 'asc' },
    select: { id: true, nomeCompleto: true },
  })

  return { situacao, vinculados, disponiveis }
}

export async function obterResumoGitHubDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
): Promise<{ repositorios: number; estado: EstadoIntegracao }> {
  exigirLeituraGlobal(sujeito)

  const { situacao, vinculados } = await lerSituacao(projetoId, new Date())
  return { repositorios: vinculados.length, estado: situacao.estadoDoProjeto }
}

export async function contarRepositoriosPorProjeto(
  sujeito: Sujeito,
): Promise<ReadonlyMap<string, number>> {
  exigirLeituraGlobal(sujeito)

  const grupos = await db.repositorioGitHub.groupBy({
    by: ['projetoId'],
    where: { projetoId: { not: null } },
    _count: { _all: true },
  })
  return new Map(
    grupos.flatMap((g) => (g.projetoId === null ? [] : [[g.projetoId, g._count._all] as const])),
  )
}

function recusaDeVinculo(repo: {
  projetoId: string | null
  removidoDaInstalacaoEm: Date | null
}): ErroDeDominio {
  if (repo.removidoDaInstalacaoEm) {
    return new ErroDeDominio('A Central não tem acesso a este repositório.')
  }
  return new ErroDeDominio('Este repositório já está vinculado a outro projeto.')
}

export async function vincularRepositorio(
  sujeito: Sujeito,
  projetoId: string,
  repositorioId: string,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const projeto = await db.projeto.findUnique({
    where: { id: projetoId },
    select: { id: true, arquivadoEm: true },
  })
  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }
  if (projeto.arquivadoEm !== null) {
    throw new ErroDeDominio('Projeto arquivado não recebe repositórios.')
  }

  const repo = await db.repositorioGitHub.findUnique({
    where: { id: repositorioId },
    select: { projetoId: true, removidoDaInstalacaoEm: true },
  })
  if (!repo) {
    throw new ErroDeDominio('Repositório não encontrado.')
  }
  if (repo.removidoDaInstalacaoEm) {
    throw recusaDeVinculo(repo)
  }
  if (repo.projetoId === projetoId) {
    return
  }
  if (repo.projetoId !== null) {
    throw recusaDeVinculo(repo)
  }

  const agora = new Date()
  const { count } = await db.repositorioGitHub.updateMany({
    where: { id: repositorioId, projetoId: null, removidoDaInstalacaoEm: null },
    data: { projetoId, vinculadoEm: agora, sincronizacaoSolicitadaEm: agora },
  })
  if (count > 0) {
    return
  }

  // Outro pedido mudou o repositório entre a leitura e a gravação (invariante 8).
  const atual = await db.repositorioGitHub.findUnique({
    where: { id: repositorioId },
    select: { projetoId: true, removidoDaInstalacaoEm: true },
  })
  if (atual?.projetoId === projetoId && !atual.removidoDaInstalacaoEm) {
    return
  }
  throw atual ? recusaDeVinculo(atual) : new ErroDeDominio('Repositório não encontrado.')
}

export async function desvincularRepositorio(
  sujeito: Sujeito,
  projetoId: string,
  repositorioId: string,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const { count } = await db.repositorioGitHub.updateMany({
    where: { id: repositorioId, projetoId },
    data: { projetoId: null, vinculadoEm: null },
  })
  if (count === 0) {
    throw new ErroDeDominio('Este repositório não está vinculado a este projeto.')
  }
}

export async function solicitarSincronizacao(sujeito: Sujeito, projetoId: string): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const projeto = await db.projeto.findUnique({ where: { id: projetoId }, select: { id: true } })
  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }

  await db.repositorioGitHub.updateMany({
    where: { projetoId },
    data: { sincronizacaoSolicitadaEm: new Date() },
  })
}
