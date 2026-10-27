import { ErroDeDominio } from '@/lib/erros'

export const LIMITE_DE_ISSUES_POR_ADICAO = 50

export interface ItemDeProgresso {
  issueId: string
  estado: 'ABERTA' | 'FECHADA'
  foraDoEscopo: boolean
}

export interface ProgressoDaMilestone {
  fechadas: number
  total: number
  percentual: number | null
}

export function progressoDaMilestone(itens: readonly ItemDeProgresso[]): ProgressoDaMilestone {
  const estadoPorIssue = new Map<string, 'ABERTA' | 'FECHADA'>()
  for (const { issueId, estado, foraDoEscopo } of itens) {
    if (!foraDoEscopo) {
      estadoPorIssue.set(issueId, estado)
    }
  }

  const total = estadoPorIssue.size
  if (total === 0) {
    return { fechadas: 0, total: 0, percentual: null }
  }

  let fechadas = 0
  for (const estado of estadoPorIssue.values()) {
    if (estado === 'FECHADA') {
      fechadas += 1
    }
  }
  return { fechadas, total, percentual: Math.floor((fechadas * 100) / total) }
}

export function textoDoProgresso(progresso: ProgressoDaMilestone): string {
  if (progresso.total === 0 || progresso.percentual === null) {
    return 'Nenhuma issue vinculada'
  }
  const issues = progresso.total === 1 ? 'issue fechada' : 'issues fechadas'
  return `${progresso.fechadas} de ${progresso.total} ${issues} · ${progresso.percentual}%`
}

export function validarTituloDeMilestone(titulo: string): string {
  const aparado = titulo.trim()
  if (!aparado) {
    throw new ErroDeDominio('O título é obrigatório.')
  }
  if (aparado.length > 120) {
    throw new ErroDeDominio('O título não pode ter mais de 120 caracteres.')
  }
  return aparado
}

export function validarDescricaoDeMilestone(descricao?: string | null): string | null {
  const aparada = descricao?.trim() ?? ''
  if (!aparada) {
    return null
  }
  if (aparada.length > 2000) {
    throw new ErroDeDominio('A descrição não pode ter mais de 2000 caracteres.')
  }
  return aparada
}

export function lerPrazo(valor: string | null | undefined): Date | null {
  const aparado = valor?.trim() ?? ''
  if (!aparado) {
    return null
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(aparado)) {
    throw new ErroDeDominio('Prazo inválido.')
  }
  const data = new Date(`${aparado}T00:00:00.000Z`)
  if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== aparado) {
    throw new ErroDeDominio('Prazo inválido.')
  }
  return data
}

export function validarJustificativa(texto: string): string {
  const aparado = texto.trim()
  if (!aparado) {
    throw new ErroDeDominio('A justificativa é obrigatória.')
  }
  if (aparado.length > 500) {
    throw new ErroDeDominio('A justificativa não pode ter mais de 500 caracteres.')
  }
  return aparado
}

export interface VinculoDaOriginal {
  milestoneId: string
  foraDoEscopo: boolean
  arquivada: boolean
}

export function milestonesHerdadas(
  daOriginal: readonly VinculoDaOriginal[],
  jaNaCorrecao: readonly string[],
): string[] {
  const herdadas: string[] = []
  for (const { milestoneId, foraDoEscopo, arquivada } of daOriginal) {
    if (
      !foraDoEscopo &&
      !arquivada &&
      !jaNaCorrecao.includes(milestoneId) &&
      !herdadas.includes(milestoneId)
    ) {
      herdadas.push(milestoneId)
    }
  }
  return herdadas
}
