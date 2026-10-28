import { NextResponse } from 'next/server'
import { receberAlertaDoWebhook } from '@/modules/infra/webhook'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  const { status, corpo } = await receberAlertaDoWebhook(
    {
      authorization: request.headers.get('authorization'),
      contentType: request.headers.get('content-type'),
      contentLength: request.headers.get('content-length'),
      corpo: () => request.text(),
    },
    new Date(),
  )
  return NextResponse.json(corpo, { status })
}
