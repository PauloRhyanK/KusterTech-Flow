import { NextResponse } from 'next/server'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { moduloAtivo } from '@/lib/modulos'
import { obterArquivoParaExibir } from '@/modules/demandas/queries'

const SEM_CACHE = { 'Cache-Control': 'private, no-store' }
const resposta = (status: number, erro: string) =>
  NextResponse.json({ erro }, { status, headers: SEM_CACHE })

// O arquivo da demanda (desenho, captura, anexo) para o iframe sandbox e as imagens da página.
// Sessão e permissão aqui: rota de arquivo não passa pelo layout.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; arquivoId: string }> },
): Promise<Response> {
  if (!moduloAtivo('demandas')) return resposta(404, 'Não encontrado.')
  const sessao = await obterSessao()
  if (!sessao) return resposta(401, 'Sessão necessária.')
  if (!autorizar(sessao.sujeito, 'desenvolvimento.ler')) return resposta(403, 'Sem permissão.')
  const { id, arquivoId } = await params
  const arquivo = await obterArquivoParaExibir(sessao.sujeito, id, arquivoId)
  if (!arquivo) return resposta(404, 'Não encontrado.')
  return new Response(arquivo.corpo, { status: 200, headers: arquivo.cabecalhos })
}
