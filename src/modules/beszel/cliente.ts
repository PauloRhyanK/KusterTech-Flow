// Leitura da API do hub do Beszel (PocketBase). Só a autenticação e GETs (D82).
import type { z } from 'zod'
import {
  amostraSchema,
  containerSchema,
  sistemaSchema,
  type AmostraBruta,
  type ContainerBruto,
  type SistemaBruto,
} from './contrato'

export type Buscar = (url: string, init: RequestInit) => Promise<Response>

export interface ConfiguracaoDoBeszel {
  url: string
  usuario: string
  senha: string
}

export type Resultado<T> =
  { ok: true; valor: T } | { ok: false; motivo: 'sem_resposta' | 'recusado' }

const TEMPO_LIMITE_MS = 3_000
const ID_DO_POCKETBASE = /^[a-z0-9]{15}$/

class Recusado extends Error {}
class SemResposta extends Error {}

// Data no formato que o PocketBase compara: "2026-11-25 17:06:00.000Z".
function dataDoFiltro(d: Date): string {
  return d.toISOString().replace('T', ' ')
}

function conferirId(id: string): string {
  if (!ID_DO_POCKETBASE.test(id)) throw new Error('id de sistema inválido')
  return id
}

function itensValidos<T>(corpo: unknown, schema: z.ZodType<T>): T[] {
  const itens = (corpo as { items?: unknown } | null)?.items
  if (!Array.isArray(itens)) throw new SemResposta('resposta fora do formato')
  const validos: T[] = []
  for (const item of itens) {
    const r = schema.safeParse(item)
    if (r.success) validos.push(r.data)
  }
  return validos
}

export function criarClienteDoBeszel(config: ConfiguracaoDoBeszel, buscar: Buscar = fetch) {
  let token: string | null = null

  async function chamar(url: string, init: RequestInit): Promise<Response> {
    try {
      return await buscar(url, { ...init, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) })
    } catch {
      throw new SemResposta('sem resposta')
    }
  }

  async function autenticar(): Promise<string> {
    const r = await chamar(`${config.url}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: config.usuario, password: config.senha }),
    })
    if (r.status === 400 || r.status === 401 || r.status === 403) throw new Recusado('recusado')
    if (!r.ok) throw new SemResposta(`status ${r.status}`)
    const corpo = (await r.json().catch(() => null)) as { token?: unknown } | null
    if (typeof corpo?.token !== 'string') throw new SemResposta('resposta fora do formato')
    return corpo.token
  }

  async function ler(caminho: string): Promise<unknown> {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      if (token === null || tentativa > 0) token = await autenticar()
      const r = await chamar(`${config.url}${caminho}`, {
        method: 'GET',
        headers: { Authorization: token },
      })
      if (r.status === 401 || r.status === 403) {
        token = null
        continue
      }
      if (!r.ok) throw new SemResposta(`status ${r.status}`)
      return r.json().catch(() => null)
    }
    throw new Recusado('recusado')
  }

  async function resultado<T>(fazer: () => Promise<T>): Promise<Resultado<T>> {
    try {
      return { ok: true, valor: await fazer() }
    } catch (erro) {
      if (erro instanceof Recusado) return { ok: false, motivo: 'recusado' }
      if (erro instanceof SemResposta) return { ok: false, motivo: 'sem_resposta' }
      throw erro
    }
  }

  const lista = (colecao: string, params: Record<string, string>) =>
    `/api/collections/${colecao}/records?${Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')}`

  return {
    sistemas: (): Promise<Resultado<SistemaBruto[]>> =>
      resultado(async () =>
        itensValidos(await ler(lista('systems', { perPage: '100' })), sistemaSchema),
      ),

    containers: (): Promise<Resultado<ContainerBruto[]>> =>
      resultado(async () =>
        itensValidos(await ler(lista('containers', { perPage: '500' })), containerSchema),
      ),

    async ultimaAmostra(sistemaId: string): Promise<Resultado<AmostraBruta | null>> {
      const id = conferirId(sistemaId)
      return resultado(async () => {
        const corpo = await ler(
          lista('system_stats', {
            filter: `(system='${id}' && type='1m')`,
            sort: '-created',
            perPage: '1',
          }),
        )
        return itensValidos(corpo, amostraSchema)[0] ?? null
      })
    },

    async historico(sistemaId: string, desde: Date): Promise<Resultado<AmostraBruta[]>> {
      const id = conferirId(sistemaId)
      return resultado(async () =>
        itensValidos(
          await ler(
            lista('system_stats', {
              filter: `(system='${id}' && type='20m' && created>='${dataDoFiltro(desde)}')`,
              sort: 'created',
              perPage: '100',
            }),
          ),
          amostraSchema,
        ),
      )
    },
  }
}

export type ClienteDoBeszel = ReturnType<typeof criarClienteDoBeszel>
