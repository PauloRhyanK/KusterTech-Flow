// Regras dos erros do GlitchTip (spec 2026-11-26-erros-do-glitchtip, seção 6): o que entra, o que
// fazer com cada issue, o estado no quadro, as barrinhas e a máscara de dados pessoais.
import { formatarDataHora } from '@/lib/data'
import { LIMITE_DO_TITULO } from '@/modules/demandas/model'

const HORA_MS = 60 * 60_000
const DIA_MS = 24 * HORA_MS
const JANELA_DE_ENTRADA_MS = 7 * DIA_MS
const CORRIGIDO_NO_QUADRO_MS = DIA_MS
const PONTOS_NA_SERIE = 6
const HORAS_NAS_BARRINHAS = 5

export const TETO_POR_HORA = 5

export interface IssueLida {
  id: string
  titulo: string
  onde: string | null
  nivel: string
  status: string
  eventos: number
  usuarios: number
  primeiroEm: Date
  ultimoEm: Date
  link: string
}

export interface ProjetoConfigurado {
  slug: string
  /** `dono/repositório`, como o `nomeCompleto` do catálogo do GitHub. */
  repositorio: string
}

export interface Configuracao {
  url: string
  org: string
  token: string
  projetos: ProjetoConfigurado[]
}

export const NAO_CONFIGURADO = 'GlitchTip não configurado'

const vazio = (v: string | undefined) => (v ?? '').trim() === ''

export function lerConfiguracao(
  env: Record<string, string | undefined>,
): { ok: true; config: Configuracao } | { ok: false; motivo: string } {
  if (vazio(env.GLITCHTIP_URL) || vazio(env.GLITCHTIP_TOKEN) || vazio(env.GLITCHTIP_PROJETOS)) {
    return { ok: false, motivo: NAO_CONFIGURADO }
  }
  if (vazio(env.GLITCHTIP_ORG)) return { ok: false, motivo: 'GLITCHTIP_ORG ausente' }
  const url = env.GLITCHTIP_URL!.trim().replace(/\/+$/, '')
  let protocolo: string
  try {
    protocolo = new URL(url).protocol
  } catch {
    return { ok: false, motivo: 'GLITCHTIP_URL inválida' }
  }
  if (protocolo !== 'https:') return { ok: false, motivo: 'GLITCHTIP_URL precisa ser https' }

  const projetos: ProjetoConfigurado[] = []
  const itens = env
    .GLITCHTIP_PROJETOS!.split(',')
    .map((i) => i.trim())
    .filter((i) => i !== '')
  for (const item of itens) {
    const separador = item.indexOf(':')
    const slug = separador > 0 ? item.slice(0, separador).trim() : ''
    const repositorio = separador > 0 ? item.slice(separador + 1).trim() : ''
    if (slug === '' || !/^[^/\s]+\/[^/\s]+$/.test(repositorio)) {
      return { ok: false, motivo: `Item inválido em GLITCHTIP_PROJETOS: ${item}` }
    }
    if (projetos.some((p) => p.slug === slug)) {
      return { ok: false, motivo: `Projeto repetido em GLITCHTIP_PROJETOS: ${slug}` }
    }
    projetos.push({ slug, repositorio })
  }
  if (projetos.length === 0) return { ok: false, motivo: NAO_CONFIGURADO }
  return {
    ok: true,
    config: { url, org: env.GLITCHTIP_ORG!.trim(), token: env.GLITCHTIP_TOKEN!.trim(), projetos },
  }
}

/** Nível error ou fatal, não resolvida e com evento nos últimos 7 dias. */
export function entra(issue: IssueLida, agora: Date): boolean {
  return (
    (issue.nivel === 'error' || issue.nivel === 'fatal') &&
    issue.status === 'unresolved' &&
    agora.getTime() - issue.ultimoEm.getTime() <= JANELA_DE_ENTRADA_MS
  )
}

export interface SituacaoDaDemanda {
  encerrada: string | null
  noArEm: Date | null
}

export type Acao = { tipo: 'abrir'; voltou: boolean } | { tipo: 'esperar' } | { tipo: 'atualizar' }

/** Tabela 6.2: abrir (nova ou voltou, dentro do teto), esperar o teto, ou só atualizar. */
export function decidir(e: {
  issue: IssueLida
  demanda: SituacaoDaDemanda | null
  abertasNaUltimaHora: number
}): Acao {
  const voltou =
    e.demanda !== null &&
    e.demanda.noArEm !== null &&
    e.issue.ultimoEm.getTime() > e.demanda.noArEm.getTime()
  if (e.demanda !== null && !voltou) return { tipo: 'atualizar' }
  if (e.abertasNaUltimaHora >= TETO_POR_HORA) return { tipo: 'esperar' }
  return { tipo: 'abrir', voltou }
}

export type EstadoNoQuadro = 'voltou' | 'novo' | 'em_correcao' | 'na_espera' | 'corrigido'

/** Tabela 6.3; `null` é fora do quadro. */
export function estadoNoQuadro(
  e: {
    resolvidoEm: Date | null
    esperaDesde: Date | null
    ultimoEm: Date
    voltou: boolean
    demanda: (SituacaoDaDemanda & { naPrimeiraEtapa: boolean }) | null
  },
  agora: Date,
): EstadoNoQuadro | null {
  if (e.resolvidoEm !== null) return null
  const d = e.demanda
  if (d === null) return e.esperaDesde !== null ? 'na_espera' : null
  if (d.noArEm !== null) {
    if (e.esperaDesde !== null) return 'na_espera'
    if (e.ultimoEm.getTime() > d.noArEm.getTime()) return null
    return agora.getTime() - d.noArEm.getTime() <= CORRIGIDO_NO_QUADRO_MS ? 'corrigido' : null
  }
  if (d.encerrada !== null) return null
  if (e.voltou) return 'voltou'
  return d.naPrimeiraEtapa ? 'novo' : 'em_correcao'
}

export interface Ponto {
  /** Hora UTC truncada, em ISO. */
  hora: string
  total: number
}

function horaTruncada(d: Date): string {
  const h = new Date(d.getTime())
  h.setUTCMinutes(0, 0, 0)
  return h.toISOString()
}

export function acrescentarPonto(serie: Ponto[], total: number, agora: Date): Ponto[] {
  const hora = horaTruncada(agora)
  const base = serie.at(-1)?.hora === hora ? serie.slice(0, -1) : serie
  return [...base, { hora, total }].slice(-PONTOS_NA_SERIE)
}

/** Eventos por hora nas últimas 5 h (da mais antiga à atual); vermelho quando a última sobe. */
export function barrinhas(serie: Ponto[], agora: Date): { valores: number[]; subindo: boolean } {
  const atual = new Date(horaTruncada(agora)).getTime()
  const valores: number[] = []
  for (let h = HORAS_NAS_BARRINHAS - 1; h >= 0; h--) {
    const hora = new Date(atual - h * HORA_MS).toISOString()
    const i = serie.findIndex((p) => p.hora === hora)
    valores.push(i > 0 ? Math.max(0, serie[i]!.total - serie[i - 1]!.total) : 0)
  }
  const ultima = valores.at(-1)!
  const anteriores = valores.slice(0, -1)
  const media = anteriores.reduce((a, b) => a + b, 0) / anteriores.length
  return { valores, subindo: ultima > 0 && ultima > media }
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const CNPJ = /(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g
const CPF = /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g
const TELEFONE = /(?<![\w+])(?:\+?55[\s-]?)?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}(?!\d)/g

/** E-mail, CPF/CNPJ e telefone saem antes de o texto virar demanda (invariante 10). */
export function mascarar(texto: string): string {
  return texto
    .replaceAll('\u0000', '')
    .replace(EMAIL, '[e-mail]')
    .replace(CNPJ, '[documento]')
    .replace(CPF, '[documento]')
    .replace(TELEFONE, '[telefone]')
}

export function tituloDaDemanda(issue: IssueLida): string {
  const titulo = `Erro: ${mascarar(issue.titulo)}`
  return titulo.length > LIMITE_DO_TITULO ? `${titulo.slice(0, LIMITE_DO_TITULO - 1)}…` : titulo
}

export function descricaoDaDemanda(
  issue: IssueLida,
  anterior: { id: string; noArEm: Date } | null,
): string {
  const abertura = anterior
    ? `Este erro voltou depois da correção da demanda /demandas/${anterior.id}, no ar desde ${formatarDataHora(anterior.noArEm)}.`
    : 'Erro novo no GlitchTip.'
  return [
    abertura,
    '',
    `- Onde: ${issue.onde ? mascarar(issue.onde) : 'não informado'}`,
    `- Nível: ${issue.nivel}`,
    `- Volume: ${issue.eventos} eventos, ${issue.usuarios} usuários`,
    `- Primeiro evento: ${formatarDataHora(issue.primeiroEm)}; último: ${formatarDataHora(issue.ultimoEm)}`,
    `- Detalhes: ${issue.link}`,
  ].join('\n')
}
