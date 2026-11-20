import { z } from 'zod'
import { instante, urlGithub } from '../fabrica/contrato'

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
})

const evento = <T extends string, D extends z.ZodType>(tipo: T, dados: D) =>
  z.strictObject({ tipo: z.literal(tipo), dados })

export const eventoDaFabricaSchema = z.intersection(
  z.strictObject({ id: uuid, em: instante }),
  z.discriminatedUnion('tipo', [
    evento('triagem', triagemSchema),
    evento('triagem_falhou', z.strictObject({ motivo: texto300 })),
    evento('plano_criado', z.strictObject({ plano: caminhoDoPlano, prUrl: urlGithub.nullable() })),
    evento('desenho_pronto', z.strictObject({ arquivoId: uuid })),
    evento('etapa_concluida', z.strictObject({ marco: z.enum(['desenvolvida', 'entregue']) })),
    evento('travada', z.strictObject({ motivo: texto300, url: urlGithub.nullable() })),
    evento('destravada', z.strictObject({})),
    evento(
      'teste',
      z.strictObject({
        resultado: z.enum(['passou', 'falhou']),
        resumo: texto2000,
        capturas: z.array(uuid).max(20),
      }),
    ),
    evento('entregue', z.strictObject({ prs: z.array(urlGithub).max(20) })),
  ]),
)

export type EventoDaFabrica = z.infer<typeof eventoDaFabricaSchema>

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
