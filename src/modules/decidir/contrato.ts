import { z } from 'zod'
import type { Acao } from './cartao'
import type { TipoDeItem } from './model'

export const LIMITE_DO_CORPO_DA_RESPOSTA = 32_768
export const LIMITE_DE_CONVERSAS = 5
export const LIMITE_DE_MENSAGENS_NO_FIO = 30
export const ATIVA_POR_MS = 10 * 60_000
export const LIMITE_DA_MENSAGEM = 4000
export const LIMITE_DA_RESPOSTA_RAPIDA = 60
export const MAXIMO_DE_RESPOSTAS_RAPIDAS = 4
export const LIMITE_DA_FALHA = 200

// Aparar, não vazio, e sem caractere de controle fora de \n e \t.
const CONTROLE = /[\u0000-\u0008\u000B-\u001F\u007F]/
const texto = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !CONTROLE.test(v), 'caractere de controle')

export const respostaDoAtendenteSchema = z.union([
  z.strictObject({
    id: z.uuid(),
    emRespostaA: z.uuid(),
    mensagem: texto(1, LIMITE_DA_MENSAGEM),
    respostasRapidas: z
      .array(texto(1, LIMITE_DA_RESPOSTA_RAPIDA))
      .max(MAXIMO_DE_RESPOSTAS_RAPIDAS)
      .default([]),
    cartao: z.unknown().nullable().default(null),
  }),
  z.strictObject({
    id: z.uuid(),
    emRespostaA: z.uuid(),
    falha: texto(1, LIMITE_DA_FALHA),
  }),
])

export type RespostaDoAtendente = z.infer<typeof respostaDoAtendenteSchema>

/** Instantes no formato `AAAA-MM-DDTHH:MM:SSZ`. */
export interface ConversaParaOAtendente {
  id: string
  repositorio: string
  responderA: string
  aguardaDesde: string
  item: {
    chave: string
    tipo: TipoDeItem
    titulo: string
    pergunta: string
    fatos: string[]
    /** Descrição da demanda ou corpo da issue lido ao abrir (até 4000). */
    relato: string | null
    acoes: Acao[]
  }
  mensagens: {
    id: string
    autor: 'paulo' | 'agente' | 'flow'
    texto: string
    respostaRapida: string | null
    anexos: { nome: string; conteudo: string }[]
    em: string
  }[]
}

export interface BuscaDoAtendente {
  conversas: ConversaParaOAtendente[]
  /** Última mensagem do Paulo em conversa aberta + ATIVA_POR_MS; depois disso o atendente dorme. */
  ativaAte: string | null
}
