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
  alternarArquivamentoDeRecurso,
  associarProjetoAoRecurso,
  cadastrarRecurso,
  desassociarProjetoDoRecurso,
  editarRecurso,
} from '@/modules/infra/service'

export interface EstadoInfra {
  erro?: string
  sucesso?: string
}

const MENSAGEM_SEM_PERMISSAO = 'Sem permissão para gerenciar a infraestrutura.'
const MENSAGEM_GENERICA =
  'Não foi possível completar a operação agora. Tente novamente em instantes.'

const texto = z.string({ error: 'Dados inválidos.' })
const textoOpcional = texto.optional().or(z.literal(''))
const uuid = (mensagem: string) => texto.uuid(mensagem)

const camposDoRecurso = {
  nome: texto,
  identificadorExterno: textoOpcional,
  descricao: textoOpcional,
  hospedadoEmId: textoOpcional,
  urlBeszel: textoOpcional,
  urlGlitchTip: textoOpcional,
  urlHostDocker: textoOpcional,
}

const cadastrarSchema = z.object({
  tipo: z.enum(['SERVIDOR', 'CONTAINER', 'BANCO', 'STORAGE', 'OUTRO'], {
    error: 'Tipo de recurso inválido.',
  }),
  ...camposDoRecurso,
})

const editarSchema = z.object({
  recursoId: uuid('Identificador de recurso inválido.'),
  ...camposDoRecurso,
})

const arquivamentoSchema = z.object({
  recursoId: uuid('Identificador de recurso inválido.'),
  arquivar: z.enum(['true', 'false'], { error: 'Dados inválidos.' }),
})

const vinculoSchema = z.object({
  recursoId: uuid('Identificador de recurso inválido.'),
  projetoId: uuid('Identificador de projeto inválido.'),
})

function lerCampos(form: FormData) {
  return {
    nome: form.get('nome'),
    identificadorExterno: form.get('identificadorExterno') ?? undefined,
    descricao: form.get('descricao') ?? undefined,
    hospedadoEmId: form.get('hospedadoEmId') ?? undefined,
    urlBeszel: form.get('urlBeszel') ?? undefined,
    urlGlitchTip: form.get('urlGlitchTip') ?? undefined,
    urlHostDocker: form.get('urlHostDocker') ?? undefined,
  }
}

// Botões de confirmação chamam a action só com o FormData; formulários passam (estado, form).
function formDe(estadoOuForm: EstadoInfra | FormData, talvezForm?: FormData): FormData {
  if (talvezForm instanceof FormData) return talvezForm
  return estadoOuForm instanceof FormData ? estadoOuForm : new FormData()
}

function traduzirErro(erro: unknown, contexto: string): EstadoInfra {
  if (erro instanceof ErroDeAutorizacao) {
    return { erro: MENSAGEM_SEM_PERMISSAO }
  }
  if (erro instanceof ErroDeDominio) {
    return { erro: erro.message }
  }
  log.error({ erro: resumirErroParaLog(erro) }, `Erro inesperado ao ${contexto}.`)
  return { erro: MENSAGEM_GENERICA }
}

function revalidarInfraestrutura(projetoId?: string): void {
  revalidatePath('/infraestrutura', 'layout')
  if (projetoId) {
    revalidatePath(`/projetos/${projetoId}`, 'layout')
  }
}

export async function cadastrarRecursoAction(
  _estado: EstadoInfra,
  form: FormData,
): Promise<EstadoInfra> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = cadastrarSchema.safeParse({ tipo: form.get('tipo'), ...lerCampos(form) })
  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  let idCriado: string
  try {
    const { tipo, ...dados } = parse.data
    idCriado = (await cadastrarRecurso(sessao.sujeito, { tipo, ...dados })).id
  } catch (erro) {
    return traduzirErro(erro, 'cadastrar recurso')
  }

  revalidarInfraestrutura()
  redirect(`/infraestrutura/recursos/${idCriado}`)
}

export async function editarRecursoAction(
  _estado: EstadoInfra,
  form: FormData,
): Promise<EstadoInfra> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = editarSchema.safeParse({ recursoId: form.get('recursoId'), ...lerCampos(form) })
  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    const { recursoId, ...dados } = parse.data
    await editarRecurso(sessao.sujeito, recursoId, dados)
  } catch (erro) {
    return traduzirErro(erro, 'editar recurso')
  }

  revalidarInfraestrutura()
  redirect(`/infraestrutura/recursos/${parse.data.recursoId}`)
}

export async function alternarArquivamentoDeRecursoAction(
  estadoOuForm: EstadoInfra | FormData,
  talvezForm?: FormData,
): Promise<EstadoInfra> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const form = formDe(estadoOuForm, talvezForm)
  const parse = arquivamentoSchema.safeParse({
    recursoId: form.get('recursoId'),
    arquivar: form.get('arquivar'),
  })
  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    await alternarArquivamentoDeRecurso(
      sessao.sujeito,
      parse.data.recursoId,
      parse.data.arquivar === 'true',
    )
    revalidarInfraestrutura()
    return {
      sucesso: parse.data.arquivar === 'true' ? 'Recurso arquivado.' : 'Recurso desarquivado.',
    }
  } catch (erro) {
    return traduzirErro(erro, 'alternar o arquivamento do recurso')
  }
}

export async function associarProjetoAoRecursoAction(
  _estado: EstadoInfra,
  form: FormData,
): Promise<EstadoInfra> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = vinculoSchema.safeParse({
    recursoId: form.get('recursoId'),
    projetoId: form.get('projetoId'),
  })
  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    await associarProjetoAoRecurso(sessao.sujeito, parse.data.recursoId, parse.data.projetoId)
    revalidarInfraestrutura(parse.data.projetoId)
    return { sucesso: 'Projeto associado.' }
  } catch (erro) {
    return traduzirErro(erro, 'associar projeto ao recurso')
  }
}

export async function desassociarProjetoDoRecursoAction(
  estadoOuForm: EstadoInfra | FormData,
  talvezForm?: FormData,
): Promise<EstadoInfra> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const form = formDe(estadoOuForm, talvezForm)
  const parse = vinculoSchema.safeParse({
    recursoId: form.get('recursoId'),
    projetoId: form.get('projetoId'),
  })
  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    await desassociarProjetoDoRecurso(sessao.sujeito, parse.data.recursoId, parse.data.projetoId)
    revalidarInfraestrutura(parse.data.projetoId)
    return { sucesso: 'Projeto desassociado.' }
  } catch (erro) {
    return traduzirErro(erro, 'desassociar projeto do recurso')
  }
}
