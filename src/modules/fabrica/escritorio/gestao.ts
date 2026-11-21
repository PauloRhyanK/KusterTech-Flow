// Dados da sala de gestão de um andar: indicadores, previsão de entrega, tempo de cada parte e tempo por etapa.
// Puro: o retrato, o histórico e o relógio vêm de fora.
import type { RetratoV2 } from '../contrato'
import type { Andar, SituacaoDaParte } from './model'
import type { HistoricoDaFabrica } from './intervalos'
import {
  amostras,
  custoPrevisto,
  mediana,
  type ParteRestante,
  preverEntrega,
  type TempoDaEtapa,
  tempoPorEtapa,
} from './previsao'

export const PUBLICACAO_PADRAO_MIN = 20

export interface LinhaDaGestao {
  raia: string
  cor: number
  situacao: SituacaoDaParte
  comecou: string | null
  comecouPrevisto: boolean
  termina: string | null
  terminaPrevisto: boolean
  realMin: number | null
  previstoMin: number | null
  /** real − previsto, só para parte entregue */
  diferenca: number | null
}

export interface DadosDaGestao {
  semBase: boolean
  entregaPrevista: { p50: string; p85: string } | null
  caminhoCritico: string[]
  faltam: number
  criterios: [number, number]
  emAndamento: number
  vagas: number
  custo: { gasto: number; previsto: number | null }
  retrabalho: number
  linhas: LinhaDaGestao[]
  chances: { ate: string; chance: number }[]
  etapas: TempoDaEtapa[]
  entregas: { raia: string; fim: string }[]
}

export interface EntradaDaGestao {
  andar: Andar
  plano: RetratoV2['planos'][number]
  retrato: RetratoV2
  historico: HistoricoDaFabrica
  etapasDaDemanda: { etapa: string; realMin: number | null }[]
  agora: Date
  sorteio?: () => number
}

const minutosEntre = (de: string, ate: Date) =>
  Math.max(0, Math.round((ate.getTime() - new Date(de).getTime()) / 60_000))

export function montarGestao(e: EntradaDaGestao): DadosDaGestao {
  const { andar, plano, retrato, historico, agora } = e
  const raias = new Map(plano.fases.flatMap((f) => f.raias).map((r) => [r.id, r]))
  const partes = andar.fases.flatMap((f) => f.partes)
  const restantes: ParteRestante[] = partes
    .filter((p) => p.situacao !== 'entregue')
    .map((p) => {
      const r = raias.get(p.raia)
      const emExecucao = p.situacao === 'execucao' || p.situacao === 'revisao'
      return {
        raia: p.raia,
        papel: p.papel,
        dependeDe: r?.dependeDe ?? [],
        emExecucao,
        minutosGastos: emExecucao && r?.inicio ? minutosEntre(r.inicio, agora) : 0,
      }
    })
  const publicacaoMin =
    mediana(historico.etapas.filter((h) => h.etapa === 'entregue').map((h) => h.minutos)) ??
    PUBLICACAO_PADRAO_MIN
  const previsao = preverEntrega({
    restantes,
    historico: historico.partes,
    repositorio: plano.repo,
    vagas: Math.max(1, retrato.vagas.efetivas),
    publicacaoMin,
    agora,
    sorteio: e.sorteio,
  })
  const previstoDe = (papel: string | null) =>
    historico.partes.length === 0 ? null : mediana(amostras(historico.partes, papel, plano.repo))

  const linhas: LinhaDaGestao[] = partes.map((p) => {
    const r = raias.get(p.raia)
    const previstoMin = previstoDe(p.papel)
    const fimPrevisto = previsao.semBase ? undefined : previsao.fimPrevistoPorParte[p.raia]
    const realMin = r?.inicio ? minutosEntre(r.inicio, r.fim ? new Date(r.fim) : agora) : null
    const entregue = p.situacao === 'entregue'
    return {
      raia: p.raia,
      cor: p.cor,
      situacao: p.situacao,
      comecou: r?.inicio ?? null,
      comecouPrevisto: !r?.inicio,
      termina: r?.fim ?? fimPrevisto?.toISOString() ?? null,
      terminaPrevisto: !r?.fim,
      realMin,
      previstoMin,
      diferenca:
        entregue && realMin !== null && previstoMin !== null ? realMin - previstoMin : null,
    }
  })

  const doPlano = retrato.execucoes.filter((x) => x.planoId === plano.id)
  const gasto = Math.round(doPlano.reduce((s, x) => s + (x.custoUsd ?? 0), 0) * 100) / 100
  const criterios = partes.flatMap((p) => p.criterios)
  return {
    semBase: previsao.semBase,
    entregaPrevista: previsao.semBase
      ? null
      : { p50: previsao.p50.toISOString(), p85: previsao.p85.toISOString() },
    caminhoCritico: previsao.semBase ? [] : previsao.caminhoCritico,
    faltam: restantes.length,
    criterios: [criterios.filter((c) => c.marca === 'verde').length, criterios.length],
    emAndamento: partes.filter((p) => p.situacao === 'execucao' || p.situacao === 'revisao').length,
    vagas: retrato.vagas.efetivas,
    custo: { gasto, previsto: custoPrevisto(gasto, historico.custosPorParte, restantes.length) },
    retrabalho:
      doPlano.filter((x) => x.papel === 'fixer').length + (retrato.consertos?.length ?? 0),
    linhas,
    chances: previsao.semBase
      ? []
      : previsao.distribuicao.map((j) => ({ ate: j.ate.toISOString(), chance: j.chance })),
    etapas: tempoPorEtapa(historico.etapas, e.etapasDaDemanda),
    entregas: [...raias.values()]
      .filter((r) => r.fim && (r.situacao === 'mergeada' || r.situacao === 'concluida'))
      .map((r) => ({ raia: r.id, fim: r.fim! })),
  }
}
