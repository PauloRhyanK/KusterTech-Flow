import pino, { type DestinationStream, type LoggerOptions } from 'pino'

export const CAMINHOS_REDIGIDOS = [
  'senha',
  'token',
  '*.senha',
  '*.token',
  'req.headers.authorization',
] as const

export function criarOpcoesDeLog(nivel = process.env.LOG_LEVEL ?? 'info'): LoggerOptions {
  return {
    level: nivel,
    redact: [...CAMINHOS_REDIGIDOS],
  }
}

export function criarLogger(destino?: DestinationStream, nivel?: string) {
  return pino(criarOpcoesDeLog(nivel), destino)
}

export const log = criarLogger()
