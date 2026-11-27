import type { Amostra, AvisoRegistrado, DiscoPorDono, Limpeza, RetratoDaMaquina } from './contrato'

export type Container = RetratoDaMaquina['containers'][number]

export const LIMITES_DA_OFICINA = {
  discoUsoPct: 80,
  limpezaAtrasadaH: 36,
  leituraVelhaMin: 5,
  memoriaUsoPct: 90,
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

// Parados com erro primeiro; depois os que rodam, por memória (sem medida por último);
// depois os demais parados.
export function ordenarContainers(cs: Container[]): Container[] {
  const grupo = (c: Container) =>
    c.estado === 'parado' && c.codigoDeSaida !== null && c.codigoDeSaida !== 0
      ? 0
      : c.estado === 'rodando'
        ? 1
        : 2
  return [...cs].sort((a, b) => {
    const g = grupo(a) - grupo(b)
    if (g !== 0) return g
    return (b.memoriaBytes ?? -1) - (a.memoriaBytes ?? -1)
  })
}

// Sem fonte de saúde: contêiner no ar é neutro, nunca verde (invariante 9).
export function apresentarContainer(c: Container): {
  texto: string
  tom: 'neutro' | 'execucao' | 'erro'
} {
  if (c.estado === 'rodando') return { texto: 'No ar', tom: 'neutro' }
  if (c.codigoDeSaida === null || c.codigoDeSaida === 0) return { texto: 'Parado', tom: 'neutro' }
  return { texto: 'Parou com erro', tom: 'erro' }
}

const ROTULO_DO_DONO: Record<DiscoPorDono['donos'][number]['nome'] | 'livre', string> = {
  docker: 'Docker (imagens e volumes)',
  fabrica: 'Fábrica (planos e clones)',
  runners: 'Runners (cache de builds)',
  backups: 'Backups do banco',
  outros: 'Sistema e outros',
  livre: 'Livre',
}

const ORDEM_DOS_DONOS = ['docker', 'fabrica', 'runners', 'backups', 'outros'] as const

// Uma fatia por dono e a livre. O espaço que nenhum dono explica entra em "outros";
// se as medidas passam do total, as porcentagens são sobre a soma delas.
export function fatiasDoDisco(
  d: DiscoPorDono,
  totalBytes: number,
  livreBytes: number,
): { nome: string; rotulo: string; bytes: number; pct: number }[] {
  const porDono = new Map<string, number>()
  for (const dono of d.donos) porDono.set(dono.nome, (porDono.get(dono.nome) ?? 0) + dono.bytes)
  const somaDosDonos = [...porDono.values()].reduce((s, b) => s + b, 0)
  const semDono = Math.max(0, totalBytes - livreBytes - somaDosDonos)
  porDono.set('outros', (porDono.get('outros') ?? 0) + semDono)

  const fatias = [
    ...ORDEM_DOS_DONOS.map((nome) => ({ nome, bytes: porDono.get(nome) ?? 0 })),
    { nome: 'livre' as const, bytes: livreBytes },
  ]
  const base = Math.max(
    totalBytes,
    fatias.reduce((s, f) => s + f.bytes, 0),
  )
  return fatias.map((f) => ({
    nome: f.nome,
    rotulo: ROTULO_DO_DONO[f.nome],
    bytes: f.bytes,
    pct: base > 0 ? (f.bytes / base) * 100 : 0,
  }))
}

// Atributo `points` de uma <polyline>: x de 0 à largura, maior valor no alto. A margem
// vertical evita que o traço seja cortado na borda.
export function pontosDoGrafico(valores: number[], largura: number, altura: number): string {
  if (valores.length === 0) return ''
  const margem = 2
  const min = Math.min(...valores)
  const max = Math.max(...valores)
  const y = (v: number) =>
    max === min ? altura / 2 : margem + ((max - v) / (max - min)) * (altura - 2 * margem)
  const arredondar = (n: number) => Math.round(n * 10) / 10
  if (valores.length === 1) {
    const yy = arredondar(y(valores[0]!))
    return `0,${yy} ${largura},${yy}`
  }
  return valores
    .map((v, i) => `${arredondar((i / (valores.length - 1)) * largura)},${arredondar(y(v))}`)
    .join(' ')
}

// "35 s", "6 min", "3 h", "12 dias".
export function idadeCurta(em: Date, agora: Date): string {
  const s = Math.max(0, Math.floor((agora.getTime() - em.getTime()) / 1000))
  if (s < 60) return `${s} s`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  const dias = Math.floor(h / 24)
  return dias === 1 ? '1 dia' : `${dias} dias`
}

const DIA_EM_SP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
const HORA_EM_SP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

// Dia ("hoje", "ontem" ou "16/11") e hora, no fuso de São Paulo.
export function diaEHora(em: Date, agora: Date): { dia: string; hora: string } {
  const dia = DIA_EM_SP.format(em)
  const hora = HORA_EM_SP.format(em)
  if (dia === DIA_EM_SP.format(agora)) return { dia: 'hoje', hora }
  if (dia === DIA_EM_SP.format(new Date(agora.getTime() - DIA_MS))) return { dia: 'ontem', hora }
  return { dia: dia.slice(0, 5), hora }
}

// Os contêineres do próprio Flow: nome com prefixo "flow-" ou "kustertech-flow-" (projeto do compose).
// O migrate roda e termina a cada subida: não é serviço, fica fora da contagem e da memória.
export function servicoDoFlow(
  cs: Container[],
): { total: number; noAr: number; memoriaBytes: number } | null {
  const doFlow = cs.filter(
    (c) =>
      (c.nome.startsWith('flow-') || c.nome.startsWith('kustertech-flow-')) &&
      !/-migrate(-|$)/.test(c.nome),
  )
  if (doFlow.length === 0) return null
  const noAr = doFlow.filter((c) => c.estado === 'rodando')
  return {
    total: doFlow.length,
    noAr: noAr.length,
    memoriaBytes: noAr.reduce((s, c) => s + (c.memoriaBytes ?? 0), 0),
  }
}
