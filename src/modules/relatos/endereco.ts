// Endereço de um sistema conectado (D83): só https, host público, e a conexão usa o IP conferido.
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class ErroDeEndereco extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroDeEndereco'
  }
}

export const NAO_PUBLICO = 'O endereço do sistema não é público.'

const FAIXAS_V4: readonly [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
]

const v4ParaNumero = (ip: string) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0)

function v4Publico(ip: string): boolean {
  const n = v4ParaNumero(ip)
  return !FAIXAS_V4.some(([rede, bits]) => {
    const mascara = bits === 0 ? 0 : 2 ** 32 - 2 ** (32 - bits)
    return (n & mascara) >>> 0 === (v4ParaNumero(rede) & mascara) >>> 0
  })
}

export function ipPublico(ip: string): boolean {
  const versao = isIP(ip)
  if (versao === 4) return v4Publico(ip)
  if (versao !== 6) return false
  const baixo = ip.toLowerCase()
  const mapeado = baixo.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapeado) return v4Publico(mapeado[1]!)
  if (baixo === '::' || baixo === '::1') return false
  const primeiro = parseInt(baixo.split(':')[0] || '0', 16)
  if ((primeiro & 0xfe00) === 0xfc00) return false // fc00::/7
  if ((primeiro & 0xffc0) === 0xfe80) return false // fe80::/10
  if ((primeiro & 0xff00) === 0xff00) return false // multicast
  return true
}

export function permitirLocal(env: Record<string, string | undefined> = process.env): boolean {
  return env.FLOW_SISTEMAS_PERMITIR_LOCAL === '1'
}

/** Valida e normaliza (sem barra no fim). Não resolve DNS: isso é na hora da conexão. */
export function validarEnderecoDoSistema(
  url: string,
  o: { permitirLocal: boolean },
): { ok: true; url: string } | { ok: false; motivo: string } {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return { ok: false, motivo: 'Endereço inválido.' }
  }
  if (u.protocol !== 'https:' && !(o.permitirLocal && u.protocol === 'http:')) {
    return { ok: false, motivo: 'Use um endereço https.' }
  }
  if (u.username || u.password || u.search || u.hash || url.includes('#') || url.includes('?')) {
    return { ok: false, motivo: 'O endereço não pode ter usuário, senha, consulta ou fragmento.' }
  }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!o.permitirLocal) {
    if (host === 'localhost' || host.endsWith('.localhost'))
      return { ok: false, motivo: NAO_PUBLICO }
    if (isIP(host) && !ipPublico(host)) return { ok: false, motivo: NAO_PUBLICO }
  }
  return { ok: true, url: `${u.origin}${u.pathname.replace(/\/+$/, '')}` }
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>

const resolverPadrao: Resolver = (host) => lookup(host, { all: true, verbatim: true })

/** Todos os IPs do nome precisam ser públicos; devolve o primeiro para fixar na conexão. */
export async function resolverComSeguranca(
  host: string,
  o: { permitirLocal: boolean },
  dns: Resolver = resolverPadrao,
): Promise<{ address: string; family: number }> {
  const limpo = host.replace(/^\[|\]$/g, '')
  const ips = isIP(limpo) ? [{ address: limpo, family: isIP(limpo) }] : await dns(limpo)
  if (ips.length === 0) throw new ErroDeEndereco('O nome do sistema não resolveu.')
  if (!o.permitirLocal && ips.some((i) => !ipPublico(i.address)))
    throw new ErroDeEndereco(NAO_PUBLICO)
  return ips[0]!
}
