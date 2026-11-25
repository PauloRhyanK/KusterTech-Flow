// A demanda como a Fábrica a vê: contrato 1 (sem partes) ou contrato 2 (com partes).
import type { EtapaDefinida } from './model'

export type ContratoDaFabrica = 1 | 2

export interface ParteParaAFabrica {
  chave: string
  repositorio: string
  objetivo: string | null
  ordem: number
  dependeDe: string[]
  chegaAoAr: 'publicacao' | 'versao'
  estado: string
  motivo: string | null
  plano: { caminho: string; prUrl: string | null } | null
  prs: unknown
  commitAlvo: string | null
  publicacao: {
    pedidoId: string
    estado: string
    motivo: string | null
    conserto: { estado: string; prUrl: string | null } | null
  } | null
}

/** A demanda já no formato do fio (contrato 2), antes de escolher a visão. */
export interface LinhaParaAFabrica {
  id: string
  repositorio: string
  projeto: string
  titulo: string
  descricao: string | null
  tipo: string | null
  destino: string | null
  escopo: string | null
  nivel: string
  temTela: boolean
  origem: string
  criadaEm: string
  etapas: readonly Pick<EtapaDefinida, 'chave' | 'rotulo' | 'marco'>[]
  etapaAtual: { chave: string; marco: string | null }
  espera: unknown
  encerrada: string | null
  naoChegouDesde: string | null
  eventos: unknown
  [extra: string]: unknown
}

export function demandaParaAFabrica(
  linha: LinhaParaAFabrica,
  partes: readonly ParteParaAFabrica[],
  contrato: ContratoDaFabrica,
): object {
  if (contrato === 2) return { ...linha, partes }

  // Contrato 1: a Fábrica v1 já entregou quando a etapa é "no ar"; ela não conhece partes.
  const v1: Record<string, unknown> = { ...linha }
  delete v1.naoChegouDesde
  const entregue = linha.etapaAtual.marco === 'no_ar' || linha.encerrada === 'no_ar'
  if (!entregue) return v1
  return {
    ...v1,
    encerrada: 'entregue',
    etapaAtual:
      linha.etapaAtual.marco === 'no_ar'
        ? { chave: linha.etapaAtual.chave, marco: 'entregue' }
        : linha.etapaAtual,
  }
}
