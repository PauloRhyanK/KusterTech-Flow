import type { Amostra, AvisoRegistrado, DiscoPorDono, Limpeza, RetratoDaMaquina } from './contrato'

export const LIMITES_DA_OFICINA = {
  discoUsoPct: 80,
  limpezaAtrasadaH: 36,
  leituraVelhaMin: 5,
  avisosH: 24,
  passoDoHistoricoMin: 10,
  diasDeHistorico: 7,
} as const

export interface PontoDoHistorico {
  em: Date
  memDisponivelMb: number
  discoLivreBytes: number | null
}

export interface AvisoDaMaquina {
  tipo: 'memoria' | 'disco' | 'limpeza' | 'arquivo'
  mensagem: string
  desde: Date | null
}

export interface LeituraDaMaquina {
  lidaEm: Date
  amostra: Amostra | null
  retrato: RetratoDaMaquina | null
  discoPorDono: DiscoPorDono | null
  limpezas: Limpeza[]
  historico: PontoDoHistorico[]
  avisos: AvisoRegistrado[]
  linhasIgnoradas: number
}

const MINUTO_MS = 60_000
const HORA_MS = 3_600_000
const DIA_MS = 24 * HORA_MS

export function leituraVelha(em: Date, agora: Date): boolean {
  return agora.getTime() - em.getTime() > LIMITES_DA_OFICINA.leituraVelhaMin * MINUTO_MS
}

// Um ponto por janela de 10 min (a última amostra da janela), só os últimos 7 dias.
export function reduzirHistorico(amostras: Amostra[], agora: Date): PontoDoHistorico[] {
  const passo = LIMITES_DA_OFICINA.passoDoHistoricoMin * MINUTO_MS
  const corte = agora.getTime() - LIMITES_DA_OFICINA.diasDeHistorico * DIA_MS
  const porJanela = new Map<number, PontoDoHistorico & { t: number }>()
  for (const a of amostras) {
    const t = new Date(a.em).getTime()
    if (t < corte || t > agora.getTime()) continue
    const janela = Math.floor(t / passo)
    const atual = porJanela.get(janela)
    if (atual && atual.t >= t) continue
    porJanela.set(janela, {
      t,
      em: new Date(t),
      memDisponivelMb: a.memDisponivelMb,
      discoLivreBytes: a.discoLivreBytes ?? null,
    })
  }
  return [...porJanela.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([, ponto]) => ({
      em: ponto.em,
      memDisponivelMb: ponto.memDisponivelMb,
      discoLivreBytes: ponto.discoLivreBytes,
    }))
}

export function avisosDaMaquina(
  l: LeituraDaMaquina,
  ramMinimaMb: number | null,
  agora: Date,
): AvisoDaMaquina[] {
  const avisos: AvisoDaMaquina[] = []
  const { amostra } = l

  // Sem amostra a máquina não está informando: nada a avisar além dos registrados.
  if (amostra) {
    const desde = new Date(amostra.em)
    if (ramMinimaMb !== null && amostra.memDisponivelMb < ramMinimaMb) {
      avisos.push({
        tipo: 'memoria',
        mensagem: `Memória disponível em ${amostra.memDisponivelMb} MB, abaixo do mínimo de ${ramMinimaMb} MB.`,
        desde,
      })
    }
    if (amostra.discoUsoPct !== null && amostra.discoUsoPct > LIMITES_DA_OFICINA.discoUsoPct) {
      avisos.push({
        tipo: 'disco',
        mensagem: `Disco em ${amostra.discoUsoPct}%, acima do limite de ${LIMITES_DA_OFICINA.discoUsoPct}%.`,
        desde,
      })
    }
    const ultima = l.limpezas[0]
    if (!ultima) {
      avisos.push({ tipo: 'limpeza', mensagem: 'Nenhuma limpeza registrada.', desde: null })
    } else {
      const em = new Date(ultima.em)
      const idadeH = (agora.getTime() - em.getTime()) / HORA_MS
      if (!ultima.ok) {
        avisos.push({ tipo: 'limpeza', mensagem: 'A última limpeza falhou.', desde: em })
      } else if (idadeH > LIMITES_DA_OFICINA.limpezaAtrasadaH) {
        avisos.push({
          tipo: 'limpeza',
          mensagem: `A última limpeza foi há mais de ${LIMITES_DA_OFICINA.limpezaAtrasadaH} h.`,
          desde: em,
        })
      }
    }
  }

  for (const registrado of l.avisos) {
    avisos.push({ tipo: 'arquivo', mensagem: registrado.mensagem, desde: new Date(registrado.em) })
  }
  return avisos
}

export function formatarBytes(b: number): string {
  const KB = 1024
  const MB = KB * 1024
  const GB = MB * 1024
  const TB = GB * 1024
  const decimal = (n: number) => n.toFixed(1).replace('.', ',')
  if (b >= TB) return `${decimal(b / TB)} TB`
  if (b >= GB) return `${decimal(b / GB)} GB`
  if (b >= MB) return `${Math.round(b / MB)} MB`
  if (b >= KB) return `${Math.round(b / KB)} KB`
  return `${b} B`
}
