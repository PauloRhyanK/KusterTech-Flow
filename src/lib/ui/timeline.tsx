import type { ReactNode } from 'react'
import { Cog, User } from 'lucide-react'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado, type TomDeEstado } from './badge-de-estado'

export interface EventoDaTimeline {
  id: string
  titulo: string
  origem: 'humano' | 'sistema'
  autor: string | null
  quando: Date
  versao: { id: string; rotulo: string } | null
  visibilidade: 'interna' | 'compartilhavel'
  texto: string | null
  estado?: { texto: string; tom: TomDeEstado }
  // Bloco extra sob o texto do evento (por exemplo, a triagem da correção).
  anexo?: ReactNode
}

const porData = (a: EventoDaTimeline, b: EventoDaTimeline) =>
  a.quando.getTime() - b.quando.getTime()

function EventoDaLinha({ evento }: { evento: EventoDaTimeline }) {
  const sistema = evento.origem === 'sistema'
  return (
    <li className="space-y-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {sistema ? (
          <Cog
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
            className="shrink-0 text-informacao"
          />
        ) : (
          <User
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
            className="shrink-0 text-text-secondary"
          />
        )}
        <span className="font-[600] text-text-primary">{evento.titulo}</span>
        <span className="text-text-secondary">{sistema ? 'Sistema' : (evento.autor ?? '—')}</span>
        <time dateTime={evento.quando.toISOString()} className="text-text-secondary">
          {formatarDataHora(evento.quando)}
        </time>
        <BadgeDeEstado tom={evento.visibilidade === 'interna' ? 'neutro' : 'informacao'}>
          {evento.visibilidade === 'interna' ? 'Interna' : 'Compartilhável'}
        </BadgeDeEstado>
        {evento.estado && (
          <BadgeDeEstado tom={evento.estado.tom}>{evento.estado.texto}</BadgeDeEstado>
        )}
      </div>
      {evento.texto && (
        <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{evento.texto}</p>
      )}
      {evento.anexo}
    </li>
  )
}

export function ListaDeEventos({ eventos }: { eventos: readonly EventoDaTimeline[] }) {
  return (
    <ol className="divide-y divide-border">
      {[...eventos].sort(porData).map((e) => (
        <EventoDaLinha key={e.id} evento={e} />
      ))}
    </ol>
  )
}
