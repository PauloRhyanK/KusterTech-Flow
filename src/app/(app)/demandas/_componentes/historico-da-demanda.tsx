import type { EventoNoHistorico } from '@/modules/demandas/apresentacao'
import { formatarDataHora } from '@/lib/data'
import { CLASSE_DO_CARTAO, TituloDeSecao } from '@/lib/ui/titulo-de-secao'
import { cn } from '@/lib/utils'

// O que aconteceu na demanda, do mais novo ao mais antigo: evento, quem e quando.
export function HistoricoDaDemanda({ eventos }: { eventos: readonly EventoNoHistorico[] }) {
  if (eventos.length === 0) return null
  return (
    <section aria-labelledby="historico-da-demanda">
      <TituloDeSecao id="historico-da-demanda">Histórico</TituloDeSecao>
      <ol className={cn(CLASSE_DO_CARTAO, 'divide-y divide-border')}>
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
    </section>
  )
}
