// Segredo em repouso (D83): AES-256-GCM com IV aleatório de 12 bytes, tag de 16 e AAD por contexto.
// Formato `v1.<iv>.<tag>.<cifrado>` em base64url. O texto nunca entra em mensagem de erro.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export class ErroDeSegredo extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroDeSegredo'
  }
}

export const MENSAGEM_SEM_CHAVE =
  'A chave dos segredos não está configurada (FLOW_CHAVE_DOS_SEGREDOS).'
const NAO_DECIFROU = 'Não foi possível decifrar o segredo.'

export function chaveDosSegredos(
  env: Record<string, string | undefined> = process.env,
): Buffer | null {
  const bruta = env.FLOW_CHAVE_DOS_SEGREDOS?.trim()
  if (!bruta) return null
  const chave = Buffer.from(bruta, 'base64')
  if (chave.length !== 32) {
    throw new ErroDeSegredo('FLOW_CHAVE_DOS_SEGREDOS precisa ter 32 bytes em base64.')
  }
  return chave
}

export function cifrarSegredo(texto: string, contexto: string, chave: Buffer): string {
  const iv = randomBytes(12)
  const cifra = createCipheriv('aes-256-gcm', chave, iv)
  cifra.setAAD(Buffer.from(contexto, 'utf8'))
  const cifrado = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()])
  const tag = cifra.getAuthTag()
  return ['v1', iv, tag, cifrado]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.')
}

export function decifrarSegredo(cifrado: string, contexto: string, chave: Buffer): string {
  const partes = cifrado.split('.')
  if (partes.length !== 4 || partes[0] !== 'v1') throw new ErroDeSegredo(NAO_DECIFROU)
  try {
    const [iv, tag, dados] = partes.slice(1).map((p) => Buffer.from(p, 'base64url'))
    if (iv!.length !== 12 || tag!.length !== 16) throw new Error('formato')
    const decifra = createDecipheriv('aes-256-gcm', chave, iv!)
    decifra.setAAD(Buffer.from(contexto, 'utf8'))
    decifra.setAuthTag(tag!)
    return Buffer.concat([decifra.update(dados!), decifra.final()]).toString('utf8')
  } catch {
    throw new ErroDeSegredo(NAO_DECIFROU)
  }
}
