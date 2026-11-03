import { createHash } from 'node:crypto'

export const LIMITE_DO_CORPO_DO_RETRATO = 262_144
export const PREFIXO_DO_TOKEN_DA_FABRICA = 'ff_'
export const LIMITE_NOME_FONTE_DA_FABRICA = 80
const TOLERANCIA_DE_FUTURO_MS = 5 * 60_000

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
