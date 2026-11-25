'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { exigirModulo } from '@/lib/modulos-rota'
import {
  definirUrlDaVersao,
  publicarAgora,
  salvarConfiguracaoDePublicacao,
} from '@/modules/fila-de-publicacao/service'
import { resumirErroParaLog } from '@/modules/github/model'

export interface EstadoDaPublicacaoNoProjeto {
  erro?: string
  sucesso?: string
}

const MENSAGEM_SEM_PERMISSAO = 'Sem permissão para gerenciar a publicação deste projeto.'
const MENSAGEM_GENERICA =
  'Não foi possível completar a operação agora. Tente novamente em instantes.'
const DADOS_INVALIDOS = 'Dados inválidos.'

const texto = z.string({ error: DADOS_INVALIDOS }).max(200, { error: DADOS_INVALIDOS })

const salvarSchema = z.object({
  projetoId: z.uuid({ error: 'Projeto inválido.' }),
  repositorioId: z.uuid({ error: 'Repositório inválido.' }),
  workflow: texto,
  entradaDoCommit: texto,
  horaDoLote: texto,
  modoPadrao: z.enum(['imediato', 'lote'], { error: 'Escolha o modo padrão.' }),
})

const versaoSchema = z.object({
  projetoId: z.uuid({ error: 'Projeto inválido.' }),
  repositorioId: z.uuid({ error: 'Repositório inválido.' }),
  urlDaVersao: z.string({ error: DADOS_INVALIDOS }).max(600, { error: DADOS_INVALIDOS }),
})

const publicarSchema = z.object({
  projetoId: z.uuid({ error: 'Projeto inválido.' }),
  repositorioId: z.uuid({ error: 'Repositório inválido.' }),
})

function traduzirErro(erro: unknown, contexto: string): EstadoDaPublicacaoNoProjeto {
  if (erro instanceof ErroDeAutorizacao) return { erro: MENSAGEM_SEM_PERMISSAO }
  if (erro instanceof ErroDeDominio) return { erro: erro.message }
  log.error({ erro: resumirErroParaLog(erro) }, `Erro inesperado ao ${contexto}.`)
  return { erro: MENSAGEM_GENERICA }
}

async function exigirSessao() {
  exigirModulo('fila-de-publicacao')
  const sessao = await obterSessao()
  if (!sessao) redirect('/entrar')
  return sessao
}

function revalidar(projetoId: string) {
  revalidatePath(`/projetos/${projetoId}/configuracao`)
  revalidatePath('/publicacao')
}

export async function salvarConfiguracaoDePublicacaoAction(
  _estado: EstadoDaPublicacaoNoProjeto,
  form: FormData,
): Promise<EstadoDaPublicacaoNoProjeto> {
  const sessao = await exigirSessao()
  const parse = salvarSchema.safeParse({
    projetoId: form.get('projetoId'),
    repositorioId: form.get('repositorioId'),
    workflow: form.get('workflow'),
    entradaDoCommit: form.get('entradaDoCommit'),
    horaDoLote: form.get('horaDoLote'),
    modoPadrao: form.get('modoPadrao'),
  })
  if (!parse.success) return { erro: parse.error.issues[0]?.message ?? DADOS_INVALIDOS }
  try {
    await salvarConfiguracaoDePublicacao(sessao.sujeito, {
      ...parse.data,
      // Caixa desmarcada não vai no formulário.
      automatico: form.get('automatico') === 'on',
      pausado: form.get('pausado') === 'on',
    })
    revalidar(parse.data.projetoId)
    return { sucesso: 'Configuração de publicação salva.' }
  } catch (erro) {
    return traduzirErro(erro, 'salvar a configuração de publicação')
  }
}

export async function publicarAgoraAction(
  _estado: EstadoDaPublicacaoNoProjeto,
  form: FormData,
): Promise<EstadoDaPublicacaoNoProjeto> {
  const sessao = await exigirSessao()
  const parse = publicarSchema.safeParse({
    projetoId: form.get('projetoId'),
    repositorioId: form.get('repositorioId'),
  })
  if (!parse.success) return { erro: parse.error.issues[0]?.message ?? DADOS_INVALIDOS }
  try {
    const pedido = await publicarAgora(sessao.sujeito, parse.data.repositorioId)
    revalidar(parse.data.projetoId)
    if (pedido.estado === 'recusado') return { erro: `Pedido recusado: ${pedido.motivo}.` }
    if (pedido.estado === 'dispensado') return { sucesso: `Nada a fazer: ${pedido.motivo}.` }
    return { sucesso: 'Pedido na fila: o Flow publica a ponta de main.' }
  } catch (erro) {
    return traduzirErro(erro, 'pedir a publicação')
  }
}

export async function salvarUrlDaVersaoAction(
  _estado: EstadoDaPublicacaoNoProjeto,
  form: FormData,
): Promise<EstadoDaPublicacaoNoProjeto> {
  const sessao = await exigirSessao()
  const parse = versaoSchema.safeParse({
    projetoId: form.get('projetoId'),
    repositorioId: form.get('repositorioId'),
    urlDaVersao: form.get('urlDaVersao') ?? '',
  })
  if (!parse.success) return { erro: parse.error.issues[0]?.message ?? DADOS_INVALIDOS }
  try {
    await definirUrlDaVersao(sessao.sujeito, parse.data)
    revalidar(parse.data.projetoId)
    return {
      sucesso: parse.data.urlDaVersao.trim()
        ? 'Versão no ar salva: o Flow confere o site depois de cada deploy.'
        : 'Conferência da versão no ar desligada.',
    }
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return { erro: 'Sem permissão para configurar a versão no ar.' }
    }
    return traduzirErro(erro, 'salvar a versão no ar')
  }
}
