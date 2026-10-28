'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { resumirErroParaLog } from '@/modules/github/model'
import {
  autorizarPublicacao,
  reconhecerDivergencia,
  registrarVerificacaoProd,
} from '@/modules/publicacao/service'

export interface EstadoDaAutorizacao {
  erro?: string
  sucesso?: string
}

const DADOS_INVALIDOS = 'Dados inválidos.'

const schema = z.object({
  projetoId: z.uuid({ error: DADOS_INVALIDOS }),
  repositorioId: z.uuid({ error: DADOS_INVALIDOS }),
  versaoAlvoId: z.uuid({ error: DADOS_INVALIDOS }),
  composicaoId: z.uuid({ error: DADOS_INVALIDOS }),
  hashComposicao: z.string({ error: DADOS_INVALIDOS }).regex(/^[0-9a-f]{64}$/, DADOS_INVALIDOS),
  verificadasPorHumano: z.array(z.uuid({ error: DADOS_INVALIDOS })).max(200, DADOS_INVALIDOS),
  justificativa: z.string({ error: DADOS_INVALIDOS }).max(1000, DADOS_INVALIDOS),
})

function campo(formData: FormData, nome: string): string {
  const valor = formData.get(nome)
  return typeof valor === 'string' ? valor : ''
}

export async function autorizarPublicacaoAction(
  _anterior: EstadoDaAutorizacao,
  formData: FormData,
): Promise<EstadoDaAutorizacao> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = schema.safeParse({
    projetoId: campo(formData, 'projetoId'),
    repositorioId: campo(formData, 'repositorioId'),
    versaoAlvoId: campo(formData, 'versaoAlvoId'),
    composicaoId: campo(formData, 'composicaoId'),
    hashComposicao: campo(formData, 'hashComposicao'),
    verificadasPorHumano: formData.getAll('verificadas').filter((v) => typeof v === 'string'),
    justificativa: campo(formData, 'justificativa'),
  })
  if (!parse.success) {
    return { erro: DADOS_INVALIDOS }
  }
  const { justificativa, ...dados } = parse.data

  try {
    await autorizarPublicacao(sessao.sujeito, {
      ...dados,
      contextoConferido: formData.get('contextoConferido') !== null,
      desconhecidosConferidos: formData.get('desconhecidosConferidos') !== null,
      justificativa: justificativa.trim() || null,
    })
    revalidatePath(`/projetos/${dados.projetoId}/publicacoes`)
    return { sucesso: 'Publicação autorizada. A autorização não dispara o deploy.' }
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return { erro: 'Somente administradores autorizam publicação em PROD.' }
    }
    if (erro instanceof ErroDeDominio) {
      return { erro: erro.message }
    }
    log.error({ erro: resumirErroParaLog(erro) }, 'Erro inesperado ao autorizar a publicação.')
    return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
  }
}

const idsSchema = z.object({
  projetoId: z.uuid({ error: DADOS_INVALIDOS }),
  divergenciaId: z.uuid({ error: DADOS_INVALIDOS }),
})

const verificacaoSchema = z.object({
  projetoId: z.uuid({ error: DADOS_INVALIDOS }),
  versaoId: z.uuid({ error: DADOS_INVALIDOS }),
  observacao: z.string({ error: DADOS_INVALIDOS }).max(2000, DADOS_INVALIDOS),
})

function erroDaAcao(erro: unknown, mensagem: string): EstadoDaAutorizacao {
  if (erro instanceof ErroDeAutorizacao) {
    return { erro: 'Somente administradores autorizam publicação em PROD.' }
  }
  if (erro instanceof ErroDeDominio) {
    return { erro: erro.message }
  }
  log.error({ erro: resumirErroParaLog(erro) }, mensagem)
  return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
}

export async function reconhecerDivergenciaAction(
  _anterior: EstadoDaAutorizacao,
  formData: FormData,
): Promise<EstadoDaAutorizacao> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = idsSchema.safeParse({
    projetoId: campo(formData, 'projetoId'),
    divergenciaId: campo(formData, 'divergenciaId'),
  })
  if (!parse.success) {
    return { erro: DADOS_INVALIDOS }
  }

  try {
    await reconhecerDivergencia(sessao.sujeito, parse.data)
    revalidatePath(`/projetos/${parse.data.projetoId}/publicacoes`)
    return { sucesso: 'Divergência reconhecida.' }
  } catch (erro) {
    return erroDaAcao(erro, 'Erro inesperado ao reconhecer a divergência.')
  }
}

export async function registrarVerificacaoAction(
  _anterior: EstadoDaAutorizacao,
  formData: FormData,
): Promise<EstadoDaAutorizacao> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = verificacaoSchema.safeParse({
    projetoId: campo(formData, 'projetoId'),
    versaoId: campo(formData, 'versaoId'),
    observacao: campo(formData, 'observacao'),
  })
  if (!parse.success) {
    return { erro: DADOS_INVALIDOS }
  }

  try {
    await registrarVerificacaoProd(sessao.sujeito, parse.data)
    revalidatePath(`/projetos/${parse.data.projetoId}/publicacoes`)
    return { sucesso: 'Verificação registrada.' }
  } catch (erro) {
    return erroDaAcao(erro, 'Erro inesperado ao registrar a verificação.')
  }
}
