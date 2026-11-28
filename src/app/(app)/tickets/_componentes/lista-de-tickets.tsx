import Link from 'next/link'
import { MessageCircle, Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatarDataHora } from '@/lib/data'
import {
  urlDosTickets,
  type FiltrosDosTickets,
  type GrupoDeTickets,
  type ResultadoNaTela,
  type TicketNaLista,
  type TipoDeMidia,
} from '@/modules/tickets/model'

export const ROTULO_DO_CANAL = { SISTEMA: 'app', WHATSAPP: 'WhatsApp' } as const

const CHIP: Record<ResultadoNaTela, { texto: string; classe: string }> = {
  virou_demanda: { texto: 'demanda', classe: 'border-execucao text-execucao' },
  orientado: { texto: 'orientado', classe: 'border-informacao text-informacao' },
  sem_demanda: { texto: 'sem demanda', classe: 'border-atencao text-atencao' },
}

export function ChipDoResultado({ resultado }: { resultado: ResultadoNaTela }) {
  const c = CHIP[resultado]
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded-compacto border px-1.5 py-px text-[11px] font-medium',
        c.classe,
      )}
    >
      {c.texto}
    </span>
  )
}

const HORA_CURTA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** "27/11 12:00": cabe na linha sem cortar o resumo; a data completa fica no `title`. */
function horaCurta(em: Date): string {
  return HORA_CURTA.format(em).replace(', ', ' ')
}

const MIDIA: Record<TipoDeMidia, [string, string]> = {
  imagem: ['imagem', 'imagens'],
  audio: ['áudio', 'áudios'],
  video: ['vídeo', 'vídeos'],
  arquivo: ['arquivo', 'arquivos'],
}

function resumoDasMidias(m: TicketNaLista['midias']): string {
  return (Object.keys(MIDIA) as TipoDeMidia[])
    .filter((t) => m[t] > 0)
    .map((t) => `${m[t]} ${MIDIA[t][m[t] === 1 ? 0 : 1]}`)
    .join(' · ')
}

function Linha({
  ticket,
  filtros,
  escolhido,
}: {
  ticket: TicketNaLista
  filtros: FiltrosDosTickets
  escolhido: boolean
}) {
  const Icone = ticket.canal === 'WHATSAPP' ? MessageCircle : Smartphone
  const midias = resumoDasMidias(ticket.midias)
  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        href={urlDosTickets(filtros, { t: ticket.id })}
        aria-current={escolhido ? 'true' : undefined}
        className={cn(
          'flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring',
          escolhido && 'bg-surface-subtle shadow-[inset_3px_0_0] shadow-action-primary',
        )}
      >
        <span className="grid size-[26px] shrink-0 place-items-center rounded-compacto bg-surface-subtle text-text-secondary">
          <Icone size={14} strokeWidth={1.75} aria-label={ROTULO_DO_CANAL[ticket.canal]} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-text-primary">{ticket.resumo}</span>
          <span className="block truncate text-xs text-text-secondary">
            {`${ticket.autor.nome} · ${ticket.sistema.nome} · ${ROTULO_DO_CANAL[ticket.canal]}`}
          </span>
        </span>
        {midias && <span className="shrink-0 text-xs text-text-secondary">{midias}</span>}
        <ChipDoResultado resultado={ticket.resultado} />
        <time
          dateTime={ticket.em.toISOString()}
          title={formatarDataHora(ticket.em)}
          className="hidden shrink-0 text-xs tabular-nums text-text-tertiary xl:block"
        >
          {horaCurta(ticket.em)}
        </time>
      </Link>
    </li>
  )
}

/** Os tickets agrupados; cada linha leva ao detalhe mantendo os filtros. */
export function ListaDeTickets({
  grupos,
  filtros,
  escolhidoId,
}: {
  grupos: GrupoDeTickets[]
  filtros: FiltrosDosTickets
  escolhidoId: string | null
}) {
  if (grupos.length === 0) {
    return <p className="py-6 text-sm text-text-secondary">Nada com estes filtros</p>
  }
  return (
    <div className="space-y-4">
      {grupos.map((g) => (
        <section key={g.chave} aria-label={g.rotulo}>
          <h3 className="mb-1.5 text-xs text-text-secondary">
            <span className="font-[550] text-text-primary">{g.rotulo}</span>
            {` · ${g.tickets.length}`}
          </h3>
          <ul className="overflow-hidden rounded-padrao border border-border bg-surface">
            {g.tickets.map((t) => (
              <Linha key={t.id} ticket={t} filtros={filtros} escolhido={t.id === escolhidoId} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
