'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao, PERMISSOES, type Papel } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { log } from '@/lib/log'
import { alterarAtivo, criarUsuarioComoAdmin, emailValido } from '@/modules/usuarios/service'

export interface EstadoUsuario {
  erro?: string
  sucesso?: string
}

const papeisPermitidos = Object.keys(PERMISSOES) as [Papel, ...Papel[]]

const criarUsuarioSchema = z.object({
  email: z
    .string()
    .trim()
    .refine((val) => emailValido(val), {
      message: 'Formato de e-mail inválido.',
    }),
  nome: z.string().trim().min(1, 'O nome é obrigatório.'),
  senha: z
    .string()
    .min(12, 'A senha deve ter pelo menos 12 caracteres.')
    .max(1024, 'A senha é muito longa.'),
  papel: z.enum(papeisPermitidos, {
    message: 'Papel inválido.',
  }),
})

const alterarAtivoSchema = z.object({
  usuarioId: z.string().uuid('Identificador de usuário inválido.'),
  ativo: z.preprocess((val) => {
    if (typeof val === 'string') {
      return val === 'true'
    }
    return Boolean(val)
  }, z.boolean()),
})

export async function criarUsuarioAction(
  _estado: EstadoUsuario,
  form: FormData,
): Promise<EstadoUsuario> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = criarUsuarioSchema.safeParse({
    email: form.get('email'),
    nome: form.get('nome'),
    senha: form.get('senha'),
    papel: form.get('papel'),
  })

  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    await criarUsuarioComoAdmin(sessao.sujeito, parse.data)
    revalidatePath('/configuracoes/usuarios')
    return { sucesso: 'Usuário criado.' }
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return { erro: 'Sem permissão para gerenciar usuários.' }
    }
    if (erro instanceof Error) {
      return { erro: erro.message }
    }
    log.error({ err: erro }, 'Erro inesperado ao criar usuário.')
    return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
  }
}

export async function alterarAtivoAction(
  _estado: EstadoUsuario,
  form: FormData,
): Promise<EstadoUsuario> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = alterarAtivoSchema.safeParse({
    usuarioId: form.get('usuarioId'),
    ativo: form.get('ativo'),
  })

  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    await alterarAtivo(sessao.sujeito, parse.data.usuarioId, parse.data.ativo)
    revalidatePath('/configuracoes/usuarios')
    return { sucesso: 'Estado atualizado.' }
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return { erro: 'Sem permissão para gerenciar usuários.' }
    }
    if (erro instanceof Error) {
      return { erro: erro.message }
    }
    log.error({ err: erro }, 'Erro inesperado ao alterar estado do usuário.')
    return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
  }
}
