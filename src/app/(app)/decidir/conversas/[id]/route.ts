import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { moduloAtivo } from '@/lib/modulos'
import { obterConversaDaTela } from '@/modules/decidir/queries'

export const dynamic = 'force-dynamic'

const SEM_CACHE = { 'Cache-Control': 'no-store' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEQ = /^\d{1,19}$/
const SEQ_MAXIMO = BigInt('9223372036854775807')

const resposta = (status: number, erro: string) =>
  NextResponse.json({ erro }, { status, headers: SEM_CACHE })

// A consulta da tela a cada 2 s: as mensagens depois de `depois`, o cartão aberto e os sinais de
// vida do atendente. Rota fora do layout: sessão e permissão aqui.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!moduloAtivo('decidir')) return respostaDeApiNaoEncontrada()
  const sessao = await obterSessao()
  if (!sessao) return resposta(401, 'Sessão necessária.')
  const { id } = await params
  if (!UUID.test(id)) return resposta(404, 'Não encontrado.')
  const bruto = new URL(request.url).searchParams.get('depois') ?? '0'
  // `seq` é um bigint do Postgres: fora dele o banco recusaria a consulta com erro 500.
  if (!SEQ.test(bruto) || BigInt(bruto) > SEQ_MAXIMO) return resposta(400, 'Parâmetro inválido.')
  const depois = BigInt(bruto)
  try {
    const conversa = await obterConversaDaTela(sessao.sujeito, id, depois, new Date())
    if (!conversa) return resposta(404, 'Não encontrado.')
    return NextResponse.json(conversa, { status: 200, headers: SEM_CACHE })
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) return resposta(403, 'Sem permissão.')
    throw erro
  }
}
