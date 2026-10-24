import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse<{ status: 'ok'; banco: 'ok' | 'indisponivel' }>> {
  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', banco: 'ok' }, { status: 200 })
  } catch {
    return NextResponse.json({ status: 'ok', banco: 'indisponivel' }, { status: 503 })
  }
}
