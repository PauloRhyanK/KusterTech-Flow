import { NextResponse } from 'next/server'
import { log } from '@/lib/log'
import {
  avaliarEntregaDoWebhook,
  LIMITE_DO_CORPO_DO_WEBHOOK,
  resumirErroParaLog,
} from '@/modules/github/model'
import { obterSegredoDoWebhook, registrarEventoDeWebhook } from '@/modules/github/webhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function responder(status: number, resultado: string): NextResponse {
  return NextResponse.json({ resultado }, { status })
}

export async function POST(request: Request): Promise<Response> {
  const segredo = obterSegredoDoWebhook(process.env)
  if (segredo === null) {
    return new Response(null, { status: 404 })
  }
  try {
    const declarado = Number(request.headers.get('content-length'))
    if (Number.isFinite(declarado) && declarado > LIMITE_DO_CORPO_DO_WEBHOOK) {
      return responder(413, 'corpo-grande-demais')
    }
    // Bytes brutos: a assinatura cobre o corpo exato, nunca uma reserialização.
    const corpo = Buffer.from(await request.arrayBuffer())
    const avaliacao = avaliarEntregaDoWebhook(segredo, corpo, {
      assinatura: request.headers.get('x-hub-signature-256'),
      evento: request.headers.get('x-github-event'),
      deliveryId: request.headers.get('x-github-delivery'),
    })
    if (avaliacao.tipo === 'responder') {
      if (
        avaliacao.resultado === 'assinatura-invalida' ||
        avaliacao.resultado === 'assinatura-ausente'
      ) {
        log.warn({ motivo: avaliacao.resultado }, 'webhook do GitHub recusado')
      }
      return responder(avaliacao.status, avaliacao.resultado)
    }
    const resultado = await registrarEventoDeWebhook(avaliacao, new Date())
    log.info({ evento: avaliacao.evento, resultado }, 'webhook do GitHub recebido')
    return resultado === 'registrado' ? responder(202, 'registrado') : responder(200, 'duplicado')
  } catch (err) {
    log.error({ erro: resumirErroParaLog(err) }, 'falha ao receber webhook do GitHub')
    return new Response(null, { status: 500 })
  }
}
