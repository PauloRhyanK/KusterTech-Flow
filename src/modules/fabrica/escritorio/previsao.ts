// Previsão de entrega do escritório da Fábrica (sala de gestão). Puro: o histórico e o sorteio vêm de fora.
// Regras da spec (seção 4.6): mediana por papel no repositório (5 ou mais partes terminadas) ou global; 1000
// rodadas respeitando dependeDe e as vagas, mais a publicação; p50 e p85; menos de 5 partes no total: sem base.

export interface ParteRestante {
  raia: string
  papel: string | null
  dependeDe: string[]
  /** minutos já gastos, para a parte em execução */
  minutosGastos: number
  emExecucao: boolean
}

export interface Historico {
  papel: string | null
  repositorio: string
  minutos: number
}

export interface EntradaDaPrevisao {
  restantes: ParteRestante[]
  historico: Historico[]
  repositorio: string
  vagas: number
  publicacaoMin: number
  agora: Date
  rodadas?: number
  sorteio?: () => number
}

export type Previsao =
  | { semBase: true }
  | {
      semBase: false
      p50: Date
      p85: Date
      caminhoCritico: string[]
      fimPrevistoPorParte: Record<string, Date>
      /** a chance (em %) de terminar até o fim de cada janela, em até 10 janelas iguais */
      distribuicao: { ate: Date; chance: number }[]
    }

export const BASE_MINIMA = 5
export const RODADAS_PADRAO = 1000

export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  const ordenados = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(ordenados.length / 2)
  return ordenados.length % 2 === 1
    ? ordenados[meio]!
    : (ordenados[meio - 1]! + ordenados[meio]!) / 2
}

/** As durações que servem de base para um papel: do repositório se houver 5 ou mais, senão de todos. */
export function amostras(
  historico: Historico[],
  papel: string | null,
  repositorio: string,
): number[] {
  const doPapel = historico.filter((h) => h.papel === papel)
  const doRepo = doPapel.filter((h) => h.repositorio === repositorio)
  if (doRepo.length >= BASE_MINIMA) return doRepo.map((h) => h.minutos)
  if (doPapel.length > 0) return doPapel.map((h) => h.minutos)
  return historico.map((h) => h.minutos)
}

/** Agenda as partes respeitando dependências e vagas; devolve o fim de cada parte, em minutos desde agora. */
function agendar(
  restantes: ParteRestante[],
  duracao: Map<string, number>,
  vagas: number,
): Map<string, number> {
  const ids = new Set(restantes.map((p) => p.raia))
  const fim = new Map<string, number>()
  const rodando = new Map<string, number>()
  const pendentes = new Set(restantes.map((p) => p.raia))
  const limite = Math.max(1, vagas)
  let t = 0
  // quem já está em execução ocupa vaga desde o início
  for (const p of restantes) {
    if (p.emExecucao) {
      rodando.set(p.raia, duracao.get(p.raia)!)
      pendentes.delete(p.raia)
    }
  }
  const pronta = (p: ParteRestante) =>
    p.dependeDe.every((d) => !ids.has(d) || (fim.has(d) && fim.get(d)! <= t))
  while (pendentes.size > 0 || rodando.size > 0) {
    for (const p of restantes) {
      if (rodando.size >= limite) break
      if (pendentes.has(p.raia) && pronta(p)) {
        rodando.set(p.raia, t + duracao.get(p.raia)!)
        pendentes.delete(p.raia)
      }
    }
    if (rodando.size === 0) break // dependência circular ou inexistente: não trava a tela
    t = Math.min(...rodando.values())
    for (const [raia, termina] of [...rodando]) {
      if (termina <= t) {
        fim.set(raia, termina)
        rodando.delete(raia)
      }
    }
  }
  return fim
}

function percentil(ordenados: number[], p: number): number {
  return ordenados[
    Math.min(ordenados.length - 1, Math.max(0, Math.ceil(p * ordenados.length) - 1))
  ]!
}

function caminhoCritico(restantes: ParteRestante[], duracao: Map<string, number>): string[] {
  const porId = new Map(restantes.map((p) => [p.raia, p]))
  const memo = new Map<string, { total: number; cadeia: string[] }>()
  const visitar = (id: string, visitando: Set<string>): { total: number; cadeia: string[] } => {
    const pronto = memo.get(id)
    if (pronto) return pronto
    const p = porId.get(id)!
    let melhor = { total: 0, cadeia: [] as string[] }
    for (const d of p.dependeDe) {
      if (!porId.has(d) || visitando.has(d)) continue
      const r = visitar(d, new Set([...visitando, id]))
      if (r.total > melhor.total) melhor = r
    }
    const r = { total: melhor.total + duracao.get(id)!, cadeia: [...melhor.cadeia, id] }
    memo.set(id, r)
    return r
  }
  let maior = { total: -1, cadeia: [] as string[] }
  for (const p of restantes) {
    const r = visitar(p.raia, new Set())
    if (r.total > maior.total) maior = r
  }
  return maior.cadeia
}

export function preverEntrega(entrada: EntradaDaPrevisao): Previsao {
  const { restantes, historico, repositorio, vagas, publicacaoMin, agora } = entrada
  if (historico.length < BASE_MINIMA) return { semBase: true }
  const sorteio = entrada.sorteio ?? Math.random
  const rodadas = entrada.rodadas ?? RODADAS_PADRAO
  const base = new Map(restantes.map((p) => [p.raia, amostras(historico, p.papel, repositorio)]))
  const restante = (p: ParteRestante, bruto: number) =>
    p.emExecucao ? Math.max(0, bruto - p.minutosGastos) : bruto

  const fins: number[] = []
  for (let i = 0; i < rodadas; i++) {
    const duracao = new Map(
      restantes.map((p) => {
        const pool = base.get(p.raia)!
        return [
          p.raia,
          restante(p, pool[Math.min(pool.length - 1, Math.floor(sorteio() * pool.length))]!),
        ]
      }),
    )
    const fim = agendar(restantes, duracao, vagas)
    fins.push(Math.max(0, ...fim.values()) + publicacaoMin)
  }
  fins.sort((a, b) => a - b)

  const medianas = new Map(restantes.map((p) => [p.raia, restante(p, mediana(base.get(p.raia)!)!)]))
  const fimMediano = agendar(restantes, medianas, vagas)
  const emData = (m: number) => new Date(agora.getTime() + Math.round(m) * 60_000)
  return {
    semBase: false,
    p50: emData(percentil(fins, 0.5)),
    p85: emData(percentil(fins, 0.85)),
    caminhoCritico: caminhoCritico(restantes, medianas),
    fimPrevistoPorParte: Object.fromEntries([...fimMediano].map(([raia, m]) => [raia, emData(m)])),
    distribuicao: distribuir(fins).map((j) => ({ ate: emData(j.ate), chance: j.chance })),
  }
}

/** Os fins das rodadas (ordenados) em até 10 janelas iguais, com a porcentagem de rodadas em cada uma. */
function distribuir(fins: number[]): { ate: number; chance: number }[] {
  const menor = fins[0]!
  const maior = fins[fins.length - 1]!
  if (maior === menor) return [{ ate: maior, chance: 100 }]
  const janelas = Math.min(10, Math.max(2, Math.ceil((maior - menor) / 15)))
  const passo = (maior - menor) / janelas
  const contagem = Array.from({ length: janelas }, () => 0)
  for (const f of fins) contagem[Math.min(janelas - 1, Math.floor((f - menor) / passo))]! += 1
  return contagem.map((n, i) => ({
    ate: menor + passo * (i + 1),
    chance: Math.round((n / fins.length) * 1000) / 10,
  }))
}

export interface TempoDaEtapa {
  etapa: string
  realMin: number | null
  previstoMin: number | null
}

/** O tempo real de cada etapa da demanda contra a mediana da mesma etapa nas demandas entregues. */
export function tempoPorEtapa(
  historico: { etapa: string; minutos: number }[],
  etapasDaDemanda: { etapa: string; realMin: number | null }[],
): TempoDaEtapa[] {
  return etapasDaDemanda.map(({ etapa, realMin }) => ({
    etapa,
    realMin,
    previstoMin: mediana(historico.filter((h) => h.etapa === etapa).map((h) => h.minutos)),
  }))
}

/** Gasto até agora mais o custo médio por parte terminada vezes as partes que faltam; null sem base. */
export function custoPrevisto(
  gasto: number,
  custosPorParte: number[],
  partesRestantes: number,
): number | null {
  if (custosPorParte.length === 0) return null
  const media = custosPorParte.reduce((s, c) => s + c, 0) / custosPorParte.length
  return Math.round((gasto + media * partesRestantes) * 100) / 100
}
