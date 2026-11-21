import { formatarIdade } from '@/modules/inicio/model'

export type Origem = 'sessao' | 'fabrica' | 'outro'

export const ROTULO_DA_ORIGEM: Record<Origem, string> = {
  sessao: 'Sessão',
  fabrica: 'Fábrica',
  outro: 'Outro',
}

export const AUTOR_DA_FABRICA = 'warren-forge[bot]'
export const JANELA_MS = 24 * 60 * 60_000
export const LIMITE_DO_TITULO = 120
export const LIMITE_NO_INICIO = 8
export const LIMITE_DE_MERGES = 10

type EstadoDoPr = 'ABERTO' | 'FECHADO' | 'MERGEADO'

export function classificarOrigem(pr: { autor: string | null; branch: string }): Origem {
  if (pr.autor === AUTOR_DA_FABRICA || pr.branch.startsWith('warren/run_')) return 'fabrica'
  if (pr.branch.startsWith('claude/')) return 'sessao'
  return 'outro'
}

export function inicioDaJanela(agora: Date): Date {
  return new Date(agora.getTime() - JANELA_MS)
}

export function mergeadoNaJanela(
  pr: { estado: EstadoDoPr; mergeadoNoGitHub: Date | null },
  agora: Date,
): boolean {
  return (
    pr.estado === 'MERGEADO' &&
    pr.mergeadoNoGitHub !== null &&
    agora.getTime() - pr.mergeadoNoGitHub.getTime() <= JANELA_MS
  )
}

export function cortarTitulo(titulo: string): string {
  const caracteres = Array.from(titulo)
  if (caracteres.length <= LIMITE_DO_TITULO) return titulo
  return caracteres.slice(0, LIMITE_DO_TITULO - 1).join('') + '…'
}

export function tempoDesde(desde: Date, agora: Date): string {
  return formatarIdade(desde, agora).replace(/^há /, '')
}

export interface PrDaAtividade {
  projetoId: string
  estado: EstadoDoPr
  autor: string | null
  branch: string
  mergeadoNoGitHub: Date | null
}

export interface ContagemDeAtividade {
  mergeadosHoje: number
  abertos: number
  porOrigem: Record<Origem, number>
}

export function contarAtividade(prs: readonly PrDaAtividade[], agora: Date): ContagemDeAtividade {
  const contagem: ContagemDeAtividade = {
    mergeadosHoje: 0,
    abertos: 0,
    porOrigem: { sessao: 0, fabrica: 0, outro: 0 },
  }
  for (const pr of prs) {
    const mergeado = mergeadoNaJanela(pr, agora)
    if (!mergeado && pr.estado !== 'ABERTO') continue
    if (mergeado) contagem.mergeadosHoje += 1
    else contagem.abertos += 1
    contagem.porOrigem[classificarOrigem(pr)] += 1
  }
  return contagem
}

export interface LinhaDeAtividade extends ContagemDeAtividade {
  projeto: { id: string; nome: string }
  desatualizado: boolean
}

export function ordenarLinhas(linhas: readonly LinhaDeAtividade[]): LinhaDeAtividade[] {
  return [...linhas].sort(
    (a, b) =>
      b.mergeadosHoje - a.mergeadosHoje ||
      b.abertos - a.abertos ||
      a.projeto.nome.localeCompare(b.projeto.nome, 'pt-BR'),
  )
}

export function agregarPorProjeto(
  prs: readonly PrDaAtividade[],
  projetos: ReadonlyMap<string, { id: string; nome: string; desatualizado: boolean }>,
  agora: Date,
): LinhaDeAtividade[] {
  const grupos = new Map<string, PrDaAtividade[]>()
  for (const pr of prs) {
    if (!projetos.has(pr.projetoId)) continue
    const grupo = grupos.get(pr.projetoId)
    if (grupo) grupo.push(pr)
    else grupos.set(pr.projetoId, [pr])
  }
  const linhas: LinhaDeAtividade[] = []
  for (const [id, grupo] of grupos) {
    const projeto = projetos.get(id)!
    const contagem = contarAtividade(grupo, agora)
    if (contagem.mergeadosHoje + contagem.abertos === 0) continue
    linhas.push({
      ...contagem,
      projeto: { id: projeto.id, nome: projeto.nome },
      desatualizado: projeto.desatualizado,
    })
  }
  return ordenarLinhas(linhas)
}
