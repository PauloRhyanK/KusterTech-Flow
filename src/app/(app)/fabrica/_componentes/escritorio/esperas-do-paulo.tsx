// O que espera o Paulo na Fábrica, da espera mais longa para a mais curta. Passou de 2 h, ganha o tom de erro.
import Link from 'next/link'
import { TEXTO_DA_ESPERA } from '@/modules/demandas/apresentacao'
import { duracaoDaEspera } from '@/modules/demandas/model'
import type { EsperaDoPaulo } from '@/modules/fabrica/escritorio/model'

function textoDoQueFalta(espera: string): string {
  if (espera === 'concluir_etapa') return 'Concluir a etapa'
  return (TEXTO_DA_ESPERA as Record<string, string>)[espera] ?? 'Sua vez'
}

export function EsperasDoPaulo({ esperas }: { esperas: EsperaDoPaulo[] }) {
  if (esperas.length === 0) return null
  return (
    <section aria-labelledby="esperas-do-paulo" className="space-y-2">
      <h2 id="esperas-do-paulo" className="text-sm font-semibold text-text-primary">
        Esperando você
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {esperas.map((e) => (
          <li
            key={e.demandaId}
            data-longa={e.longa}
            className={`rounded-padrao border p-3 ${
              e.longa ? 'border-erro/30 bg-tonal-erro' : 'border-border bg-tonal-atencao'
            }`}
          >
            <Link
              href={`/demandas/${e.demandaId}`}
              className="block rounded-compacto focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <b className="block truncate text-sm text-text-primary">{e.titulo}</b>
              <span className="block text-xs text-text-secondary">
                {textoDoQueFalta(e.espera)} · {e.repositorio}
              </span>
              <span
                className={`mt-1 block text-xs ${e.longa ? 'font-semibold text-erro' : 'text-atencao'}`}
              >
                esperando você há {duracaoDaEspera(e.minutos)}
                {e.longa ? ' · passou de 2 h' : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
