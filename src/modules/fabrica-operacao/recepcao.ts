/**
 * Recepção HTTP do worker da Fábrica 2.0: autentica pelo token `fw_`, valida o corpo e chama o serviço.
 * Sem sessão de usuário: o token é a autorização.
 */
import { z } from 'zod'
import { log } from '@/lib/log'
import type { EntradaDaRecepcao } from '@/modules/fabrica/recepcao'
import { resumirErroParaLog } from '@/modules/github/model'
import {
  autenticarWorker,
  pegarTarefa,
  receberResultado,
  sinalizar,
  type TarefaParaWorker,
} from './service'

type Saida<S extends number> = { status: S; corpo: object }

export const LIMITE_DO_CORPO_DO_WORKER = 16_384
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NAO_AUTORIZADO = { erro: 'Não autorizado.' }
const INVALIDO = { status: 422, corpo: { erro: 'Corpo inválido.' } } as const
const texto = (max: number) => z.string().min(1).max(max)
const geracao = z.number().int().min(1)

export const resultadoSchema = z.discriminatedUnion('tipo', [
  z.strictObject({ tipo: z.literal('pr_aberto'), prUrl: z.string().url().max(500) }),
  z.strictObject({ tipo: z.literal('sem_pr') }),
  z.strictObject({ tipo: z.literal('falha_tecnica'), motivo: texto(500) }),
  z.strictObject({
    tipo: z.literal('limite_de_uso'),
    retornoEm: z.string().datetime({ offset: true }).nullable(),
  }),
  z.strictObject({ tipo: z.literal('erro_de_configuracao'), motivo: texto(500) }),
  z.strictObject({ tipo: z.literal('saida_invalida'), motivo: texto(500) }),
  z.strictObject({ tipo: z.literal('cancelada') }),
  z.strictObject({ tipo: z.literal('incerto') }),
])

const envioSchema = z.strictObject({
  idExterno: texto(100),
  geracao,
  resultado: resultadoSchema,
})
const sinalSchema = z.strictObject({ geracao })

function falhaInterna(erro: unknown, o: string): Saida<500> {
  log.error({ erro: resumirErroParaLog(erro) }, `recepção do worker da Fábrica falhou: ${o}`)
  return { status: 500, corpo: { erro: 'Falha interna.' } }
}

/** Lê e valida o corpo JSON; devolve a saída de erro ou os dados. */
async function lerCorpo<T>(
  e: EntradaDaRecepcao,
  schema: z.ZodType<T>,
): Promise<{ erro: Saida<413 | 415 | 422> } | { dados: T }> {
  if (!(e.contentType ?? '').toLowerCase().includes('application/json')) {
    return { erro: { status: 415, corpo: { erro: 'Envie o corpo como application/json.' } } }
  }
  const grande = { status: 413, corpo: { erro: 'Corpo maior que 16 KB.' } } as const
  if (e.contentLength !== null && Number(e.contentLength) > LIMITE_DO_CORPO_DO_WORKER) {
    return { erro: grande }
  }
  const bruto = await e.corpo()
  if (Buffer.byteLength(bruto, 'utf8') > LIMITE_DO_CORPO_DO_WORKER) return { erro: grande }
  let json: unknown
  try {
    json = JSON.parse(bruto)
  } catch {
    return { erro: INVALIDO }
  }
  const lido = schema.safeParse(json)
  return lido.success ? { dados: lido.data } : { erro: INVALIDO }
}

export async function pedirTarefa(
  authorization: string | null,
  agora: Date,
): Promise<Saida<200 | 401 | 500>> {
  try {
    const worker = await autenticarWorker(authorization)
    if (worker === null) return { status: 401, corpo: NAO_AUTORIZADO }
    const tarefa: TarefaParaWorker | null = await pegarTarefa(worker.id, agora)
    return { status: 200, corpo: { tarefa } }
  } catch (erro) {
    return falhaInterna(erro, 'tarefa')
  }
}

export async function receberSinal(
  execucaoId: string,
  e: EntradaDaRecepcao,
  agora: Date,
): Promise<Saida<200 | 401 | 404 | 409 | 413 | 415 | 422 | 500>> {
  try {
    const worker = await autenticarWorker(e.authorization)
    if (worker === null) return { status: 401, corpo: NAO_AUTORIZADO }
    const lido = await lerCorpo(e, sinalSchema)
    if ('erro' in lido) return lido.erro
    if (!UUID.test(execucaoId)) return { status: 404, corpo: { erro: 'Execução não encontrada.' } }
    const r = await sinalizar(worker.id, execucaoId, lido.dados.geracao, agora)
    // obsoleto: a reserva não é mais deste worker; ele deve parar a execução
    return r === 'renovado'
      ? { status: 200, corpo: { resultado: r } }
      : { status: 409, corpo: { resultado: r } }
  } catch (erro) {
    return falhaInterna(erro, 'sinal')
  }
}

export async function receberResultadoDoWorker(
  execucaoId: string,
  e: EntradaDaRecepcao,
  agora: Date,
): Promise<Saida<200 | 401 | 404 | 409 | 413 | 415 | 422 | 500>> {
  try {
    const worker = await autenticarWorker(e.authorization)
    if (worker === null) return { status: 401, corpo: NAO_AUTORIZADO }
    const lido = await lerCorpo(e, envioSchema)
    if ('erro' in lido) return lido.erro
    if (!UUID.test(execucaoId)) return { status: 404, corpo: { erro: 'Execução não encontrada.' } }
    const r = await receberResultado(worker.id, { ...lido.dados, execucaoId }, agora)
    return r === 'conflito'
      ? { status: 409, corpo: { resultado: r } }
      : { status: 200, corpo: { resultado: r } }
  } catch (erro) {
    return falhaInterna(erro, 'resultado')
  }
}
