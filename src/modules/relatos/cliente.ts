// Cliente HTTP dos sistemas conectados (D83). Só fala com o IP conferido (lookup fixado), não segue
// redirecionamento, limita tempo e tamanho e manda o token só para a origem cadastrada.
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import {
  type AndamentoDoFio,
  LIMITE_DA_MENSAGEM,
  LIMITE_DA_RESPOSTA_DO_ANDAMENTO,
  LIMITE_DO_CORPO_DA_PAGINA,
  lerPagina,
  type RelatoDoFio,
  RELATOS_POR_PAGINA,
} from './contrato'
import {
  ErroDeEndereco,
  type Resolver,
  resolverComSeguranca,
  validarEnderecoDoSistema,
} from './endereco'

export type FalhaDoSistema =
  | { tipo: 'token_recusado' }
  | { tipo: 'fora_do_ar'; motivo: string }
  | { tipo: 'contrato'; motivo: string }
  | { tipo: 'endereco'; motivo: string }

export interface AlvoDoSistema {
  url: string
  token: string
  permitirLocal: boolean
}

export interface OpcoesDoCliente {
  tempoMs?: number
  dns?: Resolver
}

const TEMPO_PADRAO_MS = 10_000
const USER_AGENT = 'KusterTech-Flow/relatos'

type Resposta = { status: number; corpo: Buffer; excedeu: boolean }

class TempoEsgotado extends Error {}

async function requisitar(
  alvo: AlvoDoSistema,
  metodo: 'GET' | 'POST',
  url: string,
  o: OpcoesDoCliente & { corpo?: string; limite: number },
): Promise<Resposta> {
  const u = new URL(url)
  const ip = await resolverComSeguranca(u.hostname, { permitirLocal: alvo.permitirLocal }, o.dns)
  const tempoMs = o.tempoMs ?? TEMPO_PADRAO_MS
  const modulo = u.protocol === 'https:' ? https : http
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const cabecalhos: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
    Authorization: `Bearer ${alvo.token}`,
  }
  if (o.corpo !== undefined) {
    cabecalhos['Content-Type'] = 'application/json'
    cabecalhos['Content-Length'] = String(Buffer.byteLength(o.corpo))
  }
  return new Promise<Resposta>((resolve, reject) => {
    let terminou = false
    const fim = (f: () => void) => {
      if (terminou) return
      terminou = true
      clearTimeout(relogio)
      f()
    }
    const req = modulo.request(
      {
        protocol: u.protocol,
        hostname: host,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: metodo,
        headers: cabecalhos,
        servername: isIP(host) ? undefined : host,
        agent: false,
        lookup: (_h, opcoes, cb) => {
          if ((opcoes as { all?: boolean }).all) {
            ;(cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
              ip,
            ])
          } else cb(null, ip.address, ip.family)
        },
      },
      (res) => {
        const pedacos: Buffer[] = []
        let total = 0
        res.on('data', (c: Buffer) => {
          total += c.length
          if (total > o.limite) {
            fim(() =>
              resolve({ status: res.statusCode ?? 0, corpo: Buffer.alloc(0), excedeu: true }),
            )
            req.destroy()
            return
          }
          pedacos.push(c)
        })
        res.on('end', () =>
          fim(() =>
            resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(pedacos), excedeu: false }),
          ),
        )
        res.on('error', (e) => fim(() => reject(e)))
      },
    )
    const relogio = setTimeout(() => {
      fim(() => reject(new TempoEsgotado()))
      req.destroy()
    }, tempoMs)
    req.on('error', (e) => fim(() => reject(e)))
    req.end(o.corpo)
  })
}

const segundos = (ms: number) => `${Math.round(ms / 1000)} s`

function falhaDeRede(err: unknown, tempoMs: number): FalhaDoSistema {
  if (err instanceof ErroDeEndereco) return { tipo: 'endereco', motivo: err.message }
  if (err instanceof TempoEsgotado) {
    return { tipo: 'fora_do_ar', motivo: `O sistema não respondeu em ${segundos(tempoMs)}.` }
  }
  const codigo = (err as { code?: string } | null)?.code
  return { tipo: 'fora_do_ar', motivo: `Não consegui conectar${codigo ? ` (${codigo})` : ''}.` }
}

function urlDoSistema(alvo: AlvoDoSistema, caminho: string): string {
  const v = validarEnderecoDoSistema(alvo.url, { permitirLocal: alvo.permitirLocal })
  if (!v.ok) throw new ErroDeEndereco(v.motivo)
  return `${v.url}${caminho}`
}

export type PaginaBuscada =
  | { ok: true; relatos: RelatoDoFio[]; cursor: string; mais: boolean }
  | { ok: false; falha: FalhaDoSistema }

/** `GET <base>/relatos?limite=50[&desde=<cursor>]`. */
export async function buscarPagina(
  alvo: AlvoDoSistema,
  desde: string | null,
  o: OpcoesDoCliente = {},
): Promise<PaginaBuscada> {
  const tempoMs = o.tempoMs ?? TEMPO_PADRAO_MS
  let r: Resposta
  try {
    const consulta = new URLSearchParams({ limite: String(RELATOS_POR_PAGINA) })
    if (desde !== null) consulta.set('desde', desde)
    r = await requisitar(alvo, 'GET', urlDoSistema(alvo, `/relatos?${consulta}`), {
      ...o,
      limite: LIMITE_DO_CORPO_DA_PAGINA,
    })
  } catch (err) {
    return { ok: false, falha: falhaDeRede(err, tempoMs) }
  }
  if (r.status === 401 || r.status === 403) return { ok: false, falha: { tipo: 'token_recusado' } }
  if (r.status >= 300 && r.status < 400) {
    return {
      ok: false,
      falha: { tipo: 'fora_do_ar', motivo: 'O sistema respondeu com redirecionamento.' },
    }
  }
  if (r.excedeu) {
    const mb = Math.round(LIMITE_DO_CORPO_DA_PAGINA / 1_048_576)
    return { ok: false, falha: { tipo: 'contrato', motivo: `A resposta passou de ${mb} MB.` } }
  }
  if (r.status < 200 || r.status >= 300) {
    return { ok: false, falha: { tipo: 'fora_do_ar', motivo: `O sistema respondeu ${r.status}.` } }
  }
  let corpo: unknown
  try {
    corpo = JSON.parse(r.corpo.toString('utf8'))
  } catch {
    return { ok: false, falha: { tipo: 'contrato', motivo: 'A resposta do sistema não é JSON.' } }
  }
  const pagina = lerPagina(corpo, RELATOS_POR_PAGINA)
  if (!pagina.ok) return { ok: false, falha: { tipo: 'contrato', motivo: pagina.motivo } }
  return pagina
}

export type ResultadoDoEnvio =
  | { resultado: 'enviado' }
  | { resultado: 'descartar'; motivo: string }
  | { resultado: 'tentar_de_novo'; motivo: string }
  | { resultado: 'token_recusado' }

function motivoDoErro(corpo: Buffer): string {
  try {
    const e = (JSON.parse(corpo.toString('utf8')) as { erro?: unknown }).erro
    if (typeof e === 'string' && e) return e.slice(0, 200)
    if (e && typeof e === 'object') {
      const { mensagem, codigo } = e as { mensagem?: unknown; codigo?: unknown }
      if (typeof mensagem === 'string' && mensagem) return mensagem.slice(0, 200)
      if (typeof codigo === 'string' && codigo)
        return `O sistema recusou o andamento (${codigo.slice(0, 60)}).`
    }
  } catch {
    // corpo sem JSON: motivo genérico abaixo
  }
  return 'O sistema recusou o andamento.'
}

/** `POST <base>/relatos/<id>/andamento` com `{ estado, mensagem }`; o sistema não avisa duas vezes. */
export async function enviarAndamento(
  alvo: AlvoDoSistema,
  relatoIdExterno: string,
  a: AndamentoDoFio,
  o: OpcoesDoCliente = {},
): Promise<ResultadoDoEnvio> {
  const tempoMs = o.tempoMs ?? TEMPO_PADRAO_MS
  const corpo = JSON.stringify({
    estado: a.estado,
    mensagem: a.mensagem.slice(0, LIMITE_DA_MENSAGEM),
  })
  let r: Resposta
  try {
    r = await requisitar(
      alvo,
      'POST',
      urlDoSistema(alvo, `/relatos/${encodeURIComponent(relatoIdExterno)}/andamento`),
      { ...o, corpo, limite: LIMITE_DA_RESPOSTA_DO_ANDAMENTO },
    )
  } catch (err) {
    const f = falhaDeRede(err, tempoMs)
    return { resultado: 'tentar_de_novo', motivo: 'motivo' in f ? f.motivo : 'Falha de rede.' }
  }
  if (r.status >= 200 && r.status < 300) return { resultado: 'enviado' }
  if (r.status === 401 || r.status === 403) return { resultado: 'token_recusado' }
  if (r.status === 404 || r.status === 410) {
    return { resultado: 'descartar', motivo: 'O sistema não conhece este relato.' }
  }
  if (r.status === 400 || r.status === 422)
    return { resultado: 'descartar', motivo: motivoDoErro(r.corpo) }
  return { resultado: 'tentar_de_novo', motivo: `O sistema respondeu ${r.status}.` }
}
