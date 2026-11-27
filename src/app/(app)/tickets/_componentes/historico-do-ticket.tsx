import { formatarDataHora } from '@/lib/data'
import type { ItemDoHistorico } from '@/modules/tickets/model'

/** A linha do tempo do ticket, do relato ao que aconteceu com a demanda. */
export function HistoricoDoTicket({ itens }: { itens: ItemDoHistorico[] }) {
  return (
    <ol className="ml-1.5 space-y-2 border-l-2 border-border pl-3">
      {itens.map((i, n) => (
        <li key={n} className="relative text-[13px] text-text-primary">
          <span
            aria-hidden="true"
            className="absolute -left-[19px] top-1.5 size-2 rounded-full bg-border-strong"
          />
          {i.texto}
          {i.detalhe && <span className="block text-xs text-text-secondary">{i.detalhe}</span>}
          <time dateTime={i.em.toISOString()} className="block text-xs text-text-tertiary">
            {formatarDataHora(i.em)}
          </time>
        </li>
      ))}
    </ol>
  )
}
