import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { moduloAtivo } from '@/lib/modulos'
import { obterAnexoParaExibir } from '@/modules/decidir/queries'
import { cabecalhosDoArquivo, lerArquivo } from '@/modules/demandas/arquivos'

export const dynamic = 'force-dynamic'

const SEM_CACHE = { 'Cache-Control': 'private, no-store' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const resposta = (status: number, erro: string) =>
  NextResponse.json({ erro }, { status, headers: SEM_CACHE })

// A imagem de uma mensagem da conversa. Rota de arquivo não passa pelo layout: sessão e
// permissão aqui; o caminho no disco sai do banco, nunca da URL.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ anexoId: string }> },
): Promise<Response> {
  if (!moduloAtivo('decidir')) return respostaDeApiNaoEncontrada()
  const sessao = await obterSessao()
  if (!sessao) return resposta(401, 'Sessão necessária.')
  const { anexoId } = await params
  if (!UUID.test(anexoId)) return resposta(404, 'Não encontrado.')
  let anexo: Awaited<ReturnType<typeof obterAnexoParaExibir>>
  try {
    anexo = await obterAnexoParaExibir(sessao.sujeito, anexoId)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) return resposta(403, 'Sem permissão.')
    throw erro
  }
  if (!anexo) return resposta(404, 'Não encontrado.')
  const corpo = await lerArquivo(anexo.conversaId, anexoId, 'conversas')
  if (!corpo) return resposta(404, 'Não encontrado.')
  return new Response(corpo, {
    status: 200,
    headers: cabecalhosDoArquivo(anexo.conteudo, anexo.nome),
  })
}
