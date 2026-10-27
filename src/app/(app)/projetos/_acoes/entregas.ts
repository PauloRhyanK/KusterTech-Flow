'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { lerPrazo } from '@/modules/entregas/model'
import {
  adicionarIssuesAMilestone,
  arquivarMilestone,
  associarClienteAMilestone,
  criarMilestone,
  editarMilestone,
  reativarMilestone,
  removerClienteDaMilestone,
  removerIssueDaMilestone,
} from '@/modules/entregas/service'
import { resumirErroParaLog } from '@/modules/github/model'

export interface EstadoEntregas {
  erro?: string
  sucesso?: string
}

const uuid = (mensagem: string) => z.string({ error: 'Dados inválidos.' }).uuid(mensagem)
const idDoProjeto = uuid('Identificador de projeto inválido.')
const idDaMilestone = uuid('Identificador de milestone inválido.')
const idDoCliente = uuid('Identificador de cliente inválido.')
const idDaIssue = uuid('Identificador de issue inválido.')
const texto = z.string({ error: 'Dados inválidos.' })

const criarSchema = z.object({
  projetoId: idDoProjeto,
  titulo: texto,
  descricao: texto.optional(),
  prazo: texto.optional(),
  clientesIds: z.array(idDoCliente).optional(),
})
const editarSchema = z.object({
  projetoId: idDoProjeto,
  milestoneId: idDaMilestone,
  titulo: texto,
  descricao: texto.optional(),
  prazo: texto.optional(),
})
const arquivamentoSchema = z.object({
  projetoId: idDoProjeto,
  milestoneId: idDaMilestone,
  arquivar: z.enum(['true', 'false'], { error: 'Dados inválidos.' }),
})
const clienteSchema = z.object({
  projetoId: idDoProjeto,
  milestoneId: idDaMilestone,
  clienteId: idDoCliente,
})
const issuesSchema = z.object({
  projetoId: idDoProjeto,
  milestoneId: idDaMilestone,
  issueIds: z.array(idDaIssue).min(1, 'Selecione ao menos uma issue.'),
})
const issueSchema = z.object({
  projetoId: idDoProjeto,
  milestoneId: idDaMilestone,
  issueId: idDaIssue,
})

function revalidar(projetoId: string): void {
  revalidatePath(`/projetos/${projetoId}`, 'layout')
  revalidatePath('/clientes', 'layout')
}

function estadoDeErro(erro: unknown, contexto: string): EstadoEntregas {
  if (erro instanceof ErroDeAutorizacao) {
    return { erro: 'Sem permissão para gerenciar projetos.' }
  }
  if (erro instanceof ErroDeDominio) {
    return { erro: erro.message }
  }
  log.error({ erro: resumirErroParaLog(erro) }, contexto)
  return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
}

// `BotaoDeConfirmacao` chama a action só com o FormData; `useActionState` a chama com (estado, form).
function formDaChamada(estadoOuForm: EstadoEntregas | FormData, talvezForm?: FormData): FormData {
  if (talvezForm instanceof FormData) {
    return talvezForm
  }
  return estadoOuForm instanceof FormData ? estadoOuForm : new FormData()
}

function primeiroErro(erro: z.ZodError): EstadoEntregas {
  return { erro: erro.issues[0]?.message ?? 'Dados inválidos.' }
}

// Título e descrição são validados pelo service; aqui só o formato da data vira `Date`.
function lerDadosDeMilestone(dados: { titulo: string; descricao?: string; prazo?: string }) {
  return {
    titulo: dados.titulo,
    descricao: dados.descricao || null,
    prazo: lerPrazo(dados.prazo),
  }
}

export async function criarMilestoneAction(
  _estado: EstadoEntregas,
  form: FormData,
): Promise<EstadoEntregas> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const ids = form.getAll('clientesIds')
  const parse = criarSchema.safeParse({
    projetoId: form.get('projetoId'),
    titulo: form.get('titulo'),
    descricao: form.get('descricao') ?? undefined,
    prazo: form.get('prazo') ?? undefined,
    clientesIds: ids.length > 0 ? ids : undefined,
  })
  if (!parse.success) {
    return primeiroErro(parse.error)
  }

  let criada: { id: string }
  try {
    criada = await criarMilestone(sessao.sujeito, parse.data.projetoId, {
      ...lerDadosDeMilestone(parse.data),
      clientesIds: parse.data.clientesIds,
    })
  } catch (erro) {
    return estadoDeErro(erro, 'Erro inesperado ao criar milestone.')
  }

  revalidar(parse.data.projetoId)
  redirect(`/projetos/${parse.data.projetoId}/entregas/milestones/${criada.id}`)
}

export async function editarMilestoneAction(
  _estado: EstadoEntregas,
  form: FormData,
): Promise<EstadoEntregas> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = editarSchema.safeParse({
    projetoId: form.get('projetoId'),
    milestoneId: form.get('milestoneId'),
    titulo: form.get('titulo'),
    descricao: form.get('descricao') ?? undefined,
    prazo: form.get('prazo') ?? undefined,
  })
  if (!parse.success) {
    return primeiroErro(parse.error)
  }

  try {
    await editarMilestone(sessao.sujeito, parse.data.milestoneId, lerDadosDeMilestone(parse.data))
    revalidar(parse.data.projetoId)
    return { sucesso: 'Milestone atualizada.' }
  } catch (erro) {
    return estadoDeErro(erro, 'Erro inesperado ao editar milestone.')
  }
}

export async function alternarArquivamentoDaMilestoneAction(
  estadoOuForm: EstadoEntregas | FormData,
  talvezForm?: FormData,
): Promise<EstadoEntregas> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const form = formDaChamada(estadoOuForm, talvezForm)
  const parse = arquivamentoSchema.safeParse({
    projetoId: form.get('projetoId'),
    milestoneId: form.get('milestoneId'),
    arquivar: form.get('arquivar'),
  })
  if (!parse.success) {
    return primeiroErro(parse.error)
  }

  try {
    if (parse.data.arquivar === 'true') {
      await arquivarMilestone(sessao.sujeito, parse.data.milestoneId)
    } else {
      await reativarMilestone(sessao.sujeito, parse.data.milestoneId)
    }
    revalidar(parse.data.projetoId)
    return {
      sucesso: parse.data.arquivar === 'true' ? 'Milestone arquivada.' : 'Milestone reativada.',
    }
  } catch (erro) {
    return estadoDeErro(erro, 'Erro inesperado ao alternar o arquivamento da milestone.')
  }
}

export async function associarClienteAMilestoneAction(
  _estado: EstadoEntregas,
  form: FormData,
): Promise<EstadoEntregas> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = clienteSchema.safeParse({
    projetoId: form.get('projetoId'),
    milestoneId: form.get('milestoneId'),
    clienteId: form.get('clienteId'),
  })
  if (!parse.success) {
    return primeiroErro(parse.error)
  }

  try {
    await associarClienteAMilestone(sessao.sujeito, parse.data.milestoneId, parse.data.clienteId)
    revalidar(parse.data.projetoId)
    return { sucesso: 'Cliente associado à milestone.' }
  } catch (erro) {
    return estadoDeErro(erro, 'Erro inesperado ao associar cliente à milestone.')
  }
}

export async function removerClienteDaMilestoneAction(
  estadoOuForm: EstadoEntregas | FormData,
  talvezForm?: FormData,
): Promise<EstadoEntregas> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const form = formDaChamada(estadoOuForm, talvezForm)
  const parse = clienteSchema.safeParse({
    projetoId: form.get('projetoId'),
    milestoneId: form.get('milestoneId'),
    clienteId: form.get('clienteId'),
  })
  if (!parse.success) {
    return primeiroErro(parse.error)
  }

  try {
    await removerClienteDaMilestone(sessao.sujeito, parse.data.milestoneId, parse.data.clienteId)
    revalidar(parse.data.projetoId)
    return { sucesso: 'Cliente removido da milestone.' }
  } catch (erro) {
    return estadoDeErro(erro, 'Erro inesperado ao remover cliente da milestone.')
  }
}

export async function adicionarIssuesAMilestoneAction(
  _estado: EstadoEntregas,
  form: FormData,
): Promise<EstadoEntregas> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = issuesSchema.safeParse({
    projetoId: form.get('projetoId'),
    milestoneId: form.get('milestoneId'),
    issueIds: form.getAll('issueIds'),
  })
  if (!parse.success) {
    return primeiroErro(parse.error)
  }

  try {
    const { adicionadas } = await adicionarIssuesAMilestone(
      sessao.sujeito,
      parse.data.milestoneId,
      parse.data.issueIds,
    )
    revalidar(parse.data.projetoId)
    if (adicionadas === 0) {
      return { sucesso: 'Nenhuma issue nova; as selecionadas já estavam na milestone.' }
    }
    return {
      sucesso: adicionadas === 1 ? '1 issue adicionada.' : `${adicionadas} issues adicionadas.`,
    }
  } catch (erro) {
    return estadoDeErro(erro, 'Erro inesperado ao adicionar issues à milestone.')
  }
}

export async function removerIssueDaMilestoneAction(
  estadoOuForm: EstadoEntregas | FormData,
  talvezForm?: FormData,
): Promise<EstadoEntregas> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const form = formDaChamada(estadoOuForm, talvezForm)
  const parse = issueSchema.safeParse({
    projetoId: form.get('projetoId'),
    milestoneId: form.get('milestoneId'),
    issueId: form.get('issueId'),
  })
  if (!parse.success) {
    return primeiroErro(parse.error)
  }

  try {
    await removerIssueDaMilestone(sessao.sujeito, parse.data.milestoneId, parse.data.issueId)
    revalidar(parse.data.projetoId)
    return { sucesso: 'Issue removida da milestone.' }
  } catch (erro) {
    return estadoDeErro(erro, 'Erro inesperado ao remover issue da milestone.')
  }
}
