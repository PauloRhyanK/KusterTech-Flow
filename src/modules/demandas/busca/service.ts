import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { autenticarFonte, type EntradaDaRecepcao } from '@/modules/fabrica/recepcao'
import { resumirErroParaLog } from '@/modules/github/model'
import type { FiltrosDaTabela } from '../model'
import { ondeDaTabela } from '../queries'
import { jsonCanonico } from '../transicoes'
import {
  LIMITE_DO_CORPO_DA_BUSCA,
  respostaDaBuscaSchema,
  type BuscaParaAFabrica,
  type RespostaDaBusca,
  type TextoParaAFabrica,
} from './contrato'
import {
  ABANDONADA_APOS_MS,
  LIMITE_DE_CANDIDATAS,
  estimarTokens,
  fichaDaDemanda,
  itensValidos,
  lerLimites,
  normalizarPergunta,
  textoCompleto,
  type FonteDaFicha,
} from './model'

type Saida<S extends number> = { status: S; corpo: object }

const DIA_MS = 24 * 60 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NAO_AUTORIZADO = { erro: 'Token inválido.' }
const NAO_ENCONTRADA = { erro: 'Busca não encontrada.' }
const SEM_DEMANDAS = 'Nenhuma demanda neste recorte.'

/** O que a ficha e o texto completo leem de cada demanda. */
const SELECAO = {
  id: true,
  titulo: true,
  descricao: true,
  tipo: true,
  espera: true,
  naoChegouDesde: true,
  encerrada: true,
  triagem: true,
  criadaEm: true,
  atualizadaEm: true,
  projeto: {
    select: { nome: true, clientes: { select: { cliente: { select: { nome: true } } } } },
  },
  partes: { select: { objetivo: true }, orderBy: { ordem: 'asc' as const } },
} as const

type LinhaDaDemanda = {
  id: string
  titulo: string
  descricao: string | null
  tipo: string | null
  espera: string | null
  naoChegouDesde: Date | null
  encerrada: string | null
  triagem: unknown
  criadaEm: Date
  atualizadaEm: Date
  projeto: { nome: string; clientes: { cliente: { nome: string } }[] }
  partes: { objetivo: string | null }[]
}

function estadoDaFicha(d: LinhaDaDemanda): string {
  if (d.encerrada) return d.encerrada
  if (d.espera) return 'espera_voce'
  return d.naoChegouDesde ? 'nao_chegou' : 'a_caminho'
}

function fonteDaFicha(d: LinhaDaDemanda): FonteDaFicha {
  return {
    id: d.id,
    titulo: d.titulo,
    projeto: d.projeto.nome,
    clientes: d.projeto.clientes.map((c) => c.cliente.nome).sort((a, b) => a.localeCompare(b)),
    tipo: d.tipo ? d.tipo.toLowerCase() : null,
    estado: estadoDaFicha(d),
    criadaEm: d.criadaEm,
    atualizadaEm: d.atualizadaEm,
    descricao: d.descricao,
    objetivos: d.partes.map((p) => p.objetivo ?? ''),
  }
}

const chaveDoLote = (ids: readonly string[]) =>
  createHash('sha256')
    .update([...ids].sort().join(','))
    .digest('hex')

/** As buscas que contam no teto: as que foram (ou vão) à Fábrica, nas últimas 24 h. */
const contaNoTeto = (agora: Date) => ({
  criadaEm: { gt: new Date(agora.getTime() - DIA_MS) },
  tokensDoLote: { gt: 0 },
})

/**
 * Pede uma busca. A mesma pergunta no mesmo lote, concluída, pendente ou em curso nas últimas 24 h,
 * devolve a existente.
 * Lote vazio conclui na hora. O teto diário e o do lote são conferidos numa transação travada.
 */
export async function pedirBusca(
  sujeito: Sujeito,
  entrada: { pergunta: string; filtros: FiltrosDaTabela },
  agora: Date,
  env: Record<string, string | undefined> = process.env,
): Promise<{ id: string; reaproveitada: boolean }> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  const pergunta = entrada.pergunta.trim()
  if (pergunta.length < 3 || pergunta.length > 500) {
    throw new ErroDeDominio('Descreva o que procura em 3 a 500 caracteres.')
  }
  const limites = lerLimites(env)
  const demandas = await db.demanda.findMany({
    where: { projeto: { arquivadoEm: null }, ...ondeDaTabela(entrada.filtros, agora) },
    orderBy: [{ atualizadaEm: 'desc' }, { id: 'asc' }],
    select: SELECAO,
  })
  const fichas = demandas.map((d) => fichaDaDemanda(fonteDaFicha(d as LinhaDaDemanda)))
  const loteIds = fichas.map((f) => f.id)
  const chave = chaveDoLote(loteIds)
  const perguntaNormalizada = normalizarPergunta(pergunta)
  const tokensDoLote = estimarTokens(fichas)

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('buscas_de_demandas'))`
    const repetida = await tx.buscaDeDemandas.findFirst({
      where: {
        perguntaNormalizada,
        chaveDoLote: chave,
        // A concluída responde de novo; a pendente ou em curso é o mesmo pedido (clique duplo).
        estado: { in: ['PENDENTE', 'EM_CURSO', 'CONCLUIDA'] },
        criadaEm: { gt: new Date(agora.getTime() - DIA_MS) },
      },
      orderBy: { criadaEm: 'desc' },
      select: { id: true },
    })
    if (repetida) return { id: repetida.id, reaproveitada: true }

    const base = {
      pergunta,
      perguntaNormalizada,
      pedidaPorId: sujeito.usuarioId,
      loteIds,
      chaveDoLote: chave,
      tokensDoLote,
      criadaEm: agora,
    }
    if (loteIds.length === 0) {
      const vazia = await tx.buscaDeDemandas.create({
        data: { ...base, estado: 'CONCLUIDA', resumo: SEM_DEMANDAS, concluidaEm: agora },
        select: { id: true },
      })
      return { id: vazia.id, reaproveitada: false }
    }
    const hoje = await tx.buscaDeDemandas.count({ where: contaNoTeto(agora) })
    if (hoje >= limites.porDia) {
      throw new ErroDeDominio(`Limite de ${limites.porDia} buscas por dia atingido.`)
    }
    if (tokensDoLote > limites.tokensDoLote) {
      throw new ErroDeDominio(
        `O recorte tem ${loteIds.length} demandas, grande demais para uma busca. Faça um recorte por período, projeto ou cliente.`,
      )
    }
    const criada = await tx.buscaDeDemandas.create({ data: base, select: { id: true } })
    return { id: criada.id, reaproveitada: false }
  })
}

/** Quantas buscas ainda cabem nas próximas 24 h. */
export async function buscasRestantes(
  agora: Date,
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const feitas = await db.buscaDeDemandas.count({ where: contaNoTeto(agora) })
  return Math.max(0, lerLimites(env).porDia - feitas)
}

function falhaInterna(erro: unknown, o: string): Saida<500> {
  log.error({ erro: resumirErroParaLog(erro) }, `recepção de buscas da Fábrica falhou: ${o}`)
  return { status: 500, corpo: { erro: 'Falha interna.' } }
}

async function lerDemandas(ids: readonly string[]): Promise<Map<string, LinhaDaDemanda>> {
  const linhas = await db.demanda.findMany({ where: { id: { in: [...ids] } }, select: SELECAO })
  return new Map(linhas.map((l) => [l.id, l as LinhaDaDemanda]))
}

/**
 * A busca pendente mais antiga (ou a em curso abandonada há mais de 5 min) passa a em curso e vai
 * à Fábrica com as fichas do lote. Dois pedidos ao mesmo tempo não levam a mesma.
 */
export async function buscarBuscaParaAFabrica(
  authorization: string | null,
  agora: Date,
): Promise<Saida<200 | 401 | 500>> {
  try {
    const fonte = await autenticarFonte(authorization)
    if (fonte === null) return { status: 401, corpo: NAO_AUTORIZADO }
    await db.fonteDaFabrica.update({ where: { id: fonte.id }, data: { ultimoUsoEm: agora } })

    const abandonada = new Date(agora.getTime() - ABANDONADA_APOS_MS)
    const pegas = await db.$queryRaw<{ id: string; pergunta: string; loteIds: string[] }[]>`
      UPDATE "BuscaDeDemandas" SET "estado" = 'EM_CURSO', "buscadaEm" = ${agora}
      WHERE "id" = (
        SELECT "id" FROM "BuscaDeDemandas"
        WHERE "estado" = 'PENDENTE' OR ("estado" = 'EM_CURSO' AND "buscadaEm" < ${abandonada})
        ORDER BY "criadaEm" ASC, "id" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "pergunta", "loteIds"`
    const pega = pegas[0]
    if (!pega) return { status: 200, corpo: { busca: null } }

    const porId = await lerDemandas(pega.loteIds)
    const busca: BuscaParaAFabrica = {
      id: pega.id,
      pergunta: pega.pergunta,
      fichas: pega.loteIds.flatMap((id) => {
        const d = porId.get(id)
        return d ? [fichaDaDemanda(fonteDaFicha(d))] : []
      }),
      candidatas: LIMITE_DE_CANDIDATAS,
    }
    return { status: 200, corpo: { busca } }
  } catch (erro) {
    return falhaInterna(erro, 'busca')
  }
}

/** O texto completo das candidatas que a etapa 1 escolheu; só ids do lote, no máximo 10. */
export async function textosParaAFabrica(
  authorization: string | null,
  buscaId: string,
  ids: readonly string[],
): Promise<Saida<200 | 401 | 404 | 422 | 500>> {
  try {
    const fonte = await autenticarFonte(authorization)
    if (fonte === null) return { status: 401, corpo: NAO_AUTORIZADO }
    if (!UUID.test(buscaId)) return { status: 404, corpo: NAO_ENCONTRADA }
    if (ids.length > LIMITE_DE_CANDIDATAS) {
      return { status: 422, corpo: { erro: `No máximo ${LIMITE_DE_CANDIDATAS} demandas.` } }
    }
    const busca = await db.buscaDeDemandas.findUnique({
      where: { id: buscaId },
      select: { loteIds: true },
    })
    if (!busca) return { status: 404, corpo: NAO_ENCONTRADA }
    const doLote = new Set(busca.loteIds)
    const pedidos = [...new Set(ids)].filter((id) => UUID.test(id) && doLote.has(id))
    const porId = await lerDemandas(pedidos)
    const demandas: TextoParaAFabrica[] = pedidos.flatMap((id) => {
      const d = porId.get(id)
      return d
        ? [
            {
              id,
              titulo: d.titulo,
              texto: textoCompleto({ ...fonteDaFicha(d), triagem: d.triagem }),
            },
          ]
        : []
    })
    return { status: 200, corpo: { demandas } }
  } catch (erro) {
    return falhaInterna(erro, 'textos')
  }
}

async function registrarResposta(
  buscaId: string,
  r: RespostaDaBusca,
  agora: Date,
): Promise<Saida<200 | 201 | 404 | 409 | 410>> {
  const impressao = jsonCanonico(r)
  return db.$transaction(async (tx) => {
    const travada = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "BuscaDeDemandas" WHERE "id" = ${buscaId} FOR UPDATE`
    if (travada.length === 0) return { status: 404, corpo: NAO_ENCONTRADA }
    const busca = await tx.buscaDeDemandas.findUniqueOrThrow({
      where: { id: buscaId },
      select: { estado: true, respostaId: true, impressao: true, loteIds: true },
    })
    if (busca.respostaId === r.id) {
      return busca.impressao === impressao
        ? { status: 200, corpo: { id: r.id } }
        : { status: 409, corpo: { erro: 'Resposta repetida com outro conteúdo.' } }
    }
    const outra = await tx.buscaDeDemandas.findUnique({
      where: { respostaId: r.id },
      select: { id: true },
    })
    if (outra) return { status: 409, corpo: { erro: 'Resposta já usada em outra busca.' } }
    if (busca.estado === 'CONCLUIDA' || busca.estado === 'FALHOU') {
      return { status: 410, corpo: { erro: 'Busca já respondida.' } }
    }
    const gasto = {
      modelo: r.modelo ?? null,
      tokensEntrada: r.tokensEntrada ?? null,
      tokensSaida: r.tokensSaida ?? null,
      custoUsd: r.custoUsd ?? null,
    }
    const comum = { respostaId: r.id, impressao, concluidaEm: agora, ...gasto }
    await tx.buscaDeDemandas.update({
      where: { id: buscaId },
      data:
        'falha' in r
          ? { ...comum, estado: 'FALHOU', falha: r.falha }
          : {
              ...comum,
              estado: 'CONCLUIDA',
              resumo: r.resumo,
              itens: itensValidos(r.itens, busca.loteIds) as never,
            },
    })
    return { status: 201, corpo: { id: r.id } }
  })
}

export async function receberRespostaDaBusca(
  authorization: string | null,
  buscaId: string,
  e: EntradaDaRecepcao,
  agora: Date,
): Promise<Saida<200 | 201 | 401 | 404 | 409 | 410 | 413 | 415 | 422 | 500>> {
  try {
    const fonte = await autenticarFonte(authorization)
    if (fonte === null) return { status: 401, corpo: NAO_AUTORIZADO }
    if (!(e.contentType ?? '').toLowerCase().includes('application/json')) {
      return { status: 415, corpo: { erro: 'Envie o corpo como application/json.' } }
    }
    const grande = { status: 413, corpo: { erro: 'Corpo maior que 32 KB.' } } as const
    if (e.contentLength !== null && Number(e.contentLength) > LIMITE_DO_CORPO_DA_BUSCA) {
      return grande
    }
    const texto = await e.corpo()
    if (Buffer.byteLength(texto, 'utf8') > LIMITE_DO_CORPO_DA_BUSCA) return grande
    const invalido = { status: 422, corpo: { erro: 'Corpo inválido.' } } as const
    let json: unknown
    try {
      json = JSON.parse(texto)
    } catch {
      return invalido
    }
    const lido = respostaDaBuscaSchema.safeParse(json)
    if (!lido.success) return invalido
    if (!UUID.test(buscaId)) return { status: 404, corpo: NAO_ENCONTRADA }

    const r = await registrarResposta(buscaId, lido.data, agora)
    if (r.status === 200 || r.status === 201) {
      await db.fonteDaFabrica.update({ where: { id: fonte.id }, data: { ultimoUsoEm: agora } })
    }
    return r
  } catch (erro) {
    return falhaInterna(erro, 'resposta')
  }
}
