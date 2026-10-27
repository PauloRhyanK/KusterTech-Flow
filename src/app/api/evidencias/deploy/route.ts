import { NextResponse } from 'next/server'
import { log } from '@/lib/log'
import {
  LIMITE_DO_CORPO_DO_ENDPOINT,
  registrarEvidenciaPorToken,
} from '@/modules/ambientes/service'
import { resumirErroParaLog } from '@/modules/github/model'

export const dynamic = 'force-dynamic'

const CORPO_GRANDE = { erro: 'Corpo grande demais.' }

// Lê no máximo o limite + 1 byte: um corpo sem Content-Length não é lido por inteiro.
async function lerCorpoLimitado(request: Request): Promise<string | null> {
  const leitor = request.body?.getReader()
  if (!leitor) {
    return ''
  }
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) {
      break
    }
    total += value.byteLength
    if (total > LIMITE_DO_CORPO_DO_ENDPOINT) {
      await leitor.cancel()
      return null
    }
    partes.push(value)
  }
  return Buffer.concat(partes).toString('utf8')
}

export async function POST(request: Request): Promise<NextResponse> {
  const declarado = Number(request.headers.get('content-length') ?? 0)
  if (declarado > LIMITE_DO_CORPO_DO_ENDPOINT) {
    return NextResponse.json(CORPO_GRANDE, { status: 413 })
  }

  try {
    const corpo = await lerCorpoLimitado(request)
    if (corpo === null) {
      return NextResponse.json(CORPO_GRANDE, { status: 413 })
    }
    const resposta = await registrarEvidenciaPorToken(
      request.headers.get('authorization'),
      corpo,
      new Date(),
    )
    return NextResponse.json(resposta.corpo, { status: resposta.status })
  } catch (erro) {
    log.error({ erro: resumirErroParaLog(erro) }, 'Erro inesperado no endpoint de evidência.')
    return NextResponse.json(
      { erro: 'Falha inesperada ao registrar a evidência.' },
      { status: 500 },
    )
  }
}
