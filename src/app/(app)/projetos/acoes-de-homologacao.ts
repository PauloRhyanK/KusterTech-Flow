'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { resumirErroParaLog } from '@/modules/github/model'
import { registrarAcaoDeHomologacao } from '@/modules/homologacao/service'

export interface EstadoDaAcaoDeHomologacao {
  erro?: string
  sucesso?: string
}

const texto = z.string({ error: 'Dados inválidos.' })
const idOuVazio = texto.transform((v) => (v === '' ? null : v)).pipe(z.uuid().nullable())

const schema = z.object({
  acao: z.enum(['DISPONIBILIZAR', 'APROVAR', 'SOLICITAR_CORRECAO', 'COMENTAR']),
  itemId: z.uuid(),
  clienteId: z.uuid(),
  milestoneId: z.uuid(),
  issueId: z.uuid(),
  versaoId: idOuVazio,
  ultimoEventoId: idOuVazio,
  texto: texto.nullable().default(null),
  visibilidade: z.enum(['INTERNA', 'COMPARTILHAVEL']),
  projetoId: z.uuid(),
})

const MENSAGEM_DE_SUCESSO = {
  DISPONIBILIZAR: (cliente: string) => `Issue disponibilizada para ${cliente}.`,
  APROVAR: (cliente: string) => `Aprovação registrada para ${cliente}.`,
  SOLICITAR_CORRECAO: (cliente: string) => `Correção solicitada para ${cliente}.`,
  COMENTAR: () => 'Comentário registrado.',
} as const

export async function registrarAcaoDeHomologacaoAction(
  _anterior: EstadoDaAcaoDeHomologacao,
  formData: FormData,
): Promise<EstadoDaAcaoDeHomologacao> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = schema.safeParse(
    Object.fromEntries(
      [
        'acao',
        'itemId',
        'clienteId',
        'milestoneId',
        'issueId',
        'versaoId',
        'ultimoEventoId',
        'texto',
        'visibilidade',
        'projetoId',
      ].map((campo) => [campo, formData.get(campo) ?? (campo === 'texto' ? null : '')]),
    ),
  )
  if (!parse.success) {
    return { erro: 'Dados inválidos.' }
  }

  try {
    const { projetoId, ...entrada } = parse.data
    const resultado = await registrarAcaoDeHomologacao(sessao.sujeito, entrada)
    revalidatePath(`/clientes/${entrada.clienteId}`, 'layout')
    revalidatePath(`/projetos/${projetoId}`, 'layout')
    return { sucesso: MENSAGEM_DE_SUCESSO[entrada.acao](resultado.clienteNome) }
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return { erro: 'Sem permissão para esta ação de homologação.' }
    }
    if (erro instanceof ErroDeDominio) {
      return { erro: erro.message }
    }
    log.error(
      { erro: resumirErroParaLog(erro) },
      'Erro inesperado ao registrar ação de homologação.',
    )
    return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
  }
}
