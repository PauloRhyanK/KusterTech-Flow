import {
  LIMITES_DA_OFICINA,
  idadeCurta,
  leituraVelha,
  type AvisoDaMaquina,
} from '@/modules/oficina/model'
import type { TipoRecurso } from '@/modules/infra/model'
import type { AmostraBruta, ContainerBruto, SistemaBruto } from './contrato'

export type SituacaoDoBeszel = 'nao_configurado' | 'sem_resposta' | 'recusado' | 'ok'

export interface MaquinaNoBeszel {
  sistemaId: string
  // Nome no Beszel = identificador externo no cadastro.
  nome: string
  noAr: boolean
  lidaEm: Date
  ligadaHaS: number | null
  nucleos: number | null
  cpuPct: number | null
  memPct: number | null
  discoPct: number | null
  carga: [number, number, number] | null
  // Rede nos dois sentidos (info.bb). Contêineres: null quando o Beszel não os informou agora.
  redeBytesS: number | null
  containers: number | null
}

export type SaudeDoContainer = 'sem_checagem' | 'iniciando' | 'saudavel' | 'com_falha'

export interface ContainerNoBeszel {
  nome: string
  cpuPct: number | null
  memoriaBytes: number | null
  desde: string | null
  saude: SaudeDoContainer
}

export interface PontoNoBeszel {
  em: Date
  cpuPct: number | null
  memPct: number | null
  discoPct: number | null
  recebendoBytesS: number | null
}

export interface DetalheNoBeszel extends MaquinaNoBeszel {
  memoria: {
    usadaBytes: number
    totalBytes: number
    swapUsadaBytes: number
    swapTotalBytes: number
  } | null
  disco: { usadoBytes: number; totalBytes: number } | null
  rede: { enviandoBytesS: number; recebendoBytesS: number } | null
  containersDetalhe: ContainerNoBeszel[]
  historico: PontoNoBeszel[]
}

const GB = 1024 ** 3
const MB = 1024 ** 2

// O PocketBase grava "2026-11-26 17:05:26.648Z": troca o espaço pelo T do ISO.
export function dataDoBeszel(texto: string): Date {
  return new Date(texto.replace(' ', 'T'))
}

const ouNulo = (n: number | undefined): number | null => (n === undefined ? null : n)

export function paraMaquina(
  s: SistemaBruto,
  containers: number | null,
  agora: Date,
): MaquinaNoBeszel {
  const info = s.info ?? {}
  const lidaEm = dataDoBeszel(s.updated)
  const la = info.la
  return {
    sistemaId: s.id,
    nome: s.name,
    noAr: s.status === 'up' && !Number.isNaN(lidaEm.getTime()) && !leituraVelha(lidaEm, agora),
    lidaEm,
    ligadaHaS: ouNulo(info.u),
    nucleos: ouNulo(info.t),
    cpuPct: ouNulo(info.cpu),
    memPct: ouNulo(info.mp),
    discoPct: ouNulo(info.dp),
    carga: la && la.length >= 3 ? [la[0]!, la[1]!, la[2]!] : null,
    redeBytesS: ouNulo(info.bb),
    containers,
  }
}

const SAUDE: Record<number, SaudeDoContainer> = {
  0: 'sem_checagem',
  1: 'iniciando',
  2: 'saudavel',
  3: 'com_falha',
}

export function paraDetalhe(
  m: MaquinaNoBeszel,
  amostra: AmostraBruta | null,
  cs: ContainerBruto[],
  historico: AmostraBruta[],
): DetalheNoBeszel {
  const st = amostra?.stats
  const memoria =
    st && st.m !== undefined && st.mu !== undefined
      ? {
          usadaBytes: st.mu * GB,
          totalBytes: st.m * GB,
          swapUsadaBytes: (st.su ?? 0) * GB,
          swapTotalBytes: (st.s ?? 0) * GB,
        }
      : null
  const disco =
    st && st.d !== undefined && st.du !== undefined
      ? { usadoBytes: st.du * GB, totalBytes: st.d * GB }
      : null
  const rede =
    st?.b && st.b.length >= 2 ? { enviandoBytesS: st.b[0]!, recebendoBytesS: st.b[1]! } : null

  const containersDetalhe = cs
    .map((c) => ({
      nome: c.name,
      cpuPct: ouNulo(c.cpu),
      memoriaBytes: c.memory === undefined ? null : c.memory * MB,
      desde: c.status ? desdeDoStatus(c.status) : null,
      saude: SAUDE[c.health ?? 0] ?? 'sem_checagem',
    }))
    .sort((a, b) => (b.memoriaBytes ?? -1) - (a.memoriaBytes ?? -1))

  return {
    ...m,
    memoria,
    disco,
    rede,
    containersDetalhe,
    historico: historico.map((a) => ({
      em: dataDoBeszel(a.created),
      cpuPct: ouNulo(a.stats.cpu),
      memPct: ouNulo(a.stats.mp),
      discoPct: ouNulo(a.stats.dp),
      recebendoBytesS: a.stats.b && a.stats.b.length >= 2 ? a.stats.b[1]! : null,
    })),
  }
}

const acimaDoDisco = (m: MaquinaNoBeszel) =>
  m.discoPct !== null && m.discoPct > LIMITES_DA_OFICINA.discoUsoPct
const acimaDaMemoria = (m: MaquinaNoBeszel) =>
  m.memPct !== null && m.memPct > LIMITES_DA_OFICINA.memoriaUsoPct

// Sem verde (invariante 9): lendo é neutro.
export function apresentarMaquina(
  m: MaquinaNoBeszel,
  agora: Date,
): { tom: 'neutro' | 'atencao' | 'sem_resposta'; texto: string | null } {
  if (!m.noAr)
    return { tom: 'sem_resposta', texto: `Sem resposta há ${idadeCurta(m.lidaEm, agora)}` }
  if (acimaDoDisco(m) || acimaDaMemoria(m)) return { tom: 'atencao', texto: null }
  return { tom: 'neutro', texto: null }
}

export function avisosDoBeszel(m: MaquinaNoBeszel): AvisoDaMaquina[] {
  if (!m.noAr) return []
  const avisos: AvisoDaMaquina[] = []
  if (acimaDoDisco(m)) {
    avisos.push({
      tipo: 'disco',
      mensagem: `Disco em ${Math.round(m.discoPct!)}%, acima do limite de ${LIMITES_DA_OFICINA.discoUsoPct}%.`,
      desde: m.lidaEm,
    })
  }
  if (acimaDaMemoria(m)) {
    avisos.push({
      tipo: 'memoria',
      mensagem: `Memória em ${Math.round(m.memPct!)}%, acima do limite de ${LIMITES_DA_OFICINA.memoriaUsoPct}%.`,
      desde: m.lidaEm,
    })
  }
  return avisos
}

export function ligarAoCadastro<T extends MaquinaNoBeszel>(
  ms: T[],
  recursos: { id: string; identificadorExterno: string }[],
): (T & { recursoId: string | null })[] {
  const porNome = new Map(recursos.map((r) => [r.identificadorExterno, r.id]))
  return ms.map((m) => ({ ...m, recursoId: porNome.get(m.nome) ?? null }))
}

// No inventário, o selo de métricas vai nas máquinas que poderiam ter agente: servidores e bancos.
export function temSeloDeMetricas(tipo: TipoRecurso): boolean {
  return tipo === 'SERVIDOR' || tipo === 'BANCO'
}

export function seloDeMetricas(
  identificador: string | null,
  nomes: ReadonlySet<string>,
): 'Beszel' | 'Sem métricas' {
  return identificador !== null && nomes.has(identificador) ? 'Beszel' : 'Sem métricas'
}

export function ordenarMaquinas<T extends MaquinaNoBeszel>(
  ms: T[],
  local: string | null,
  agora: Date,
  criterio: 'cadastro' | 'atencao',
): T[] {
  const peso = (m: T) => {
    if (criterio === 'cadastro') return 0
    const { tom } = apresentarMaquina(m, agora)
    return tom === 'neutro' ? 1 : 0
  }
  return [...ms].sort(
    (a, b) =>
      peso(a) - peso(b) ||
      Number(b.nome === local) - Number(a.nome === local) ||
      a.nome.localeCompare(b.nome, 'pt-BR'),
  )
}

// "0 B/s", "4 KB/s", "1,9 MB/s".
export function formatarTaxa(bytesS: number): string {
  if (bytesS >= MB) return `${(bytesS / MB).toFixed(1).replace('.', ',')} MB/s`
  if (bytesS >= 1024) return `${Math.round(bytesS / 1024)} KB/s`
  return `${Math.round(bytesS)} B/s`
}

const UNIDADES: Record<string, [string, string]> = {
  second: ['segundo', 'segundos'],
  minute: ['minuto', 'minutos'],
  hour: ['hora', 'horas'],
  day: ['dia', 'dias'],
  week: ['semana', 'semanas'],
  month: ['mês', 'meses'],
  year: ['ano', 'anos'],
}

// "Up 2 weeks" → "2 semanas"; "Up About an hour" → "1 hora". Outro texto → null.
export function desdeDoStatus(status: string): string | null {
  const m =
    /^Up (?:About )?(an?|\d+|Less than a) (second|minute|hour|day|week|month|year)s?\b/i.exec(
      status,
    )
  if (!m) return null
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : 1
  const nomes = UNIDADES[m[2]!.toLowerCase()]!
  return `${n} ${n === 1 ? nomes[0] : nomes[1]}`
}
