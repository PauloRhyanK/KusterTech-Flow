import { z } from 'zod'
import { instante, urlGithub } from '../fabrica/contrato'
import { RESULTADOS_SEM_PLANO, UUID_DA_DEMANDA } from './model'

export const LIMITE_DO_CORPO_DO_EVENTO = 65_536
export const LIMITE_DO_CORPO_DA_DEMANDA = 42 * 1024 * 1024
export const LIMITE_DO_CORPO_DO_PLANO = 16_384
export const PREFIXO_DO_TOKEN_DE_DEMANDAS = 'fd_'
export const LIMITE_DA_PAGINA = 50

export const TIPOS = ['defeito', 'ideia', 'ajuste', 'funcao_nova'] as const
export const DESTINOS = [
  'urgente',
  'lote_da_noite',
  'fila_de_agentes',
  'decisao_do_paulo',
  'orientada',
] as const
export const NIVEIS = ['planejar_comigo', 'aprovar_desenho', 'vai_sozinho'] as const

const texto80 = z.string().min(1).max(80)
const texto200 = z.string().min(1).max(200)
const texto300 = z.string().min(1).max(300)
const texto2000 = z.string().min(1).max(2000)
const texto4000 = z.string().min(1).max(4000)
const uuid = z.string().uuid()

const caminhoDoPlano = z.string().regex(/^\.fabrica\/planos\/[a-z0-9]+(-[a-z0-9]+)*\.json$/)

const nomeDeArquivo = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_. -]*$/)

const repoSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  .max(200)

const urlDoArtefato = z
  .string()
  .max(500)
  .refine((v) => {
    if (!v.startsWith('https://claude.ai/')) return false
    try {
      const u = new URL(v)
      return (
        u.protocol === 'https:' &&
        u.hostname === 'claude.ai' &&
        !u.username &&
        !u.password &&
        !u.port
      )
    } catch {
      return false
    }
  }, 'url deve ser https://claude.ai/')

export const impactoSchema = z.strictObject({
  toca: z.array(texto200).max(10),
  podeQuebrar: z.array(texto200).max(10),
  autorizacao: z.boolean(),
  caminhoProtegido: z.boolean(),
})

/**
 * O plano curto que a triagem traz quando a demanda pede decisão de produto (ideia, função nova ou
 * destino `decisao_do_paulo`): o que a pessoa quer, o que mudaria nas telas, as opções com tamanho,
 * os conflitos com decisões vigentes em linguagem simples e a recomendação. Opcional: um kit antigo
 * não o manda.
 */
export const planoDaTriagemSchema = z.strictObject({
  pedido: texto2000,
  muda: z.array(texto300).max(8),
  opcoes: z
    .array(
      z.strictObject({
        nome: texto80,
        tamanho: z.enum(['pequeno', 'medio', 'grande']),
        descricao: texto300,
      }),
    )
    .max(4),
  conflitos: z.array(z.strictObject({ decisao: texto200, explicacao: texto300 })).max(5),
  recomendacao: texto300,
})
export type PlanoDaTriagem = z.infer<typeof planoDaTriagemSchema>

export const triagemSchema = z.strictObject({
  tipo: z.enum(TIPOS),
  destino: z.enum(DESTINOS),
  tamanho: z.enum(['pequeno', 'medio', 'grande']),
  mexeEm: texto80,
  risco: z.enum(['baixo', 'medio', 'alto']),
  dados: z.enum(['nenhum', 'so_leitura', 'escrita', 'migracao']),
  impacto: impactoSchema,
  resposta: texto4000.nullable(),
  motivo: texto300,
  plano: planoDaTriagemSchema.nullable().optional(),
})

const evento = <T extends string, D extends z.ZodType>(tipo: T, dados: D) =>
  z.strictObject({ tipo: z.literal(tipo), dados })

const chaveDaParte = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(60)
const sha = z.string().regex(/^[0-9a-f]{40}$/)

export const parteDeclaradaSchema = z.strictObject({
  chave: chaveDaParte,
  repositorio: z
    .string()
    .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/)
    .max(200),
  objetivo: texto300,
  ordem: z.number().int().min(0).max(1000),
  dependeDe: z.array(chaveDaParte).max(10),
  chegaAoAr: z.enum(['publicacao', 'versao']),
})

const eventosComuns = [
  evento('triagem', triagemSchema),
  evento('triagem_falhou', z.strictObject({ motivo: texto300 })),
  evento('plano_criado', z.strictObject({ plano: caminhoDoPlano, prUrl: urlGithub.nullable() })),
  evento('desenho_pronto', z.strictObject({ arquivoId: uuid })),
  evento('etapa_concluida', z.strictObject({ marco: z.enum(['desenvolvida', 'entregue']) })),
  evento(
    'travada',
    z.strictObject({
      motivo: texto300,
      url: urlGithub.nullable(),
      // O orquestrador concluiu que não há plano (duplicada, já resolvida): o Flow oferece encerrar.
      desfecho: z
        .strictObject({
          resultado: z.enum(RESULTADOS_SEM_PLANO),
          de: z.string().regex(UUID_DA_DEMANDA).nullable(),
        })
        .optional(),
    }),
  ),
  evento('destravada', z.strictObject({})),
  evento(
    'teste',
    z.strictObject({
      resultado: z.enum(['passou', 'falhou']),
      resumo: texto2000,
      capturas: z.array(uuid).max(20),
    }),
  ),
] as const

const cabecalho = z.strictObject({ id: uuid, em: instante })

export const eventoDaFabricaSchema = z.intersection(
  cabecalho,
  z.discriminatedUnion('tipo', [
    ...eventosComuns,
    evento('entregue', z.strictObject({ prs: z.array(urlGithub).max(20) })),
  ]),
)

/** Contrato 2: sem `entregue`; com as partes por repositório. */
export const eventoDaFabricaV2Schema = z.intersection(
  cabecalho,
  z.discriminatedUnion('tipo', [
    ...eventosComuns,
    evento(
      'partes_planejadas',
      z.strictObject({ partes: z.array(parteDeclaradaSchema).min(1).max(10) }),
    ),
    evento(
      'parte_planejada',
      z.strictObject({ parte: chaveDaParte, plano: caminhoDoPlano, prUrl: urlGithub.nullable() }),
    ),
    evento(
      'parte_feita',
      z.strictObject({
        parte: chaveDaParte,
        prs: z
          .array(
            z.strictObject({
              url: urlGithub,
              numero: z.number().int().positive(),
              mergeCommit: sha,
            }),
          )
          .min(1)
          .max(40),
        commit: sha,
        pendencias: z.array(texto300).max(20),
      }),
    ),
  ]),
)

/** `X-Fabrica-Contrato: 2` fala o contrato 2; qualquer outra coisa, o 1. */
export function versaoDoContrato(cabecalhoHttp: string | null): 1 | 2 {
  return cabecalhoHttp?.trim() === '2' ? 2 : 1
}

export type EventoDaFabrica = z.infer<typeof eventoDaFabricaSchema>
export type EventoDaFabricaV2 = z.infer<typeof eventoDaFabricaV2Schema>

export const demandaDaSessaoSchema = z.strictObject({
  repositorio: repoSchema,
  titulo: z.string().trim().min(1).max(120),
  descricao: z.string().trim().max(4000).optional(),
  tipo: z.enum(TIPOS).optional(),
  nivel: z.enum(NIVEIS).optional(),
  temTela: z.boolean(),
  chave: z.string().min(1).max(100).optional(),
  anexos: z
    .array(z.strictObject({ nome: nomeDeArquivo, conteudo: z.string(), base64: z.string() }))
    .max(3)
    .optional(),
})

export const planoDaSessaoSchema = z.strictObject({
  id: uuid.optional(),
  plano: caminhoDoPlano,
  resumo: z.string().trim().max(2000).optional(),
  artefato: urlDoArtefato.optional(),
})
