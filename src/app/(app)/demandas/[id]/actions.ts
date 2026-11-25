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
  aprovarDesenho,
  concluirEtapaPeloPaulo,
  decidirDestino,
  encerrarDemanda,
  pedirAjuste,
  retomarDemanda,
} from '@/modules/demandas/service'
import { conferirNoArPeloPaulo } from '@/modules/demandas/partes-service'
import { resumirErroParaLog } from '@/modules/github/model'

export interface EstadoDaDecisao {
  erro?: string
  sucesso?: string
}

const MENSAGEM_SEM_PERMISSAO = 'Sem permissão para esta ação.'
const MENSAGEM_GENERICA =
  'Não foi possível completar a operação agora. Tente novamente em instantes.'

const demandaId = z.uuid({ error: 'Demanda inválida.' })
// A versão que a pessoa viu: o service recusa se chegou uma mais nova (A16). A 0 é o artefato do
// Claude no "planejar comigo"; o service decide se ela vale.
const versao = z.coerce.number({ error: 'Versão inválida.' }).int().min(0, 'Versão inválida.')

function traduzirErro(erro: unknown, contexto: string): EstadoDaDecisao {
  if (erro instanceof ErroDeAutorizacao) return { erro: MENSAGEM_SEM_PERMISSAO }
  if (erro instanceof ErroDeDominio) return { erro: erro.message }
  log.error({ erro: resumirErroParaLog(erro) }, `Erro inesperado ao ${contexto}.`)
  return { erro: MENSAGEM_GENERICA }
}

async function exigirSessao() {
  exigirModulo('demandas')
  const sessao = await obterSessao()
  if (!sessao) redirect('/entrar')
  return sessao
}

function revalidar(id: string) {
  revalidatePath(`/demandas/${id}`)
  revalidatePath('/demandas')
}

async function decidir<T extends z.ZodRawShape>(
  form: FormData,
  forma: T,
  contexto: string,
  sucesso: string,
  executar: (
    sujeito: Awaited<ReturnType<typeof exigirSessao>>['sujeito'],
    dados: z.infer<z.ZodObject<T>>,
  ) => Promise<void>,
): Promise<EstadoDaDecisao> {
  const sessao = await exigirSessao()
  const bruto = Object.fromEntries(Object.keys(forma).map((k) => [k, form.get(k) ?? undefined]))
  const parse = z.object(forma).safeParse(bruto)
  if (!parse.success) return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  const id = (parse.data as { demandaId: string }).demandaId
  try {
    await executar(sessao.sujeito, parse.data)
    revalidar(id)
    return { sucesso }
  } catch (erro) {
    return traduzirErro(erro, contexto)
  }
}

export async function aprovarDesenhoAction(
  _estado: EstadoDaDecisao,
  form: FormData,
): Promise<EstadoDaDecisao> {
  return decidir(form, { demandaId, versao }, 'aprovar o desenho', 'Desenho aprovado.', (s, d) =>
    aprovarDesenho(s, d.demandaId, d.versao),
  )
}

export async function pedirAjusteAction(
  _estado: EstadoDaDecisao,
  form: FormData,
): Promise<EstadoDaDecisao> {
  const texto = z
    .string({ error: 'Escreva o ajuste.' })
    .trim()
    .min(1, 'Escreva o ajuste.')
    .max(500, 'O ajuste pode ter até 500 caracteres.')
  return decidir(form, { demandaId, versao, texto }, 'pedir ajuste', 'Ajuste enviado.', (s, d) =>
    pedirAjuste(s, d.demandaId, d.versao, d.texto),
  )
}

export async function decidirDestinoAction(
  _estado: EstadoDaDecisao,
  form: FormData,
): Promise<EstadoDaDecisao> {
  const destino = z.enum(['urgente', 'lote_da_noite', 'fila_de_agentes', 'orientada'], {
    error: 'Destino inválido.',
  })
  return decidir(form, { demandaId, destino }, 'decidir o destino', 'Destino escolhido.', (s, d) =>
    decidirDestino(s, d.demandaId, d.destino),
  )
}

export async function retomarDemandaAction(
  _estado: EstadoDaDecisao,
  form: FormData,
): Promise<EstadoDaDecisao> {
  const resposta = z
    .string({ error: 'Resposta inválida.' })
    .trim()
    .max(2000, 'A resposta pode ter até 2000 caracteres.')
    .optional()
  return decidir(
    form,
    { demandaId, resposta },
    'retomar a demanda',
    'A demanda voltou a andar.',
    (s, d) => retomarDemanda(s, d.demandaId, d.resposta),
  )
}

export async function concluirEtapaAction(
  _estado: EstadoDaDecisao,
  form: FormData,
): Promise<EstadoDaDecisao> {
  const chave = z.string().min(1, 'Etapa inválida.').max(60, 'Etapa inválida.')
  return decidir(form, { demandaId, chave }, 'concluir a etapa', 'Etapa concluída.', (s, d) =>
    concluirEtapaPeloPaulo(s, d.demandaId, d.chave),
  )
}

export async function encerrarDemandaAction(
  _estado: EstadoDaDecisao,
  form: FormData,
): Promise<EstadoDaDecisao> {
  return decidir(form, { demandaId }, 'encerrar a demanda', 'Demanda encerrada.', (s, d) =>
    encerrarDemanda(s, d.demandaId),
  )
}

const chaveDaParte = z.string().min(1, 'Parte inválida.').max(60, 'Parte inválida.')

/** "Conferi no ar": o Paulo confirma que a parte está no site (seção 4 da spec). */
export async function conferirNoArAction(
  demandaIdBruto: string,
  chaveBruta: string,
): Promise<EstadoDaDecisao> {
  const sessao = await exigirSessao()
  const parse = z.object({ demandaId, chave: chaveDaParte }).safeParse({
    demandaId: demandaIdBruto,
    chave: chaveBruta,
  })
  if (!parse.success) return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  try {
    await conferirNoArPeloPaulo(sessao.sujeito, parse.data.demandaId, parse.data.chave)
    revalidar(parse.data.demandaId)
    return { sucesso: 'Parte no ar.' }
  } catch (erro) {
    return traduzirErro(erro, 'conferir a parte no ar')
  }
}
