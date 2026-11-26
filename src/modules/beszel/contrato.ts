import { z } from 'zod'

// Formatos das coleções do Beszel 0.21 (PocketBase) que o Flow lê (D82). Objetos não estritos e
// números opcionais: o Beszel pode ganhar ou perder campos sem derrubar a tela.
const numero = z.number().optional()

export const sistemaSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  status: z.string(),
  updated: z.string(),
  info: z
    .object({
      cpu: numero,
      mp: numero,
      dp: numero,
      la: z.array(z.number()).optional(),
      u: numero,
      t: numero,
      bb: numero,
    })
    .nullish(),
})

export const amostraSchema = z.object({
  created: z.string(),
  stats: z.object({
    cpu: numero,
    m: numero,
    mu: numero,
    mp: numero,
    s: numero,
    su: numero,
    d: numero,
    du: numero,
    dp: numero,
    b: z.array(z.number()).optional(),
  }),
})

export const containerSchema = z.object({
  system: z.string(),
  name: z.string().min(1),
  cpu: numero,
  memory: numero,
  health: numero,
  status: z.string().optional(),
})

export type SistemaBruto = z.infer<typeof sistemaSchema>
export type AmostraBruta = z.infer<typeof amostraSchema>
export type ContainerBruto = z.infer<typeof containerSchema>
