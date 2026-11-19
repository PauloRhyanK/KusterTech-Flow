import { createHash } from 'node:crypto'
import type { ESTADOS_DA_FILA, RetratoV1 } from './contrato'

export const LIMITE_DO_CORPO_DO_RETRATO = 262_144
export const PREFIXO_DO_TOKEN_DA_FABRICA = 'ff_'
export const LIMITE_NOME_FONTE_DA_FABRICA = 80
const TOLERANCIA_DE_FUTURO_MS = 5 * 60_000
const LIMITE_DE_ATRASO_MS = 5 * 60_000

export function retratoDesatualizado(recebidoEm: Date, agora: Date): boolean {
  return agora.getTime() - recebidoEm.getTime() > LIMITE_DE_ATRASO_MS
}

export function minutosDeAtraso(recebidoEm: Date, agora: Date): number {
  return Math.max(0, Math.floor((agora.getTime() - recebidoEm.getTime()) / 60_000))
}

export function hashDoTokenDaFabrica(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function extrairTokenDaFabrica(authorization: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')
  return m?.[1] ?? null
}

export type DecisaoDeGravacao = 'gravar' | 'descartar' | 'futuro'

// Só o último retrato vale: um geradoEm mais antigo que o guardado é descartado, e um
// geradoEm mais de 5 min à frente do relógio da Central é recusado.
export function decidirGravacaoDoRetrato(
  guardadoGeradoEm: Date | null,
  novoGeradoEm: Date,
  agora: Date,
): DecisaoDeGravacao {
  if (novoGeradoEm.getTime() > agora.getTime() + TOLERANCIA_DE_FUTURO_MS) return 'futuro'
  if (guardadoGeradoEm !== null && novoGeradoEm < guardadoGeradoEm) return 'descartar'
  return 'gravar'
}

export function validarNomeDaFonteDaFabrica(
  nome: string,
): { ok: true; nome: string } | { ok: false; erro: string } {
  const aparado = nome.trim()
  if (aparado === '') return { ok: false, erro: 'O nome é obrigatório.' }
  if (aparado.length > LIMITE_NOME_FONTE_DA_FABRICA) {
    return {
      ok: false,
      erro: `O nome não pode ter mais de ${LIMITE_NOME_FONTE_DA_FABRICA} caracteres.`,
    }
  }
  return { ok: true, nome: aparado }
}

export interface ResumoDoPlano {
  id: string
  repo: string
  feature: string
  estado: (typeof ESTADOS_DA_FILA)[number]
  faseAtual: string | null
  indiceDaFase: number | null
  totalDeFases: number
  raias: {
    concluidas: number
    executando: number
    falharam: number
    planejadas: number
    total: number
  }
  decisoes: number
  pausado: string | null
}

export function resumirPlano(plano: RetratoV1['planos'][number]): ResumoDoPlano {
  const raias = { concluidas: 0, executando: 0, falharam: 0, planejadas: 0, total: 0 }
  for (const fase of plano.fases) {
    for (const raia of fase.raias) {
      raias.total += 1
      if (raia.estado === 'concluida') raias.concluidas += 1
      else if (raia.estado === 'executando') raias.executando += 1
      else if (raia.estado === 'falhou') raias.falharam += 1
      else raias.planejadas += 1
    }
  }
  const posicao = plano.fases.findIndex((fase) => fase.id === plano.faseAtual)
  return {
    id: plano.id,
    repo: plano.repo,
    feature: plano.feature,
    estado: plano.estado,
    faseAtual: plano.faseAtual,
    indiceDaFase: plano.faseAtual === null || posicao === -1 ? null : posicao + 1,
    totalDeFases: plano.fases.length,
    raias,
    decisoes: plano.decisoes.length,
    pausado: plano.pausado,
  }
}

const ORDEM_EM_CURSO: readonly ResumoDoPlano['estado'][] = [
  'ativo',
  'admitindo',
  'pausado',
  'aguardando',
]

// Só os planos que ainda estão andando, por estado e, dentro dele, por entrada na fila.
export function planosEmCurso(retrato: RetratoV1): ResumoDoPlano[] {
  return retrato.planos
    .filter((plano) => ORDEM_EM_CURSO.includes(plano.estado))
    .sort(
      (a, b) =>
        ORDEM_EM_CURSO.indexOf(a.estado) - ORDEM_EM_CURSO.indexOf(b.estado) ||
        Date.parse(a.entrouEm) - Date.parse(b.entrouEm),
    )
    .map(resumirPlano)
}
