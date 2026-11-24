import { Buffer } from 'node:buffer'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { lerRetratoMaisRecente } from '@/modules/fabrica/queries'
import { autenticarFonte, type EntradaDaRecepcao } from '@/modules/fabrica/recepcao'
import { resumirErroParaLog } from '@/modules/github/model'
import { acoesDoItem, type ContextoDoItem, type EstadoDoCi } from './cartao'
import {
  ATIVA_POR_MS,
  LIMITE_DE_CONVERSAS,
  LIMITE_DE_MENSAGENS_NO_FIO,
  LIMITE_DO_CORPO_DA_RESPOSTA,
  respostaDoAtendenteSchema,
  type BuscaDoAtendente,
  type ConversaParaOAtendente,
} from './contrato'
import { numeroDoPrDaTrava } from './model'
import { localizarItem } from './queries'
import { registrarRespostaDoAtendente } from './service'

const CI_DO_FATO: Record<EstadoDoCi, string> = {
  verde: 'CI verde',
  pendente: 'CI rodando',
  vermelho: 'CI vermelho',
  ausente: 'sem CI configurado',
}

/**
 * O PR do item, como fato: o atendente não lê o GitHub, então o link e o estado vêm do Flow. Sem
 * o PR lido ao abrir, o link da trava e onde está o estado (a primeira mensagem do Flow).
 */
function fatoDoPr(pr: ContextoDoItem['pr'], urlDaTrava: string | null): string[] {
  if (pr) return [`PR: ${pr.url} (aberto, ${CI_DO_FATO[pr.ci]}; lido pelo Flow ao abrir)`]
  if (urlDaTrava) return [`PR: ${urlDaTrava} (o estado está na primeira mensagem do Flow)`]
  return []
}

/** O link da trava só quando é de PR do repositório do item (o mesmo filtro da mensagem do Flow). */
function urlDoRepositorio(url: string | null, repositorio: string): string | null {
  return numeroDoPrDaTrava(url, repositorio) === null ? null : url
}

type Saida<S extends number> = { status: S; corpo: object }

const NAO_AUTORIZADO = { erro: 'Token inválido.' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const instanteNoFio = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

function falhaInterna(erro: unknown, o: string): Saida<500> {
  // Sem token nem texto da conversa: só o resumo do erro.
  log.error({ erro: resumirErroParaLog(erro) }, `recepção de conversas da Fábrica falhou: ${o}`)
  return { status: 500, corpo: { erro: 'Falha interna.' } }
}

export async function buscarConversasParaOAtendente(
  authorization: string | null,
  agora: Date,
): Promise<Saida<200 | 401 | 500>> {
  try {
    const fonte = await autenticarFonte(authorization)
    if (fonte === null) return { status: 401, corpo: NAO_AUTORIZADO }

    await db.fonteDaFabrica.update({
      where: { id: fonte.id },
      data: { conversasBuscadasEm: agora, ultimoUsoEm: agora },
    })

    const esperando = await db.conversa.findMany({
      where: { encerradaEm: null, aguardaAgenteDesde: { not: null } },
      orderBy: [{ aguardaAgenteDesde: 'asc' }, { criadaEm: 'asc' }],
    })
    const retrato = (await lerRetratoMaisRecente())?.retrato ?? null

    const conversas: ConversaParaOAtendente[] = []
    for (const c of esperando) {
      if (conversas.length >= LIMITE_DE_CONVERSAS) break
      if (c.responderA === null) continue
      const l = await localizarItem(c.chave, agora, retrato)
      if (!l) continue
      const recentes = await db.mensagem.findMany({
        where: { conversaId: c.id },
        orderBy: { seq: 'desc' },
        take: LIMITE_DE_MENSAGENS_NO_FIO,
      })
      const anexos = await db.anexoDaMensagem.findMany({
        where: { conversaId: c.id, mensagemId: { in: recentes.map((m) => m.id) } },
        orderBy: { criadoEm: 'asc' },
        select: { mensagemId: true, nome: true, conteudo: true },
      })
      const contexto = c.contexto as { relato?: unknown; pr?: ContextoDoItem['pr'] } | null
      const relato = contexto?.relato
      const pr = contexto?.pr ?? null
      conversas.push({
        id: c.id,
        repositorio: c.repositorio,
        responderA: c.responderA,
        aguardaDesde: instanteNoFio(c.aguardaAgenteDesde!),
        item: {
          chave: l.item.chave,
          tipo: l.item.tipo,
          titulo: l.item.titulo,
          pergunta: l.item.pergunta,
          fatos: [
            ...l.item.fatos.map((f) => `${f.rotulo}: ${f.valor}`),
            ...fatoDoPr(pr, urlDoRepositorio(l.demanda?.urlDaTrava ?? null, l.item.repositorio)),
          ],
          relato: typeof relato === 'string' ? relato : null,
          acoes: acoesDoItem(l.item.tipo, { pr }),
        },
        mensagens: recentes.reverse().map((m) => ({
          id: m.id,
          autor: m.autor.toLowerCase() as 'paulo' | 'agente' | 'flow',
          texto: m.texto,
          respostaRapida: m.respostaRapida,
          anexos: anexos
            .filter((a) => a.mensagemId === m.id)
            .map((a) => ({ nome: a.nome, conteudo: a.conteudo })),
          em: instanteNoFio(m.criadaEm),
        })),
      })
    }

    const ultima = await db.mensagem.findFirst({
      where: { autor: 'PAULO', conversa: { encerradaEm: null } },
      orderBy: { criadaEm: 'desc' },
      select: { criadaEm: true },
    })
    const corpo: BuscaDoAtendente = {
      conversas,
      ativaAte: ultima ? instanteNoFio(new Date(ultima.criadaEm.getTime() + ATIVA_POR_MS)) : null,
    }
    return { status: 200, corpo }
  } catch (erro) {
    return falhaInterna(erro, 'busca')
  }
}

export async function receberRespostaDoAtendente(
  authorization: string | null,
  conversaId: string,
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
    if (e.contentLength !== null && Number(e.contentLength) > LIMITE_DO_CORPO_DA_RESPOSTA) {
      return grande
    }
    const texto = await e.corpo()
    if (Buffer.byteLength(texto, 'utf8') > LIMITE_DO_CORPO_DA_RESPOSTA) return grande

    const invalido = { status: 422, corpo: { erro: 'Corpo inválido.' } } as const
    let json: unknown
    try {
      json = JSON.parse(texto)
    } catch {
      return invalido
    }
    const lido = respostaDoAtendenteSchema.safeParse(json)
    if (!lido.success) return invalido
    if (!UUID.test(conversaId)) {
      return { status: 404, corpo: { erro: 'Conversa não encontrada.' } }
    }

    const r = await registrarRespostaDoAtendente(fonte.id, conversaId, lido.data, agora)
    if (r.status === 200 || r.status === 201) {
      await db.fonteDaFabrica.update({ where: { id: fonte.id }, data: { ultimoUsoEm: agora } })
    }
    return r
  } catch (erro) {
    return falhaInterna(erro, 'resposta')
  }
}
