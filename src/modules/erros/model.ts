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

export interface Limiares {
  /** Eventos a partir dos quais o erro vira demanda. */
  eventos: number
  /** Horas entre o primeiro e o último evento a partir das quais o erro vira demanda. */
  horas: number
  /** Demandas automáticas nas últimas 24 h, somando os projetos. */
  porDia: number
  /** Horas no ar sem o erro voltar até a demanda contar como corrigida. */
  horasSemErro: number
}

export const LIMIARES_PADRAO: Limiares = { eventos: 10, horas: 2, porDia: 3, horasSemErro: 24 }
export const AMBIENTES_PADRAO = ['production', 'producao', 'produção', 'prod', 'live']

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
  /** Nomes de ambiente de produção, em minúsculas. */
  ambientes: string[]
  limiares: Limiares
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

  const limiares = { ...LIMIARES_PADRAO }
  const chaves: [keyof Limiares, string][] = [
    ['eventos', 'GLITCHTIP_LIMIAR_EVENTOS'],
    ['horas', 'GLITCHTIP_LIMIAR_HORAS'],
    ['porDia', 'GLITCHTIP_DEMANDAS_POR_DIA'],
    ['horasSemErro', 'GLITCHTIP_HORAS_SEM_ERRO'],
  ]
  for (const [campo, chave] of chaves) {
    if (vazio(env[chave])) continue
    const n = Number(env[chave]!.trim())
    if (!Number.isInteger(n) || n < 1) return { ok: false, motivo: `${chave} inválido` }
    limiares[campo] = n
  }
  const ambientes = vazio(env.GLITCHTIP_AMBIENTES)
    ? AMBIENTES_PADRAO
    : env
        .GLITCHTIP_AMBIENTES!.split(',')
        .map((a) => a.trim().toLowerCase())
        .filter((a) => a !== '')
  return {
    ok: true,
    config: {
      url,
      org: env.GLITCHTIP_ORG!.trim(),
      token: env.GLITCHTIP_TOKEN!.trim(),
      projetos,
      ambientes,
      limiares,
    },
  }
}

/** Ambientes a pedir na leitura: os de produção; sem ambiente cadastrado, tudo (spec de triagem, 4). */
export function ambientesParaLer(
  cadastrados: string[],
  aceitos: string[],
): { ler: false } | { ler: true; filtro: string[] } {
  if (cadastrados.length === 0) return { ler: true, filtro: [] }
  const filtro = cadastrados.filter((c) => aceitos.includes(c.trim().toLowerCase()))
  return filtro.length > 0 ? { ler: true, filtro } : { ler: false }
}

const TESTE = /(?:^|[^\p{L}])testes?(?:$|[^\p{L}])|(?:^|[^\p{L}.])test(?:$|[^\p{L}])|smoke\s*test/iu

/** Issue de teste ou de antes de a fonte ser ligada não é acompanhada. */
export function ignorada(issue: IssueLida, ligadaEm: Date): boolean {
  return TESTE.test(issue.titulo) || issue.primeiroEm.getTime() < ligadaEm.getTime()
}

function normalizar(texto: string): string {
  return texto
    .replaceAll('\u0000', '')
    .toLowerCase()
    .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '*')
    .replace(/\b(table|relation|column|tabela|coluna)\s+\S+/g, '$1 *')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '#')
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/g, '#')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Chave dos erros parecidos de um projeto: título e lugar sem nomes, ids e números. */
export function grupoDoErro(issue: IssueLida): string {
  return `${normalizar(mascarar(issue.titulo))}|${normalizar(mascarar(issue.onde ?? ''))}`
}

/** O erro persiste: chegou ao limiar de eventos ou seguiu ativo por `horas` desde o primeiro. */
export function persiste(issue: IssueLida, l: Limiares): boolean {
  return (
    issue.eventos >= l.eventos ||
    issue.ultimoEm.getTime() - issue.primeiroEm.getTime() >= l.horas * HORA_MS
  )
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
  /** Quando o Paulo descartou a demanda (evento `encerrada_pelo_paulo`). */
  descartadaEm?: Date | null
}

/** Demanda descartada e o erro teve evento depois do descarte: volta à triagem (spec 2026-11-26-erros-ate-corrigido, 4). */
export function reativada(demanda: SituacaoDaDemanda | null, issue: IssueLida): boolean {
  return (
    demanda !== null &&
    demanda.encerrada === 'descartada' &&
    demanda.descartadaEm != null &&
    issue.ultimoEm.getTime() > demanda.descartadaEm.getTime()
  )
}

/** O momento em que o erro conta como corrigido: `horasSemErro` depois do ar, se não voltou. */
export function corrigidoEm(
  e: { noArEm: Date | null; ultimoEm: Date },
  horasSemErro: number,
): Date | null {
  if (e.noArEm === null || e.ultimoEm.getTime() > e.noArEm.getTime()) return null
  return new Date(e.noArEm.getTime() + horasSemErro * HORA_MS)
}

/** Voltou na espera (a correção não resolveu) ou depois de corrigido (regressão). */
export function comoVoltou(
  noArEm: Date,
  ultimoEm: Date,
  horasSemErro: number,
): { horas: number; antesDeCorrigir: boolean } {
  const ms = ultimoEm.getTime() - noArEm.getTime()
  return { horas: Math.floor(ms / HORA_MS), antesDeCorrigir: ms < horasSemErro * HORA_MS }
}

/** Frase do aviso `erro-voltou` e da descrição da demanda nova. */
export function fraseDoVoltou(v: { horas: number; antesDeCorrigir: boolean }): string {
  return v.antesDeCorrigir
    ? `voltou ${v.horas} h depois de ir ao ar, antes de contar como corrigido: a correção não resolveu`
    : `voltou ${v.horas} h depois de ir ao ar, depois de corrigido: regressão`
}

export type Acao =
  | { tipo: 'abrir'; voltou: boolean }
  | { tipo: 'ligar'; demandaId: string }
  | { tipo: 'observar' }
  | { tipo: 'esperar' }
  | { tipo: 'atualizar' }

/** Spec de triagem: atualizar, abrir o que voltou, ligar ao grupo, observar, esperar ou abrir. */
export function decidir(e: {
  issue: IssueLida
  demanda: SituacaoDaDemanda | null
  /** Demanda aberta (não encerrada) de um erro parecido do mesmo projeto. */
  demandaDoGrupo: string | null
  abertasNoDia: number
  limiares: Limiares
}): Acao {
  const demanda = reativada(e.demanda, e.issue) ? null : e.demanda
  const voltou =
    demanda !== null &&
    demanda.noArEm !== null &&
    e.issue.ultimoEm.getTime() > demanda.noArEm.getTime()
  if (demanda !== null && !voltou) return { tipo: 'atualizar' }
  const cheio = e.abertasNoDia >= e.limiares.porDia
  if (e.demandaDoGrupo !== null) return { tipo: 'ligar', demandaId: e.demandaDoGrupo }
  if (voltou) return cheio ? { tipo: 'esperar' } : { tipo: 'abrir', voltou: true }
  if (!persiste(e.issue, e.limiares)) return { tipo: 'observar' }
  return cheio ? { tipo: 'esperar' } : { tipo: 'abrir', voltou: false }
}

export type EstadoNoQuadro =
  'voltou' | 'novo' | 'em_correcao' | 'na_espera' | 'observando' | 'no_ar' | 'corrigido'

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
  horasSemErro: number = LIMIARES_PADRAO.horasSemErro,
): EstadoNoQuadro | null {
  if (e.resolvidoEm !== null) return null
  const d = e.demanda
  if (d === null) {
    // Sem evento na janela de entrada o worker não mexe mais nela: sai do quadro.
    if (agora.getTime() - e.ultimoEm.getTime() > JANELA_DE_ENTRADA_MS) return null
    return e.esperaDesde !== null ? 'na_espera' : 'observando'
  }
  if (d.noArEm !== null) {
    if (e.esperaDesde !== null) return 'na_espera'
    const corrigido = corrigidoEm({ noArEm: d.noArEm, ultimoEm: e.ultimoEm }, horasSemErro)
    if (corrigido === null) return null
    const desde = agora.getTime() - corrigido.getTime()
    if (desde < 0) return 'no_ar'
    return desde <= CORRIGIDO_NO_QUADRO_MS ? 'corrigido' : null
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
  /** `voltouEm`: quando a volta foi vista (o último evento pode ser bem depois, se esperou vaga). */
  anterior: { id: string; noArEm: Date; voltouEm?: Date } | null,
  ligadas: { titulo: string; link: string }[] = [],
  horasSemErro: number = LIMIARES_PADRAO.horasSemErro,
): string {
  const abertura = anterior
    ? `Este erro voltou depois da correção da demanda /demandas/${anterior.id}, no ar desde ${formatarDataHora(anterior.noArEm)}; ${fraseDoVoltou(comoVoltou(anterior.noArEm, anterior.voltouEm ?? issue.ultimoEm, horasSemErro))}.`
    : 'Erro novo no GlitchTip.'
  return [
    abertura,
    '',
    `- Onde: ${issue.onde ? mascarar(issue.onde) : 'não informado'}`,
    `- Nível: ${issue.nivel}`,
    `- Volume: ${issue.eventos} eventos, ${issue.usuarios} usuários`,
    `- Primeiro evento: ${formatarDataHora(issue.primeiroEm)}; último: ${formatarDataHora(issue.ultimoEm)}`,
    `- Detalhes: ${issue.link}`,
    ...(ligadas.length > 0
      ? [
          '',
          'Erros parecidos nesta demanda:',
          ...ligadas.map((l) => `- ${mascarar(l.titulo)} — ${l.link}`),
        ]
      : []),
  ].join('\n')
}
