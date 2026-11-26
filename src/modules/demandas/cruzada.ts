// Regras puras da triagem cruzada (sem banco, sem relógio): candidatas, validações e separação.

import type { Origem, TipoDeDemanda } from './model'

export const CANDIDATAS_MAX = 15
export const JANELA_DAS_CANDIDATAS_DIAS = 30
export const RESUMO_MAX = 300
const TETO_PADRAO_DE_DIVISOES = 5
const ERROS_POR_LIGACAO_MAX = 10
const DIA_EM_MS = 86_400_000

export interface DemandaCandidataLinha {
  id: string
  projetoId: string
  titulo: string
  descricao: string | null
  origem: Origem
  tipo: TipoDeDemanda | null
  etapa: string
  relatos: number
  erros: number
  criadaEm: Date
  encerrada: string | null
  noArEm: Date | null
  juntadaEmId: string | null
}

export interface ErroCandidatoLinha {
  id: string
  projetoId: string
  titulo: string
  onde: string | null
  eventos: number
  usuarios: number
  ultimoEm: Date
  demandaId: string | null
  resolvidoEm: Date | null
  esperaDesde: Date | null
}

export interface CandidataNoFio {
  id: string
  titulo: string
  resumo: string
  origem: Origem
  tipo: TipoDeDemanda | null
  etapa: string
  relatos: number
  erros: number
  criadaEm: string
}

export interface ErroNoFio {
  id: string
  titulo: string
  onde: string | null
  eventos: number
  usuarios: number
  ultimoEm: string
  estado: 'em_observacao' | 'na_espera'
}

export interface Candidatas {
  demandas: CandidataNoFio[]
  erros: ErroNoFio[]
}

export interface DemandaDaValidacao {
  id: string
  projetoId: string
  etapaAtualMarco: string | null
  espera: string | null
  triagem: unknown
  encerrada: string | null
}

export type Validacao = { ok: true } | { ok: false; motivo: string }

const recusa = (motivo: string): Validacao => ({ ok: false, motivo })

/** Etapa inicial, sem espera, sem triagem gravada e não encerrada. */
export function esperaTriagem(d: {
  etapaAtualMarco: string | null
  espera: string | null
  triagem: unknown
  encerrada: string | null
}): boolean {
  return (
    d.etapaAtualMarco === 'recebida' &&
    d.espera === null &&
    d.triagem === null &&
    d.encerrada === null
  )
}

export function candidatasDe(
  alvo: { id: string; projetoId: string; separadasDe: readonly string[] },
  demandas: readonly DemandaCandidataLinha[],
  erros: readonly ErroCandidatoLinha[],
  agora: Date,
): Candidatas {
  const corte = agora.getTime() - JANELA_DAS_CANDIDATAS_DIAS * DIA_EM_MS
  return {
    demandas: demandas
      .filter(
        (d) =>
          d.projetoId === alvo.projetoId &&
          d.id !== alvo.id &&
          !alvo.separadasDe.includes(d.id) &&
          d.encerrada === null &&
          d.noArEm === null &&
          d.criadaEm.getTime() >= corte,
      )
      .sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime())
      .slice(0, CANDIDATAS_MAX)
      .map((d) => ({
        id: d.id,
        titulo: d.titulo,
        resumo: (d.descricao ?? '').slice(0, RESUMO_MAX),
        origem: d.origem,
        tipo: d.tipo,
        etapa: d.etapa,
        relatos: d.relatos,
        erros: d.erros,
        criadaEm: d.criadaEm.toISOString(),
      })),
    erros: erros
      .filter(
        (e) => e.projetoId === alvo.projetoId && e.demandaId === null && e.resolvidoEm === null,
      )
      .sort((a, b) => b.ultimoEm.getTime() - a.ultimoEm.getTime())
      .slice(0, CANDIDATAS_MAX)
      .map((e) => ({
        id: e.id,
        titulo: e.titulo,
        onde: e.onde,
        eventos: e.eventos,
        usuarios: e.usuarios,
        ultimoEm: e.ultimoEm.toISOString(),
        estado: e.esperaDesde !== null ? ('na_espera' as const) : ('em_observacao' as const),
      })),
  }
}

export function validarJuntar(
  b: DemandaDaValidacao,
  a: DemandaCandidataLinha | null,
  separadasDe: readonly string[],
): Validacao {
  if (!esperaTriagem(b)) return recusa('A demanda já passou da triagem.')
  if (a === null) return recusa('A demanda de destino não existe.')
  if (a.id === b.id) return recusa('A demanda não pode ser juntada a ela mesma.')
  if (a.projetoId !== b.projetoId) return recusa('A demanda de destino é de outro projeto.')
  if (a.encerrada !== null) return recusa('A demanda de destino já foi encerrada.')
  if (a.noArEm !== null) return recusa('A demanda de destino já foi ao ar.')
  if (a.juntadaEmId !== null) return recusa('A demanda de destino já foi juntada a outra.')
  if (separadasDe.includes(a.id)) return recusa('Esta demanda já foi separada da de destino.')
  return { ok: true }
}

export function validarLigarErros(
  d: DemandaDaValidacao,
  ids: readonly string[],
  erros: readonly ErroCandidatoLinha[],
): Validacao {
  if (ids.length < 1 || ids.length > ERROS_POR_LIGACAO_MAX) {
    return recusa('Ligue de 1 a 10 erros por vez.')
  }
  for (const id of ids) {
    const e = erros.find((x) => x.id === id)
    if (!e || e.projetoId !== d.projetoId || e.demandaId !== null || e.resolvidoEm !== null) {
      return recusa('Algum erro não pode ser ligado a esta demanda.')
    }
  }
  return { ok: true }
}

export function validarDividir(
  d: DemandaDaValidacao,
  novas: number,
  criadasPorDivisaoNoDia: number,
  teto: number,
): Validacao {
  if (!esperaTriagem(d)) return recusa('A demanda já passou da triagem.')
  if (criadasPorDivisaoNoDia + novas > teto) return recusa('teto de divisões do dia')
  return { ok: true }
}

/** O que volta para B na separação: o que a junção levou e ainda está em A. */
export function devolverNaSeparacao(
  juntada: { relatos: string[]; erros: string[] },
  aindaEmA: { relatos: string[]; erros: string[] },
): { relatos: string[]; erros: string[] } {
  return {
    relatos: juntada.relatos.filter((id) => aindaEmA.relatos.includes(id)),
    erros: juntada.erros.filter((id) => aindaEmA.erros.includes(id)),
  }
}

/** Os `de` dos eventos `separada` de B: demandas em que B nunca mais deve ser juntada. */
export function separadasDe(eventos: readonly { tipo: string; dados: unknown }[]): string[] {
  const de: string[] = []
  for (const e of eventos) {
    if (e.tipo !== 'separada' || typeof e.dados !== 'object' || e.dados === null) continue
    const valor = (e.dados as { de?: unknown }).de
    if (typeof valor === 'string') de.push(valor)
  }
  return de
}

export function podeSeparar(
  b: { encerrada: string | null; juntadaEmId: string | null },
  a: { noArEm: Date | null } | null,
): boolean {
  return b.encerrada === 'juntada' && b.juntadaEmId !== null && a !== null && a.noArEm === null
}

/** Autores distintos por sistema. */
export function pessoasQueRelataram(
  relatos: readonly { autorIdExterno: string; sistemaId: string }[],
): number {
  return new Set(relatos.map((r) => `${r.sistemaId}\u0000${r.autorIdExterno}`)).size
}

export function lerTetoDeDivisoes(env: string | undefined): number {
  if (env === undefined || !/^\d+$/.test(env.trim())) return TETO_PADRAO_DE_DIVISOES
  return Number(env.trim())
}
