import { z } from 'zod'

export const LIMITES = {
  planos: 50,
  avisos: 50,
  decisoes: 50,
  fases: 20,
  raias: 50,
  /** título de decisão, aviso e `pausado` */
  textoLongo: 300,
  /** demais textos */
  texto: 200,
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

const texto = z.string().min(1).max(LIMITES.texto)
const textoLongo = z.string().min(1).max(LIMITES.textoLongo)
const inteiro = z.number().int().nonnegative()

/** Instante UTC `AAAA-MM-DDTHH:MM:SSZ`, e uma data que existe. */
const instante = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  .refine((v) => {
    const ms = Date.parse(v)
    return !Number.isNaN(ms) && new Date(ms).toISOString() === v.replace('Z', '.000Z')
  }, 'instante inválido')

const urlGithub = z
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
})

export type RetratoV1 = z.infer<typeof retratoV1Schema>
