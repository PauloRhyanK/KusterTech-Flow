import { randomUUID } from 'node:crypto'
import { interpretarVersao, urlSemCache, type LeituraDaVersao } from './model'

export type LerVersaoNoAr = (url: string) => Promise<LeituraDaVersao>

const ESPERA_DA_LEITURA_MS = 10_000
const LIMITE_DO_CORPO = 10_000

/** Lê `{"commit": "<sha>"}` do site, sem cache no caminho (query `nc` e `Cache-Control`). */
export const lerVersaoNoAr: LerVersaoNoAr = async (url) => {
  try {
    const resposta = await fetch(urlSemCache(url, randomUUID()), {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache', Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(ESPERA_DA_LEITURA_MS),
    })
    if (!resposta.ok) return { tipo: 'fora_do_ar', detalhe: `HTTP ${resposta.status}` }
    return interpretarVersao((await resposta.text()).slice(0, LIMITE_DO_CORPO))
  } catch {
    return { tipo: 'fora_do_ar', detalhe: 'sem resposta' }
  }
}
