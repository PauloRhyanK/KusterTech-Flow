// Migração das demandas já encerradas para a regra "até o ar" (spec 12). Funções puras: o que cada
// demanda ganha (partes, estado, espera) a partir do que ela já tem; a escrita fica no service.
import { MODELO_PADRAO, type EtapaDefinida } from './model'
import {
  chaveLivre,
  MOTIVOS,
  resultadoDoPedido,
  type EstadoDaParte,
  type PrDaParte,
} from './partes'

export const MOTIVO_DA_REABERTURA =
  "Entregue antes da regra 'até o ar'. Retomar planeja o que falta; Encerrar fecha sem ir ao ar."

export interface PedidoDaMigracao {
  id?: string
  /** Repositório do pedido; sem ele, vale o de entrada da demanda. */
  repositorio?: string
  commit: string | null
  estado: string
  /** A versão conferida do repositório (`versaoNoAr`) é o commit do pedido. */
  conferidoContendo: boolean
  criadoEm: Date
  concluidoEm?: Date | null
}

export interface EntradaDaMigracao {
  id: string
  /** Repositório de entrada (`dono/nome`). */
  repositorio: string
  encerrada: string | null
  entregueEm: Date | null
  prs: string[]
  temPartes: boolean
  pedidos: PedidoDaMigracao[]
  temPlano?: boolean
  /** Repositórios do cadastro; sem a lista, todos valem. URL de fora vai à parte de entrada. */
  repositoriosCadastrados?: string[]
}

export interface ParteDaMigracao {
  chave: string
  repositorio: string
  objetivo: string
  ordem: number
  dependeDe: string[]
  chegaAoAr: 'publicacao'
  estado: EstadoDaParte
  motivo: string | null
  commitAlvo: string | null
  prs: PrDaParte[]
  pedidoId: string | null
  noArEm: Date | null
  commitNoAr: string | null
  /** A parte foi dada como no ar por um pedido PUBLICADO sem a versão conferida (D76). */
  antesDaConferencia: boolean
}

export interface PlanoDaMigracao {
  partes: ParteDaMigracao[]
  demanda: {
    encerrada: string | null
    naoChegouDesde: Date | null
    espera: 'travada' | null
    esperaMotivo: string | null
    noArEm: Date | null
  }
  acao: 'no_ar' | 'reaberta' | 'so_partes'
  /** Texto do evento do histórico; só para `no_ar` e `reaberta`. */
  historico: string | null
}

const URL_DE_PR = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
const ANDANDO = ['NA_FILA', 'VERIFICANDO', 'PUBLICANDO']

const igual = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function porRecencia(a: PedidoDaMigracao, b: PedidoDaMigracao): number {
  return b.criadoEm.getTime() - a.criadoEm.getTime()
}

function estadoDaParteEntregue(
  pedidos: readonly PedidoDaMigracao[],
  entregueEm: Date | null,
): Pick<
  ParteDaMigracao,
  'estado' | 'motivo' | 'commitAlvo' | 'pedidoId' | 'noArEm' | 'commitNoAr' | 'antesDaConferencia'
> {
  const recentes = [...pedidos].sort(porRecencia)
  const publicado = recentes.find((p) => p.estado === 'PUBLICADO')
  const pedido = publicado ?? recentes[0]
  if (!pedido) {
    return {
      estado: 'nao_chegou',
      motivo: MOTIVOS.nuncaPublicada,
      commitAlvo: null,
      pedidoId: null,
      noArEm: null,
      commitNoAr: null,
      antesDaConferencia: false,
    }
  }
  // spec 12.2: o commit alvo é o do pedido mais recente do repositório, seja qual for o estado.
  const maisRecenteComCommit = recentes.find((p) => p.commit !== null)
  const comum = { commitAlvo: maisRecenteComCommit?.commit ?? null, pedidoId: pedido.id ?? null }
  if (ANDANDO.includes(pedido.estado)) {
    return {
      ...comum,
      estado: 'publicando',
      motivo: null,
      noArEm: null,
      commitNoAr: null,
      antesDaConferencia: false,
    }
  }
  const resultado =
    pedido.estado === 'PUBLICADO'
      ? ({ estado: 'no_ar', motivo: null } as const)
      : resultadoDoPedido({
          estado: pedido.estado as 'RECUSADO' | 'FALHOU' | 'DISPENSADO' | 'CANCELADO',
          motivo: null,
          conserto: null,
          conferidoContendo: pedido.conferidoContendo,
        })
  if (resultado.estado !== 'no_ar') {
    return { ...comum, ...resultado, noArEm: null, commitNoAr: null, antesDaConferencia: false }
  }
  return {
    ...comum,
    estado: 'no_ar',
    motivo: null,
    noArEm: pedido.concluidoEm ?? entregueEm,
    commitNoAr: pedido.commit,
    // PUBLICADO conta como no ar; sem a versão conferida contendo o commit é o caso antes da D76.
    antesDaConferencia: pedido.estado === 'PUBLICADO' && !pedido.conferidoContendo,
  }
}

/** Partes pela URL dos PRs: entrada primeiro, depois um repositório por vez, na ordem de aparição. */
function partesDosPrs(d: EntradaDaMigracao): { repositorio: string; prs: PrDaParte[] }[] {
  const grupos: { repositorio: string; prs: PrDaParte[] }[] = [
    { repositorio: d.repositorio, prs: [] },
  ]
  for (const url of d.prs) {
    const m = URL_DE_PR.exec(url)
    if (!m) continue
    const nome = `${m[1]}/${m[2]}`
    const cadastrado =
      d.repositoriosCadastrados === undefined ||
      d.repositoriosCadastrados.some((r) => igual(r, nome))
    let alvo = grupos[0]!
    if (cadastrado) {
      const existente = grupos.find((g) => igual(g.repositorio, nome))
      if (existente) alvo = existente
      else {
        alvo = { repositorio: nome, prs: [] }
        grupos.push(alvo)
      }
    }
    if (alvo.prs.some((p) => p.url === url)) continue
    alvo.prs.push({
      url,
      repositorio: nome,
      numero: Number(m[3]),
      estado: 'mergeado',
      mergeCommit: null,
    })
  }
  return grupos
}

export function planoDaMigracao(d: EntradaDaMigracao): PlanoDaMigracao | null {
  if (d.temPartes) return null

  const usadas = new Set<string>()
  const partes: ParteDaMigracao[] = partesDosPrs(d).map((g, i) => {
    const chave = chaveLivre(g.repositorio, usadas)
    usadas.add(chave)
    const doRepo = d.pedidos.filter((p) => igual(p.repositorio ?? d.repositorio, g.repositorio))
    const situacao =
      d.encerrada === 'entregue'
        ? estadoDaParteEntregue(doRepo, d.entregueEm)
        : {
            estado: (d.encerrada === 'descartada' || d.encerrada === 'orientada'
              ? 'descartada'
              : d.encerrada === 'no_ar'
                ? 'no_ar'
                : d.temPlano
                  ? 'em_curso'
                  : 'planejando') as EstadoDaParte,
            motivo: null,
            commitAlvo: [...doRepo].sort(porRecencia)[0]?.commit ?? null,
            pedidoId: null,
            noArEm: null,
            commitNoAr: null,
            antesDaConferencia: false,
          }
    return {
      chave,
      repositorio: g.repositorio,
      objetivo: '',
      ordem: i + 1,
      dependeDe: [],
      chegaAoAr: 'publicacao',
      prs: g.prs,
      ...situacao,
    }
  })

  const semMudanca = {
    encerrada: d.encerrada,
    naoChegouDesde: null,
    espera: null,
    esperaMotivo: null,
    noArEm: null,
  }
  if (d.encerrada !== 'entregue') {
    return { partes, demanda: semMudanca, acao: 'so_partes', historico: null }
  }
  if (partes.every((p) => p.estado === 'no_ar')) {
    const noArEm = partes.reduce<Date | null>(
      (m, p) => (p.noArEm && (!m || p.noArEm > m) ? p.noArEm : m),
      null,
    )
    const antes = partes.some((p) => p.antesDaConferencia)
    return {
      partes,
      demanda: {
        encerrada: 'no_ar',
        naoChegouDesde: null,
        espera: null,
        esperaMotivo: null,
        noArEm: noArEm ?? d.entregueEm,
      },
      acao: 'no_ar',
      historico: `migrada: no ar${antes ? ' (publicada antes da conferência)' : ''}`,
    }
  }
  return {
    partes,
    demanda: {
      encerrada: null,
      naoChegouDesde: d.entregueEm,
      espera: 'travada',
      esperaMotivo: MOTIVO_DA_REABERTURA,
      noArEm: null,
    },
    acao: 'reaberta',
    historico: 'migrada: reaberta, espera você',
  }
}

/** O snapshot de etapas da demanda ganha a etapa `no_ar` no fim, se ainda não a tem. */
export function etapasComNoAr(etapas: readonly EtapaDefinida[]): EtapaDefinida[] {
  if (etapas.some((e) => e.marco === 'no_ar' || e.chave === 'no_ar')) return [...etapas]
  const noAr = MODELO_PADRAO.find((e) => e.marco === 'no_ar')!
  return [...etapas, { ...noAr }]
}
