import { autorizar, exigirPermissao, ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { moduloAtivo } from '@/lib/modulos'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import type { Retrato } from '@/modules/fabrica/contrato'
import { lerRetratoMaisRecente, obterRetratoMaisRecente } from '@/modules/fabrica/queries'
import { resumirErroParaLog } from '@/modules/github/model'
import { PLANO_EM_CURSO } from '@/modules/inicio/model'
import { triagemSchema } from '@/modules/demandas/contrato'
import type { EtapaDefinida, Espera, Origem, Nivel, TipoDeDemanda } from '@/modules/demandas/model'
import type { Cartao } from './cartao'
import {
  chaveValida,
  montarPilha,
  type DecisaoDoRetrato,
  type DemandaEsperando,
  type ItemDaPilha,
} from './model'

const minusculo = <T extends string>(v: string) => v.toLowerCase() as T

/** As demandas que esperam o Paulo (mesmo filtro do "Espera você" do Início). */
export async function demandasEsperando(ids?: readonly string[]): Promise<DemandaEsperando[]> {
  const linhas = await db.demanda.findMany({
    where: {
      encerrada: null,
      espera: { not: null },
      projeto: { arquivadoEm: null },
      ...(ids ? { id: { in: [...ids] } } : {}),
    },
    select: {
      id: true,
      titulo: true,
      tipo: true,
      origem: true,
      nivel: true,
      espera: true,
      esperaMotivo: true,
      esperaDesde: true,
      atualizadaEm: true,
      versaoDoDesenho: true,
      etapaAtual: true,
      etapas: true,
      descricao: true,
      triagem: true,
      projeto: { select: { nome: true } },
      repositorio: { select: { nomeCompleto: true } },
      _count: { select: { arquivos: { where: { tipo: 'ANEXO', apagadoEm: null } } } },
    },
  })
  // O link de cada trava vem do último `travada` da demanda (o PR da correção, quando há).
  const travadas = linhas.filter((d) => d.espera === 'travada').map((d) => d.id)
  const eventos =
    travadas.length > 0
      ? await db.eventoDaDemanda.findMany({
          where: { demandaId: { in: travadas }, tipo: 'travada' },
          orderBy: { seq: 'desc' },
          distinct: ['demandaId'],
          select: { demandaId: true, dados: true },
        })
      : []
  const urlDaTrava = new Map(
    eventos.map((e) => {
      const url = (e.dados as { url?: unknown } | null)?.url
      return [e.demandaId, typeof url === 'string' ? url : null] as const
    }),
  )
  return linhas.map((d) => {
    const triagem = triagemSchema.safeParse(d.triagem)
    return {
      id: d.id,
      titulo: d.titulo,
      projeto: d.projeto.nome,
      repositorio: d.repositorio.nomeCompleto,
      tipo: d.tipo ? minusculo<TipoDeDemanda>(d.tipo) : null,
      origem: minusculo<Origem>(d.origem),
      nivel: minusculo<Nivel>(d.nivel),
      espera: d.espera as Espera,
      esperaMotivo: d.esperaMotivo,
      urlDaTrava: urlDaTrava.get(d.id) ?? null,
      esperaDesde: d.esperaDesde ?? d.atualizadaEm,
      versaoDoDesenho: d.versaoDoDesenho,
      etapaAtual: d.etapaAtual,
      rotuloDaEtapa:
        (d.etapas as unknown as EtapaDefinida[]).find((e) => e.chave === d.etapaAtual)?.rotulo ??
        d.etapaAtual,
      descricao: d.descricao,
      anexos: d._count.arquivos,
      triagem: triagem.success
        ? {
            tamanho: triagem.data.tamanho,
            mexeEm: triagem.data.mexeEm,
            motivo: triagem.data.motivo,
            destino: triagem.data.destino,
          }
        : null,
    }
  })
}

/** As decisões abertas dos planos em curso, com as raias da fase atual (ou do plano, sem fase atual). */
export function decisoesDoRetrato(retrato: Retrato | null): DecisaoDoRetrato[] {
  if (retrato === null) return []
  return retrato.planos.flatMap((plano) => {
    if (!PLANO_EM_CURSO.includes(plano.estado)) return []
    const fase = plano.fases.find((f) => f.id === plano.faseAtual)
    const raias = fase ? fase.raias : plano.fases.flatMap((f) => f.raias)
    return plano.decisoes.map((d) => ({
      titulo: d.titulo,
      url: d.url,
      planoId: plano.id,
      repo: plano.repo,
      feature: plano.feature,
      faseAtual: plano.faseAtual,
      raias: {
        concluidas: raias.filter((r) => r.estado === 'concluida').length,
        total: raias.length,
      },
    }))
  })
}

async function nomesDosProjetos(repos: readonly string[]): Promise<Map<string, string>> {
  if (repos.length === 0) return new Map()
  const linhas = await db.repositorioGitHub.findMany({
    where: {
      nomeCompleto: { in: [...repos], mode: 'insensitive' },
      projeto: { isNot: null },
      removidoDaInstalacaoEm: null,
    },
    select: { nomeCompleto: true, projeto: { select: { nome: true } } },
  })
  return new Map(linhas.map((r) => [r.nomeCompleto.toLowerCase(), r.projeto!.nome]))
}

const CHAVE_DE_DEMANDA = /^demanda:([^:\s]+):/

export interface ItemLocalizado {
  item: ItemDaPilha
  demanda: DemandaEsperando | null
  decisao: DecisaoDoRetrato | null
}

/**
 * O item atual dessa chave, com a fonte que o gerou; `null` quando não está mais na pilha (a
 * demanda saiu da espera, a decisão saiu do retrato ou a conversa foi encerrada). Adiados e
 * guardados continuam valendo: só saem da vista, não da pilha.
 */
export async function localizarItem(
  chave: string,
  agora: Date,
  retrato?: Retrato | null,
): Promise<ItemLocalizado | null> {
  if (!chaveValida(chave)) return null
  const conversa = await db.conversa.findUnique({
    where: { chave },
    select: { encerradaEm: true },
  })
  if (conversa?.encerradaEm) return null

  const id = CHAVE_DE_DEMANDA.exec(chave)?.[1]
  const demandas = id ? await demandasEsperando([id]) : []
  const decisoes = chave.startsWith('issue:')
    ? decisoesDoRetrato(
        retrato !== undefined ? retrato : ((await lerRetratoMaisRecente())?.retrato ?? null),
      )
    : []
  const nomes = await nomesDosProjetos([...new Set(decisoes.map((d) => d.repo))])
  // Só a marca de encerrada tira o item; ela já foi conferida acima.
  const { itens } = montarPilha({
    demandas,
    decisoes,
    marcas: [],
    agora,
    nomeDoProjeto: (repo) => nomes.get(repo.toLowerCase()) ?? null,
  })
  const item = itens.find((i) => i.chave === chave)
  if (!item) return null
  const ref = item.ref
  return {
    item,
    demanda: ref.tipo === 'demanda' ? (demandas.find((d) => d.id === ref.demandaId) ?? null) : null,
    decisao: ref.tipo === 'issue' ? (decisoes.find((d) => d.url === ref.url) ?? null) : null,
  }
}

/** Ver a pilha e a conversa: `desenvolvimento.ler` e visão global (a pilha mistura projetos). */
export function exigirLeituraDoDecidir(sujeito: Sujeito): void {
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  if (!podeVerVisaoGlobal(sujeito)) throw new ErroDeAutorizacao('desenvolvimento.ler')
}

export async function obterItem(
  sujeito: Sujeito,
  chave: string,
  agora: Date,
): Promise<ItemDaPilha | null> {
  exigirLeituraDoDecidir(sujeito)
  const retrato = chave.startsWith('issue:')
    ? ((await obterRetratoMaisRecente(sujeito))?.retrato ?? null)
    : null
  return (await localizarItem(chave, agora, retrato))?.item ?? null
}

// ---------------------------------------------------------------------------------------------
// Pilha, contador e conversa da tela

export interface PilhaDoDecidir {
  itens: ItemDaPilha[]
  guardados: ItemDaPilha[]
  /** Chave do item → id da conversa aberta dele. */
  conversas: Record<string, string>
}

/** A pilha do Paulo: o que espera resposta (demandas e decisões do último retrato), na ordem do model. */
export async function obterPilha(sujeito: Sujeito, agora: Date): Promise<PilhaDoDecidir> {
  exigirLeituraDoDecidir(sujeito)
  const [demandas, recebido] = await Promise.all([
    demandasEsperando(),
    obterRetratoMaisRecente(sujeito),
  ])
  const decisoes = decisoesDoRetrato(recebido?.retrato ?? null)
  const nomes = await nomesDosProjetos([...new Set(decisoes.map((d) => d.repo))])
  const nomeDoProjeto = (repo: string) => nomes.get(repo.toLowerCase()) ?? null

  // Só as conversas dos itens candidatos são lidas: a leitura não cresce com o histórico.
  const candidatos = montarPilha({ demandas, decisoes, marcas: [], agora, nomeDoProjeto })
  const chaves = [...candidatos.itens, ...candidatos.guardados].map((i) => i.chave)
  const linhas =
    chaves.length === 0
      ? []
      : await db.conversa.findMany({
          where: { chave: { in: chaves } },
          select: {
            id: true,
            chave: true,
            encerradaEm: true,
            guardadaEm: true,
            adiadaAte: true,
            puladaEm: true,
          },
        })
  const { itens, guardados } = montarPilha({
    demandas,
    decisoes,
    marcas: linhas.map((c) => ({
      chave: c.chave,
      encerrada: c.encerradaEm !== null,
      guardadaEm: c.guardadaEm,
      adiadaAte: c.adiadaAte,
      puladaEm: c.puladaEm,
    })),
    agora,
    nomeDoProjeto,
  })
  const naPilha = new Set([...itens, ...guardados].map((i) => i.chave))
  const conversas: Record<string, string> = {}
  for (const c of linhas) {
    if (c.encerradaEm === null && naPilha.has(c.chave)) conversas[c.chave] = c.id
  }
  return { itens, guardados, conversas }
}

/** O número do menu; `null` sem permissão, sem o módulo ou com falha de leitura (nunca quebra o layout). */
export async function contarPilha(sujeito: Sujeito, agora: Date): Promise<number | null> {
  if (!moduloAtivo('decidir')) return null
  if (!autorizar(sujeito, 'desenvolvimento.ler') || !podeVerVisaoGlobal(sujeito)) return null
  try {
    return (await obterPilha(sujeito, agora)).itens.length
  } catch (erro) {
    log.error({ erro: resumirErroParaLog(erro) }, 'contador do Decidir falhou')
    return null
  }
}

export interface MensagemDaTela {
  seq: string
  id: string
  autor: 'paulo' | 'agente' | 'flow'
  texto: string
  respostaRapida: string | null
  respostasRapidas: string[]
  anexos: { id: string; nome: string }[]
  em: Date
}

export interface CartaoDaTela {
  id: string
  conteudo: Cartao
  erro: string | null
  estado: 'PROPOSTO' | 'CONFIRMANDO'
}

export interface ConversaDaTela {
  mensagens: MensagemDaTela[]
  cartao: CartaoDaTela | null
  aguardaAgenteDesde: Date | null
  atendenteBuscouEm: Date | null
  encerrada: boolean
}

const LIMITE_DE_MENSAGENS_NA_TELA = 200

/** As mensagens depois de `depois` (seq), o cartão aberto e os sinais de vida do atendente. */
export async function obterConversaDaTela(
  sujeito: Sujeito,
  conversaId: string,
  depois: bigint,
  agora: Date,
): Promise<ConversaDaTela | null> {
  exigirLeituraDoDecidir(sujeito)
  void agora // a tela decide os avisos de espera; a consulta só devolve os instantes
  const conversa = await db.conversa.findUnique({
    where: { id: conversaId },
    select: { aguardaAgenteDesde: true, encerradaEm: true },
  })
  if (!conversa) return null

  const [mensagens, cartao, busca] = await Promise.all([
    db.mensagem.findMany({
      where: { conversaId, seq: { gt: depois } },
      orderBy: { seq: 'asc' },
      take: LIMITE_DE_MENSAGENS_NA_TELA,
    }),
    db.cartaoDeFecho.findFirst({
      where: { conversaId, estado: { in: ['PROPOSTO', 'CONFIRMANDO'] } },
      select: { id: true, conteudo: true, erro: true, estado: true },
    }),
    db.fonteDaFabrica.aggregate({
      where: { revogadaEm: null },
      _max: { conversasBuscadasEm: true },
    }),
  ])
  const anexos =
    mensagens.length === 0
      ? []
      : await db.anexoDaMensagem.findMany({
          where: { conversaId, mensagemId: { in: mensagens.map((m) => m.id) } },
          orderBy: { criadoEm: 'asc' },
          select: { id: true, nome: true, mensagemId: true },
        })

  return {
    mensagens: mensagens.map((m) => ({
      seq: m.seq.toString(),
      id: m.id,
      autor: minusculo<'paulo' | 'agente' | 'flow'>(m.autor),
      texto: m.texto,
      respostaRapida: m.respostaRapida,
      respostasRapidas: Array.isArray(m.respostasRapidas)
        ? m.respostasRapidas.filter((r): r is string => typeof r === 'string')
        : [],
      anexos: anexos.filter((a) => a.mensagemId === m.id).map((a) => ({ id: a.id, nome: a.nome })),
      em: m.criadaEm,
    })),
    cartao:
      cartao && (cartao.estado === 'PROPOSTO' || cartao.estado === 'CONFIRMANDO')
        ? {
            id: cartao.id,
            conteudo: cartao.conteudo as unknown as Cartao,
            erro: cartao.erro,
            estado: cartao.estado,
          }
        : null,
    aguardaAgenteDesde: conversa.aguardaAgenteDesde,
    atendenteBuscouEm: busca._max.conversasBuscadasEm,
    encerrada: conversa.encerradaEm !== null,
  }
}

/** A imagem de uma mensagem para a tela (o conteúdo é o tipo MIME; o caminho nunca sai daqui). */
export async function obterAnexoParaExibir(
  sujeito: Sujeito,
  anexoId: string,
): Promise<{ conversaId: string; nome: string; conteudo: string } | null> {
  exigirLeituraDoDecidir(sujeito)
  return db.anexoDaMensagem.findUnique({
    where: { id: anexoId },
    select: { conversaId: true, nome: true, conteudo: true },
  })
}
