import { NextResponse } from 'next/server'
import { z } from 'zod'
import { log } from '@/lib/log'
import { autenticarTokenDeEvidencia } from '@/modules/ambientes/service'
import { resumirErroParaLog } from '@/modules/github/model'
import { registrarVerificacaoPorEvidencia } from '@/modules/publicacao/service'

export const dynamic = 'force-dynamic'

const LIMITE_DO_CORPO_EM_BYTES = 4096

const corpoSchema = z.object({
  repositorio: z
    .string()
    .max(140)
    .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  observacao: z.string().max(500).optional(),
})

function resposta(status: number, corpo: { erro: string } | { id: string }): NextResponse {
  return NextResponse.json(corpo, { status })
}

function extrairToken(autorizacao: string | null): string | null {
  const m = /^Bearer (\S+)$/.exec(autorizacao ?? '')
  return m?.[1] ?? null
}

// Verificação em produção por evidência (decisão 10): o token é o do ambiente PROD. As respostas
// trazem só mensagens fixas; nada do corpo ou do token vai para o log.
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const token = extrairToken(request.headers.get('authorization'))
    const autenticado = token === null ? null : await autenticarTokenDeEvidencia(token)
    if (autenticado === null) {
      return resposta(401, { erro: 'Token inválido.' })
    }

    const texto = await request.text()
    let json: unknown = null
    try {
      json = Buffer.byteLength(texto, 'utf8') > LIMITE_DO_CORPO_EM_BYTES ? null : JSON.parse(texto)
    } catch {
      json = null
    }
    const parse = corpoSchema.safeParse(json)
    if (!parse.success) {
      return resposta(400, { erro: 'Corpo inválido.' })
    }

    const resultado = await registrarVerificacaoPorEvidencia({
      ambienteId: autenticado.ambienteId,
      nomeCompleto: parse.data.repositorio,
      commit: parse.data.commit,
      observacao: parse.data.observacao ?? null,
    })
    switch (resultado.tipo) {
      case 'registrada':
        return resposta(201, { id: resultado.id })
      case 'ambiente-nao-prod':
        return resposta(403, { erro: 'O token não é de um ambiente PROD.' })
      case 'versao-desconhecida':
        return resposta(404, { erro: 'Versão não encontrada.' })
      case 'sem-evidencia':
        return resposta(409, { erro: 'Não há evidência de deploy desta versão em PROD.' })
    }
  } catch (erro) {
    log.error({ erro: resumirErroParaLog(erro) }, 'Erro inesperado na verificação em produção.')
    return resposta(500, { erro: 'Falha inesperada ao registrar a verificação.' })
  }
}
