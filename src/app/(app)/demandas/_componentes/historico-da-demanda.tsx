import type { EventoNoHistorico } from '@/modules/demandas/apresentacao'
import { formatarDataHora } from '@/lib/data'
import { CLASSE_DO_CARTAO } from '@/lib/ui/titulo-de-secao'
import { cn } from '@/lib/utils'

// O que aconteceu na demanda, do mais novo ao mais antigo, recolhido: abre com um toque.
export function HistoricoDaDemanda({ eventos }: { eventos: readonly EventoNoHistorico[] }) {
  if (eventos.length === 0) return null
  const n = eventos.length
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-baseline gap-2.5 rounded-compacto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring [&::-webkit-details-marker]:hidden">
        <h2 className="text-[15px] font-[650] text-text-primary">Histórico</h2>
        <span className="text-[12.5px] text-text-tertiary">
          {n} {n === 1 ? 'evento' : 'eventos'}
        </span>
        <span aria-hidden="true" className="text-xs text-text-tertiary group-open:rotate-180">
          ▾
        </span>
      </summary>
      <ol className={cn(CLASSE_DO_CARTAO, 'mt-2.5 divide-y divide-border')}>
        {eventos.map((e) => (
          <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2.5 text-sm">
            <span className="font-[550] text-text-primary">{e.evento}</span>
            <span className="text-text-secondary">{e.quem}</span>
            <time dateTime={e.quando.toISOString()} className="ml-auto text-xs text-text-tertiary">
              {formatarDataHora(e.quando)}
            </time>
          </li>
        ))}
      </ol>
    </details>
  )
}
