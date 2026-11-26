// Leitura da API do GlitchTip (compatível com a do Sentry). Só GET, com o token do `.env` (D81).
import { z } from 'zod'
import type { Configuracao, IssueLida } from './model'

export type Buscar = (url: string, init: RequestInit) => Promise<Response>
export type Falha = { ok: false; motivo: string }

const TEMPO_LIMITE_MS = 15_000
const PAGINAS = 3
const FORA_DO_FORMATO = 'resposta fora do formato'

const data = z.string().transform((v, ctx) => {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'data inválida' })
    return z.NEVER
  }
  return d
})

const issueSchema = z.object({
  id: z.union([z.string().min(1), z.number()]).transform(String),
  title: z.string(),
  culprit: z.string().nullish(),
  level: z.string(),
  status: z.string(),
  count: z.coerce.number().int().nonnegative(),
  userCount: z.coerce.number().int().nonnegative().catch(0),
  firstSeen: data,
  lastSeen: data,
  permalink: z.string().nullish(),
})

function paraIssue(config: Configuracao, bruto: unknown): IssueLida | null {
  const r = issueSchema.safeParse(bruto)
  if (!r.success) return null
  const i = r.data
  return {
    id: i.id,
    titulo: i.title,
    onde: i.culprit ? i.culprit : null,
    nivel: i.level,
    status: i.status,
    eventos: i.count,
    usuarios: i.userCount,
    primeiroEm: i.firstSeen,
    ultimoEm: i.lastSeen,
    link: i.permalink || `${config.url}/${config.org}/issues/${i.id}`,
  }
}

/** O `next` do cabeçalho `Link` quando ainda há resultados; senão `null`. */
export function proximaPagina(link: string | null): string | null {
  if (!link) return null
  for (const parte of link.split(/,\s*(?=<)/)) {
    const url = parte.match(/^<([^>]+)>/)?.[1]
    if (url && /rel="next"/.test(parte) && /results="true"/.test(parte)) return url
  }
  return null
}

/**
 * O token só vai ao endereço configurado (D81: só https): da URL do `next` aproveita só o caminho e
 * o cursor, mesmo quando o GlitchTip atrás de um proxy devolve `http://` ou outro host.
 */
function noEnderecoConfigurado(config: Configuracao, proxima: string): string | null {
  try {
    const u = new URL(proxima, config.url)
    return new URL(`${u.pathname}${u.search}`, config.url).toString()
  } catch {
    return null
  }
}

type Resposta = { ok: true; corpo: unknown; link: string | null; status: number } | Falha

async function pedir(config: Configuracao, url: string, buscar: Buscar): Promise<Resposta> {
  let res: Response
  try {
    res = await buscar(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${config.token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      cache: 'no-store',
      redirect: 'error',
    })
  } catch (err) {
    const nome = (err as { name?: string } | null)?.name
    return {
      ok: false,
      motivo:
        nome === 'TimeoutError' || nome === 'AbortError'
          ? 'sem resposta (tempo esgotado)'
          : 'sem resposta (rede)',
    }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, motivo: 'token recusado' }
  if (res.status === 404) return { ok: true, corpo: null, link: null, status: 404 }
  if (!res.ok) return { ok: false, motivo: `sem resposta (HTTP ${res.status})` }
  try {
    return { ok: true, corpo: await res.json(), link: res.headers.get('link'), status: res.status }
  } catch {
    return { ok: false, motivo: FORA_DO_FORMATO }
  }
}

const doProjeto = (config: Configuracao, slug: string) =>
  `${config.url}/api/0/projects/${encodeURIComponent(config.org)}/${encodeURIComponent(slug)}`

/** Nomes dos ambientes cadastrados no projeto. */
export async function listarAmbientes(
  config: Configuracao,
  slug: string,
  buscar: Buscar,
): Promise<{ ok: true; nomes: string[] } | Falha> {
  const r = await pedir(config, `${doProjeto(config, slug)}/environments/`, buscar)
  if (!r.ok) return r
  // Sem a rota de ambientes (ou o projeto sumiu): lê sem filtro; a lista de issues dirá o resto.
  if (r.status === 404) return { ok: true, nomes: [] }
  const lista = z.array(z.object({ name: z.string() })).safeParse(r.corpo)
  return lista.success
    ? { ok: true, nomes: lista.data.map((a) => a.name) }
    : { ok: false, motivo: FORA_DO_FORMATO }
}

/**
 * Issues não resolvidas do projeto, até 3 páginas, só dos ambientes pedidos (vazio: todos); itens
 * tortos são pulados e contados.
 */
export async function listarIssues(
  config: Configuracao,
  slug: string,
  buscar: Buscar,
  ambientes: string[] = [],
): Promise<{ ok: true; issues: IssueLida[]; tortas: number } | Falha> {
  let url: string | null =
    `${doProjeto(config, slug)}/issues/?query=${encodeURIComponent('is:unresolved')}` +
    ambientes.map((a) => `&environment=${encodeURIComponent(a)}`).join('')
  const issues: IssueLida[] = []
  let tortas = 0
  for (let pagina = 0; pagina < PAGINAS && url !== null; pagina++) {
    const r = await pedir(config, url, buscar)
    if (!r.ok) return r
    if (r.status === 404) return { ok: false, motivo: 'projeto não encontrado no GlitchTip' }
    if (!Array.isArray(r.corpo)) return { ok: false, motivo: FORA_DO_FORMATO }
    for (const bruto of r.corpo) {
      const issue = paraIssue(config, bruto)
      if (issue) issues.push(issue)
      else tortas += 1
    }
    const proxima = proximaPagina(r.link)
    url = proxima === null ? null : noEnderecoConfigurado(config, proxima)
  }
  return { ok: true, issues, tortas }
}

/** Uma issue pelo id; 404 (apagada) devolve `issue: null`. */
export async function lerIssue(
  config: Configuracao,
  issueId: string,
  buscar: Buscar,
): Promise<{ ok: true; issue: IssueLida | null } | Falha> {
  const r = await pedir(
    config,
    `${config.url}/api/0/issues/${encodeURIComponent(issueId)}/`,
    buscar,
  )
  if (!r.ok) return r
  if (r.status === 404) return { ok: true, issue: null }
  const issue = paraIssue(config, r.corpo)
  return issue ? { ok: true, issue } : { ok: false, motivo: FORA_DO_FORMATO }
}
