import { z } from 'zod'

export const LIMITES = {
  planos: 50,
  avisos: 50,
  decisoes: 50,
  fases: 20,
  raias: 50,
  consertos: 20,
  arbitragens: 20,
  /** título de decisão, aviso e `pausado` */
  textoLongo: 300,
  /** demais textos */
  texto: 200,
  /** retrato v2 (escritório da Fábrica) */
  execucoes: 40,
  criterios: 20,
  linhas: 30,
  dependencias: 20,
  contas: 12,
} as const

export const ESTADOS_DA_FILA = [
  'aguardando',
  'admitindo',
  'ativo',
  'pausado',
  'concluido',
  'removido',
] as const
export const ESTADOS_DA_RAIA = ['planejada', 'executando', 'concluida', 'falhou'] as const
/** Os estados de um conserto de publicação que a Fábrica conta (`fabrica/scripts/consertos.py`). */
export const ESTADOS_DO_CONSERTO = ['em_curso', 'com_pr', 'desistiu'] as const

const texto = z.string().min(1).max(LIMITES.texto)
const textoLongo = z.string().min(1).max(LIMITES.textoLongo)
const inteiro = z.number().int().nonnegative()

/** Instante UTC `AAAA-MM-DDTHH:MM:SSZ`, e uma data que existe. */
export const instante = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  .refine((v) => {
    const ms = Date.parse(v)
    return !Number.isNaN(ms) && new Date(ms).toISOString() === v.replace('Z', '.000Z')
  }, 'instante inválido')

export const urlGithub = z
  .string()
  .max(LIMITES.texto)
  .refine((v) => {
    if (!v.startsWith('https://github.com/')) return false
    try {
      const u = new URL(v)
      return (
        u.protocol === 'https:' &&
        u.hostname === 'github.com' &&
        !u.username &&
        !u.password &&
        !u.port
      )
    } catch {
      return false
    }
  }, 'url deve ser https://github.com/')

const raia = z.strictObject({ id: texto, estado: z.enum(ESTADOS_DA_RAIA) })

const fase = z.strictObject({ id: texto, raias: z.array(raia).max(LIMITES.raias) })

const decisao = z.strictObject({ titulo: textoLongo, url: urlGithub })

const plano = z.strictObject({
  id: texto,
  repo: texto,
  feature: texto,
  estado: z.enum(ESTADOS_DA_FILA),
  entrouEm: instante,
  faseAtual: texto.nullable(),
  fases: z.array(fase).max(LIMITES.fases),
  pausado: textoLongo.nullable(),
  decisoes: z.array(decisao).max(LIMITES.decisoes),
  orquestradorAtivo: z.boolean(),
})

// O estado de um pedido de conserto da resposta, contado de volta pela Fábrica.
const conserto = z.strictObject({
  id: z.string().uuid(),
  estado: z.enum(ESTADOS_DO_CONSERTO),
  runId: texto.nullable(),
  prUrl: urlGithub.nullable(),
  motivo: textoLongo.nullable(),
  em: instante,
})

// O que o árbitro técnico resolveu sem chamar o Paulo (`arbitragens` do estado de cada plano).
const arbitragem = z.strictObject({
  em: instante,
  repo: texto,
  feature: texto,
  assunto: textoLongo,
  travou: textoLongo.nullable(),
  decidido: textoLongo.nullable(),
  muda: textoLongo.nullable(),
  prUrl: urlGithub.nullable(),
})

export const retratoV1Schema = z.strictObject({
  versao: z.literal(1),
  geradoEm: instante,
  vagas: z.strictObject({
    efetivas: inteiro,
    configuradas: inteiro,
    ocupadas: inteiro,
    ramMinimaMb: inteiro,
    memDisponivelMb: inteiro.nullable(),
    oomEm: instante.nullable(),
  }),
  drenagem: instante.nullable(),
  warren: z.strictObject({ preparo: texto.nullable(), em: instante.nullable() }),
  planos: z.array(plano).max(LIMITES.planos),
  avisos: z.array(z.strictObject({ em: instante, mensagem: textoLongo })).max(LIMITES.avisos),
  /** Opcional: o coordenador sem consertos (ou o antigo) manda o v1 de sempre. */
  consertos: z.array(conserto).max(LIMITES.consertos).optional(),
  /** Opcional: só vem quando o árbitro técnico resolveu algo; o kit antigo não manda. */
  arbitragens: z.array(arbitragem).max(LIMITES.arbitragens).optional(),
})

export type RetratoV1 = z.infer<typeof retratoV1Schema>

// ---------------------------------------------------------------- v2: escritório da Fábrica

export const TIPOS_DE_LINHA = ['texto', 'ferramenta', 'estado'] as const

const raiaV2 = z.strictObject({
  id: texto,
  estado: z.enum(ESTADOS_DA_RAIA),
  papel: texto.nullable(),
  dependeDe: z.array(texto).max(LIMITES.dependencias),
  criterios: z.array(texto).max(LIMITES.criterios),
  seedId: texto.nullable(),
  inicio: instante.nullable(),
  fim: instante.nullable(),
  prUrl: urlGithub.nullable(),
  situacao: texto.nullable(),
  criteriosVeredito: z
    .array(z.strictObject({ indice: inteiro, cumprido: z.boolean() }))
    .max(LIMITES.criterios)
    .nullable(),
})

const faseV2 = z.strictObject({ id: texto, raias: z.array(raiaV2).max(LIMITES.raias) })

const planoV2 = plano.extend({
  fases: z.array(faseV2).max(LIMITES.fases),
  demanda: texto.nullable(),
})

const linha = z.strictObject({ em: instante.nullable(), tipo: z.enum(TIPOS_DE_LINHA), texto })

const contaDoExecutor = z.strictObject({
  agente: texto,
  conta: texto,
  esgotadaAte: instante.nullable(),
})

const execucao = z.strictObject({
  runId: texto,
  papel: texto.nullable(),
  planoId: texto.nullable(),
  raia: texto.nullable(),
  demanda: texto.nullable(),
  estado: texto.nullable(),
  inicio: instante.nullable(),
  custoUsd: z.number().nonnegative().max(1_000_000).nullable(),
  modelo: texto.nullable(),
  /** Opcionais: o coordenador anterior ao executor por papel não manda estes três. */
  agente: texto.nullable().optional(),
  conta: texto.nullable().optional(),
  substituiu: z
    .strictObject({ agente: texto, conta: texto.nullable(), motivo: texto })
    .nullable()
    .optional(),
  ultimaAcao: z.strictObject({ texto, em: instante.nullable() }).nullable(),
  linhas: z.array(linha).max(LIMITES.linhas),
})

export const retratoV2Schema = retratoV1Schema.extend({
  versao: z.literal(2),
  planos: z.array(planoV2).max(LIMITES.planos),
  execucoes: z.array(execucao).max(LIMITES.execucoes),
  /** Opcional: sem ele, nenhuma conta esgotada é mostrada. */
  contas: z.array(contaDoExecutor).max(LIMITES.contas).optional(),
})

export type RetratoV2 = z.infer<typeof retratoV2Schema>
export type RaiaV2 = RetratoV2['planos'][number]['fases'][number]['raias'][number]
export type ExecucaoV2 = RetratoV2['execucoes'][number]

export const retratoSchema = z.discriminatedUnion('versao', [retratoV1Schema, retratoV2Schema])
export type Retrato = z.infer<typeof retratoSchema>

/** O v1 vira v2 com os campos novos vazios, para a tela ler um formato só. */
export function normalizarRetrato(r: Retrato): RetratoV2 {
  if (r.versao === 2) return r
  return {
    ...r,
    versao: 2,
    planos: r.planos.map((p) => ({
      ...p,
      demanda: null,
      fases: p.fases.map((f) => ({
        ...f,
        raias: f.raias.map((raia) => ({
          ...raia,
          papel: null,
          dependeDe: [],
          criterios: [],
          seedId: null,
          inicio: null,
          fim: null,
          prUrl: null,
          situacao: null,
          criteriosVeredito: null,
        })),
      })),
    })),
    execucoes: [],
  }
}
