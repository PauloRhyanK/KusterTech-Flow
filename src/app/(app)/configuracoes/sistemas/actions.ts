'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { moduloAtivo } from '@/lib/modulos'
import { resumirErroParaLog } from '@/modules/github/model'
import {
  criarSistema,
  type DadosDoSistema,
  editarSistema,
  revogarSistema,
  testarConexao,
} from '@/modules/relatos/sistemas'

export interface EstadoDoSistemaForm {
  erro?: string
  sucesso?: string
}

const SEM_PERMISSAO = 'Sem permissão para gerenciar as configurações.'
const GENERICA = 'Não foi possível completar a operação agora. Tente novamente em instantes.'
const CAMINHO = '/configuracoes/sistemas'

const texto = (form: FormData, campo: string) => {
  const v = form.get(campo)
  return typeof v === 'string' ? v : ''
}

function dadosDoForm(form: FormData): DadosDoSistema {
  return {
    nome: texto(form, 'nome'),
    url: texto(form, 'url'),
    projetoId: texto(form, 'projetoId'),
    repositorioId: texto(form, 'repositorioId') || null,
    // Nunca logado nem devolvido.
    token: texto(form, 'token'),
  }
}

function traduzirErro(erro: unknown, contexto: string): EstadoDoSistemaForm {
  if (erro instanceof ErroDeAutorizacao) return { erro: SEM_PERMISSAO }
  if (erro instanceof ErroDeDominio) return { erro: erro.message }
  log.error({ erro: resumirErroParaLog(erro) }, `Erro inesperado ao ${contexto}.`)
  return { erro: GENERICA }
}

async function sujeitoOuEntrar() {
  const sessao = await obterSessao()
  if (!sessao) redirect('/entrar')
  return sessao.sujeito
}

const MODULO_DESLIGADO: EstadoDoSistemaForm = { erro: 'O módulo de relatos não está ativo.' }

export async function criarSistemaAcao(
  _estado: EstadoDoSistemaForm,
  form: FormData,
): Promise<EstadoDoSistemaForm> {
  const sujeito = await sujeitoOuEntrar()
  if (!moduloAtivo('relatos')) return MODULO_DESLIGADO
  let id: string
  try {
    id = (await criarSistema(sujeito, dadosDoForm(form))).id
  } catch (erro) {
    return traduzirErro(erro, 'conectar sistema')
  }
  revalidatePath(CAMINHO)
  redirect(`${CAMINHO}/${id}?criado=1`)
}

export async function editarSistemaAcao(
  _estado: EstadoDoSistemaForm,
  form: FormData,
): Promise<EstadoDoSistemaForm> {
  const sujeito = await sujeitoOuEntrar()
  if (!moduloAtivo('relatos')) return MODULO_DESLIGADO
  const id = texto(form, 'sistemaId')
  try {
    await editarSistema(sujeito, id, dadosDoForm(form))
  } catch (erro) {
    return traduzirErro(erro, 'editar sistema')
  }
  revalidatePath(CAMINHO)
  revalidatePath(`${CAMINHO}/${id}`)
  return { sucesso: 'Sistema salvo.' }
}

export async function revogarSistemaAcao(
  _estado: EstadoDoSistemaForm,
  form: FormData,
): Promise<EstadoDoSistemaForm> {
  const sujeito = await sujeitoOuEntrar()
  if (!moduloAtivo('relatos')) return MODULO_DESLIGADO
  try {
    await revogarSistema(sujeito, texto(form, 'sistemaId'))
  } catch (erro) {
    return traduzirErro(erro, 'revogar sistema')
  }
  revalidatePath(CAMINHO)
  redirect(CAMINHO)
}

export async function testarConexaoAcao(
  _estado: EstadoDoSistemaForm,
  form: FormData,
): Promise<EstadoDoSistemaForm> {
  const sujeito = await sujeitoOuEntrar()
  if (!moduloAtivo('relatos')) return MODULO_DESLIGADO
  try {
    const r = await testarConexao(sujeito, texto(form, 'sistemaId'))
    return r.ok ? { sucesso: r.mensagem } : { erro: r.mensagem }
  } catch (erro) {
    return traduzirErro(erro, 'testar a conexão do sistema')
  }
}
