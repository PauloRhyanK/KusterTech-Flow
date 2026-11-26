import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import type { TelaDeDemandas } from '../apresentacao'
import { opcoesDosFiltros } from '../queries'
import type { ItemDaBusca } from './model'
import { buscasRestantes } from './service'

export interface ItemNaTela {
  demandaId: string
  titulo: string
  href: string
  relevancia: ItemDaBusca['relevancia']
  motivo: string
}

export interface LinhaDaBusca {
  id: string
  pergunta: string
  estado: 'pendente' | 'em_curso' | 'concluida' | 'falhou'
  criadaEm: Date
  resumo: string | null
  falha: string | null
  itens: ItemNaTela[]
  custoUsd: number | null
  tokens: number | null
}

export interface TelaDaBusca {
  atual: LinhaDaBusca | null
  historico: LinhaDaBusca[]
  mes: { buscas: number; custoUsd: number }
  restantesHoje: number
  opcoes: TelaDeDemandas['opcoes']
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIMITE_DO_HISTORICO = 20

const SELECAO = {
  id: true,
  pergunta: true,
  estado: true,
  criadaEm: true,
  resumo: true,
  falha: true,
  itens: true,
  custoUsd: true,
  tokensEntrada: true,
  tokensSaida: true,
} as const

type Linha = {
  id: string
  pergunta: string
  estado: 'PENDENTE' | 'EM_CURSO' | 'CONCLUIDA' | 'FALHOU'
  criadaEm: Date
  resumo: string | null
  falha: string | null
  itens: unknown
  custoUsd: number | null
  tokensEntrada: number | null
  tokensSaida: number | null
}

/** O primeiro instante do mês corrente em São Paulo (UTC−3, sem horário de verão). */
function inicioDoMes(agora: Date): Date {
  const [ano, mes] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  })
    .format(agora)
    .split('-')
  return new Date(`${ano}-${mes}-01T03:00:00.000Z`)
}

const itensDe = (v: unknown): ItemDaBusca[] => (Array.isArray(v) ? (v as ItemDaBusca[]) : [])

function naTela(l: Linha, titulos: Map<string, string>): LinhaDaBusca {
  const tokens =
    l.tokensEntrada === null && l.tokensSaida === null
      ? null
      : (l.tokensEntrada ?? 0) + (l.tokensSaida ?? 0)
  return {
    id: l.id,
    pergunta: l.pergunta,
    estado: l.estado.toLowerCase() as LinhaDaBusca['estado'],
    criadaEm: l.criadaEm,
    resumo: l.resumo,
    falha: l.falha,
    itens: itensDe(l.itens).flatMap((i) => {
      const titulo = titulos.get(i.demandaId)
      return titulo === undefined ? [] : [{ ...i, titulo, href: `/demandas/${i.demandaId}` }]
    }),
    custoUsd: l.custoUsd,
    tokens,
  }
}

/** A tela da busca: a busca aberta, as 20 últimas, o gasto do mês e quantas ainda cabem hoje. */
export async function obterTelaDaBusca(
  sujeito: Sujeito,
  buscaId: string | null,
  agora: Date,
  env: Record<string, string | undefined> = process.env,
): Promise<TelaDaBusca> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  const [historico, atual, mes, restantesHoje, opcoes] = await Promise.all([
    db.buscaDeDemandas.findMany({
      orderBy: [{ criadaEm: 'desc' }, { id: 'desc' }],
      take: LIMITE_DO_HISTORICO,
      select: SELECAO,
    }),
    buscaId && UUID.test(buscaId)
      ? db.buscaDeDemandas.findUnique({ where: { id: buscaId }, select: SELECAO })
      : null,
    db.buscaDeDemandas.aggregate({
      where: { criadaEm: { gte: inicioDoMes(agora) }, tokensDoLote: { gt: 0 } },
      _count: true,
      _sum: { custoUsd: true },
    }),
    buscasRestantes(agora, env),
    opcoesDosFiltros(),
  ])
  const ids = [...historico, ...(atual ? [atual] : [])].flatMap((l) =>
    itensDe(l.itens).map((i) => i.demandaId),
  )
  const demandas = ids.length
    ? await db.demanda.findMany({
        where: { id: { in: [...new Set(ids)] } },
        select: { id: true, titulo: true },
      })
    : []
  const titulos = new Map(demandas.map((d) => [d.id, d.titulo]))
  return {
    atual: atual ? naTela(atual as Linha, titulos) : null,
    historico: historico.map((l) => naTela(l as Linha, titulos)),
    mes: {
      buscas: mes._count,
      custoUsd: Math.round((mes._sum.custoUsd ?? 0) * 10_000) / 10_000,
    },
    restantesHoje,
    opcoes,
  }
}
