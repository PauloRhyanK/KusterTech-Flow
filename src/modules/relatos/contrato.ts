// O fio com os sistemas conectados (D83), no formato real da caixa de saída do Flow.ia /v1
// (contrato estendido de 20/11/2026). O Flow lê com `z.object`: campo a mais é descartado, então
// telefone, e-mail ou qualquer dado de contato nunca chega ao banco.
import { z } from 'zod'

export const RELATOS_POR_PAGINA = 50
export const PAGINAS_POR_BUSCA = 5
export const LIMITE_DO_CORPO_DA_PAGINA = 2_097_152
export const LIMITE_DA_RESPOSTA_DO_ANDAMENTO = 65_536
export const LIMITE_DA_MENSAGEM = 2000

export const ESTADOS_DO_ANDAMENTO = [
  'recebido',
  'na-fila',
  'em-andamento',
  'entregue',
  'recusado',
  'guardado',
] as const
export type EstadoDoAndamento = (typeof ESTADOS_DO_ANDAMENTO)[number]

const semControle = /^[^\p{Cc}]*$/u
const textoCurto = (max: number) =>
  z
    .string()
    .trim()
    .regex(semControle)
    .transform((v) => v.slice(0, max))
const dataHora = z.iso.datetime({ offset: true })

const autorSchema = z.object({
  id: z.string().min(1).max(100),
  nome: textoCurto(120).pipe(z.string().min(1)),
  papel: textoCurto(80),
})

const sinalSchema = z.object({
  tipo: z.enum(['comentario', 'reforco', 'urgencia']),
  autor: autorSchema,
  texto: z.string().max(2000),
  em: dataHora,
})
export type SinalDoFio = z.infer<typeof sinalSchema>

const anexoSchema = z.object({
  tipo: z.enum(['imagem', 'audio', 'video', 'arquivo']),
  url: z.string().min(1).max(2000),
  bytes: z.number().int().nonnegative(),
})
export type AnexoDoFio = z.infer<typeof anexoSchema>

const opcional = <T extends z.ZodType>(s: T) => s.nullish().transform((v) => v ?? null)

export const relatoDoFioSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/),
  em: dataHora,
  canal: z.enum(['sistema', 'whatsapp']),
  resultado: z.enum(['segue', 'orientado']),
  ticket: opcional(z.string().max(40)),
  /** Título e resumo escritos pelo sistema; opcionais (o Flow.ia de 20/11 ainda não os manda). */
  titulo: opcional(z.string().trim().max(200)),
  resumo: opcional(z.string().trim().max(4000)),
  /** Sugestão do sistema; a classificação que vale é a da triagem. */
  tipo: opcional(z.string().max(40)),
  autor: autorSchema,
  texto: z
    .string()
    .nullish()
    .transform((v) => v ?? ''),
  transcricao: opcional(z.string()),
  anexos: z.array(anexoSchema).max(20).default([]),
  contexto: z
    .object({ tela: opcional(z.string().max(120)), versao: opcional(z.string().max(40)) })
    .nullish()
    .transform((v) => v ?? { tela: null, versao: null }),
  sinais: z.array(sinalSchema).max(200).default([]),
  cursor: opcional(z.string().regex(/^[0-9]{1,30}$/)),
})
export type RelatoDoFio = z.infer<typeof relatoDoFioSchema>

const paginaSchema = z.object({
  relatos: z.array(z.unknown()).max(500),
  cursor: z.string().regex(/^[0-9]{1,30}$/),
})

export type PaginaLida =
  | { ok: true; relatos: RelatoDoFio[]; cursor: string; mais: boolean }
  | { ok: false; motivo: string }

/** `mais` não vem no fio: página cheia (tantos quanto o limite pedido) sugere outra. */
export function lerPagina(corpo: unknown, limitePedido: number): PaginaLida {
  const envelope = paginaSchema.safeParse(corpo)
  if (!envelope.success) return { ok: false, motivo: 'A resposta do sistema não segue o contrato.' }
  const relatos: RelatoDoFio[] = []
  for (const [i, bruto] of envelope.data.relatos.entries()) {
    const r = relatoDoFioSchema.safeParse(bruto)
    if (!r.success) {
      const id = (bruto as { id?: unknown } | null)?.id
      const quem = typeof id === 'string' && id.length <= 100 ? id : `na posição ${i + 1}`
      const caminho = r.error.issues[0]?.path.join('.') || 'relato'
      return { ok: false, motivo: `O relato ${quem} não segue o contrato: ${caminho}.` }
    }
    relatos.push(r.data)
  }
  return {
    ok: true,
    relatos,
    cursor: envelope.data.cursor,
    mais: relatos.length >= limitePedido,
  }
}

/** O corpo do `POST <base>/relatos/<id>/andamento`: estrito do lado do sistema, só estes dois campos. */
export interface AndamentoDoFio {
  estado: EstadoDoAndamento
  mensagem: string
}
