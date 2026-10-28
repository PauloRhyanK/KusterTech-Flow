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
  MENSAGEM_CORPO,
  MENSAGEM_JUSTIFICATIVA,
  MENSAGEM_RESPOSTA,
  MENSAGEM_TITULO,
} from '@/modules/homologacao/model'
import {
  confirmarReteste,
  reclassificarSolicitacao,
  triarSolicitacao,
} from '@/modules/homologacao/service'

export interface EstadoDaTriagem {
  erro?: string
  sucesso?: string
}

const SEM_PERMISSAO = 'Sem permissão para fazer a triagem de correções.'
const GENERICA = 'Não foi possível completar a operação agora. Tente novamente em instantes.'
const DADOS_INVALIDOS = 'Dados inválidos.'

const texto = z.string({ error: DADOS_INVALIDOS })
const ids = {
  clienteId: z.uuid({ error: DADOS_INVALIDOS }),
  solicitacaoId: z.uuid({ error: DADOS_INVALIDOS }),
  projetoId: z.uuid({ error: DADOS_INVALIDOS }),
  issueId: z.uuid({ error: DADOS_INVALIDOS }),
  milestoneId: z.uuid({ error: DADOS_INVALIDOS }),
}

const justificativa = texto.trim().min(10, MENSAGEM_JUSTIFICATIVA).max(1000, MENSAGEM_JUSTIFICATIVA)

const schemaDaTriagem = z.discriminatedUnion(
  'tipo',
  [
    z.object({ tipo: z.literal('reabrir'), ...ids }),
    z
      .object({
        tipo: z.literal('criar_correcao'),
        ...ids,
        titulo: texto.trim().min(1, MENSAGEM_TITULO).max(200, MENSAGEM_TITULO),
        corpo: texto.trim().max(5000, MENSAGEM_CORPO),
        foraDoEscopo: z.boolean(),
        justificativa: texto.trim(),
      })
      .refine(
        (d) => !d.foraDoEscopo || (d.justificativa.length >= 10 && d.justificativa.length <= 1000),
        {
          error: MENSAGEM_JUSTIFICATIVA,
          path: ['justificativa'],
        },
      ),
    z.object({
      tipo: z.literal('responder'),
      ...ids,
      resposta: texto.trim().min(1, MENSAGEM_RESPOSTA).max(2000, MENSAGEM_RESPOSTA),
      visibilidade: z.enum(['INTERNA', 'COMPARTILHAVEL']),
    }),
  ],
  { error: DADOS_INVALIDOS },
)

function campo(formData: FormData, nome: string): string {
  const valor = formData.get(nome)
  return typeof valor === 'string' ? valor : ''
}

function mensagemDoErro(erro: unknown, assunto: string): string {
  if (erro instanceof ErroDeAutorizacao) {
    return SEM_PERMISSAO
  }
  if (erro instanceof ErroDeDominio) {
    return erro.message
  }
  log.error({ erro: resumirErroParaLog(erro) }, assunto)
  return GENERICA
}

function revalidar(clienteId: string, projetoId: string): void {
  revalidatePath(`/clientes/${clienteId}`, 'layout')
  revalidatePath(`/projetos/${projetoId}`, 'layout')
}

export async function triarSolicitacaoAction(
  _anterior: EstadoDaTriagem,
  formData: FormData,
): Promise<EstadoDaTriagem> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = schemaDaTriagem.safeParse({
    tipo: campo(formData, 'tipo'),
    clienteId: campo(formData, 'clienteId'),
    solicitacaoId: campo(formData, 'solicitacaoId'),
    projetoId: campo(formData, 'projetoId'),
    issueId: campo(formData, 'issueId'),
    milestoneId: campo(formData, 'milestoneId'),
    titulo: campo(formData, 'titulo'),
    corpo: campo(formData, 'corpo'),
    foraDoEscopo: formData.get('foraDoEscopo') === 'on',
    justificativa: campo(formData, 'justificativa'),
    resposta: campo(formData, 'resposta'),
    visibilidade: campo(formData, 'visibilidade'),
  })
  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? DADOS_INVALIDOS }
  }
  const dados = parse.data

  try {
    const decisao =
      dados.tipo === 'reabrir'
        ? ({ tipo: 'reabrir' } as const)
        : dados.tipo === 'responder'
          ? ({
              tipo: 'responder',
              resposta: dados.resposta,
              visibilidade: dados.visibilidade,
            } as const)
          : ({
              tipo: 'criar_correcao',
              titulo: dados.titulo,
              corpo: dados.corpo,
              foraDoEscopo: dados.foraDoEscopo,
              justificativa: dados.foraDoEscopo ? dados.justificativa : null,
            } as const)
    await triarSolicitacao(sessao.sujeito, {
      clienteId: dados.clienteId,
      solicitacaoId: dados.solicitacaoId,
      decisao,
    })
    revalidar(dados.clienteId, dados.projetoId)
    return {
      sucesso:
        dados.tipo === 'reabrir'
          ? 'Triagem registrada. O worker faz a reabertura em até 30 s.'
          : dados.tipo === 'criar_correcao'
            ? 'Triagem registrada. O worker cria a issue de correção em até 30 s.'
            : 'Resposta registrada.',
    }
  } catch (erro) {
    return { erro: mensagemDoErro(erro, 'Erro inesperado ao registrar a triagem da correção.') }
  }
}

const schemaDaReclassificacao = z.object({
  ...ids,
  justificativa,
})

export async function reclassificarSolicitacaoAction(
  _anterior: EstadoDaTriagem,
  formData: FormData,
): Promise<EstadoDaTriagem> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = schemaDaReclassificacao.safeParse({
    clienteId: campo(formData, 'clienteId'),
    solicitacaoId: campo(formData, 'solicitacaoId'),
    projetoId: campo(formData, 'projetoId'),
    issueId: campo(formData, 'issueId'),
    milestoneId: campo(formData, 'milestoneId'),
    justificativa: campo(formData, 'justificativa'),
  })
  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? DADOS_INVALIDOS }
  }
  const dados = parse.data

  try {
    await reclassificarSolicitacao(sessao.sujeito, {
      clienteId: dados.clienteId,
      solicitacaoId: dados.solicitacaoId,
      justificativa: dados.justificativa,
    })
    revalidar(dados.clienteId, dados.projetoId)
    return { sucesso: 'Correção classificada como fora do escopo.' }
  } catch (erro) {
    return { erro: mensagemDoErro(erro, 'Erro inesperado ao reclassificar a correção.') }
  }
}

const schemaDoReteste = z.object({
  clienteId: ids.clienteId,
  projetoId: ids.projetoId,
  itemId: z.uuid({ error: DADOS_INVALIDOS }),
  versaoId: z.uuid({ error: DADOS_INVALIDOS }),
  justificativa,
})

export async function confirmarRetesteAction(
  _anterior: EstadoDaTriagem,
  formData: FormData,
): Promise<EstadoDaTriagem> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = schemaDoReteste.safeParse({
    clienteId: campo(formData, 'clienteId'),
    projetoId: campo(formData, 'projetoId'),
    itemId: campo(formData, 'itemId'),
    versaoId: campo(formData, 'versaoId'),
    justificativa: campo(formData, 'justificativa'),
  })
  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? DADOS_INVALIDOS }
  }
  const { projetoId, ...dados } = parse.data

  try {
    await confirmarReteste(sessao.sujeito, dados)
    revalidar(dados.clienteId, projetoId)
    return { sucesso: 'Reteste confirmado manualmente.' }
  } catch (erro) {
    return { erro: mensagemDoErro(erro, 'Erro inesperado ao confirmar o reteste.') }
  }
}
