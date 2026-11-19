import { z } from 'zod'

// Formatos dos arquivos gravados pelos scripts da oficina. Objetos não estritos:
// os scripts podem ganhar campos sem quebrar o Flow.
const dataComFuso = z.iso.datetime({ offset: true })

export const amostraSchema = z.object({
  em: dataComFuso,
  memTotalMb: z.number(),
  memDisponivelMb: z.number(),
  swapUsadaMb: z.number(),
  carga1: z.number().nullable(),
  discoUsoPct: z.number().nullable(),
  jobsCi: z.number(),
  vagas: z.number().nullable(),
  raias: z.number().nullable(),
  cpuUsoPct: z.number().nullable().optional(),
  discoLivreBytes: z.number().optional(),
  discoTotalBytes: z.number().optional(),
})

export const avisoSchema = z.object({
  em: dataComFuso,
  origem: z.string(),
  tipo: z.string(),
  severidade: z.string(),
  mensagem: z.string(),
})

export const limpezaSchema = z.object({
  em: dataComFuso,
  ok: z.boolean(),
  livreAntesBytes: z.number(),
  livreDepoisBytes: z.number(),
  liberadoBytes: z.number(),
})

export const limpezaUltimaSchema = z.object({
  em: dataComFuso,
  liberadoBytes: z.number(),
  usoPct: z.number(),
  limitePct: z.number(),
})

export const retratoDaMaquinaSchema = z.object({
  em: dataComFuso,
  ligadaDesde: dataComFuso,
  containers: z.array(
    z.object({
      nome: z.string(),
      estado: z.enum(['rodando', 'parado']),
      codigoDeSaida: z.number().nullable(),
      memoriaBytes: z.number().nullable(),
      cpuPct: z.number().nullable(),
      desde: dataComFuso,
    }),
  ),
  servicos: z.object({
    fabrica: z.enum(['ativa', 'parada']),
    runners: z.object({ noAr: z.number(), ocupados: z.number(), total: z.number() }),
  }),
})

export const discoPorDonoSchema = z.object({
  em: dataComFuso,
  donos: z.array(
    z.object({
      nome: z.enum(['docker', 'fabrica', 'runners', 'backups', 'outros']),
      bytes: z.number(),
    }),
  ),
})

export type Amostra = z.infer<typeof amostraSchema>
export type AvisoRegistrado = z.infer<typeof avisoSchema>
export type Limpeza = z.infer<typeof limpezaSchema>
export type LimpezaUltima = z.infer<typeof limpezaUltimaSchema>
export type RetratoDaMaquina = z.infer<typeof retratoDaMaquinaSchema>
export type DiscoPorDono = z.infer<typeof discoPorDonoSchema>
