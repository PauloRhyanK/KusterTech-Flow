import { exigirPermissao, ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import { retratoV1Schema, type RetratoV1 } from '@/modules/fabrica/contrato'
import { obterRetratoMaisRecente } from '@/modules/fabrica/queries'
import { triagemSchema } from '@/modules/demandas/contrato'
import type { EtapaDefinida, Espera, Origem, Nivel, TipoDeDemanda } from '@/modules/demandas/model'
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

/** As decisões abertas do retrato, com as raias da fase atual (ou do plano, sem fase atual). */
export function decisoesDoRetrato(retrato: RetratoV1 | null): DecisaoDoRetrato[] {
  if (retrato === null) return []
  return retrato.planos.flatMap((plano) => {
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

/** Para quem não tem sujeito (o atendente): o mesmo retrato que `obterRetratoMaisRecente` lê. */
async function retratoSemSujeito(): Promise<RetratoV1 | null> {
  const linha = await db.retratoDaFabrica.findFirst({
    where: { fonte: { revogadaEm: null } },
    orderBy: { recebidoEm: 'desc' },
    select: { conteudo: true },
  })
  if (linha === null) return null
  const lido = retratoV1Schema.safeParse(linha.conteudo)
  return lido.success ? lido.data : null
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
  retrato?: RetratoV1 | null,
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
    ? decisoesDoRetrato(retrato !== undefined ? retrato : await retratoSemSujeito())
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
