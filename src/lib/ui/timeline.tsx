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
}

export interface TimelineProps {
  eventos: readonly EventoDaTimeline[]
  versaoCorrenteId: string | null
  rotulo: string
  vazio: ReactNode
}

interface Grupo {
  chave: string
  titulo: string
  eventos: EventoDaTimeline[]
  maisRecente: number
}

const porData = (a: EventoDaTimeline, b: EventoDaTimeline) =>
  a.quando.getTime() - b.quando.getTime()

function contagem(n: number): string {
  return `${n} ${n === 1 ? 'evento' : 'eventos'}`
}

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
    </li>
  )
}

function ListaDeEventos({ eventos }: { eventos: readonly EventoDaTimeline[] }) {
  return (
    <ol className="divide-y divide-border">
      {[...eventos].sort(porData).map((e) => (
        <EventoDaLinha key={e.id} evento={e} />
      ))}
    </ol>
  )
}

// Histórico por versão (Blueprint §7): a versão atual em QA primeiro e aberta; as demais
// recolhidas, da mais recente para a mais antiga; eventos sem versão por último.
export function Timeline({ eventos, versaoCorrenteId, rotulo, vazio }: TimelineProps) {
  if (eventos.length === 0) {
    return (
      <section aria-label={rotulo}>
        <div className="text-sm text-text-secondary">{vazio}</div>
      </section>
    )
  }

  const porVersao = new Map<string, Grupo>()
  const semVersao: EventoDaTimeline[] = []
  for (const e of eventos) {
    if (!e.versao) {
      semVersao.push(e)
      continue
    }
    const grupo = porVersao.get(e.versao.id) ?? {
      chave: e.versao.id,
      titulo: e.versao.rotulo,
      eventos: [],
      maisRecente: 0,
    }
    grupo.eventos.push(e)
    grupo.maisRecente = Math.max(grupo.maisRecente, e.quando.getTime())
    porVersao.set(e.versao.id, grupo)
  }

  const corrente = versaoCorrenteId ? porVersao.get(versaoCorrenteId) : undefined
  const anteriores = [...porVersao.values()]
    .filter((g) => g !== corrente)
    .sort((a, b) => b.maisRecente - a.maisRecente)

  return (
    <section aria-label={rotulo} className="space-y-3">
      {corrente && (
        <details
          open
          data-versao-corrente="true"
          className="rounded-padrao border border-l-2 border-border border-l-context-active bg-surface"
        >
          <summary className="cursor-pointer px-4 py-3 text-sm font-[600] text-text-primary">
            Versão atual em QA · {corrente.titulo}
          </summary>
          <div className="px-4 pb-4">
            <ListaDeEventos eventos={corrente.eventos} />
          </div>
        </details>
      )}
      {anteriores.map((g) => (
        <details key={g.chave} className="rounded-padrao border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-[600] text-text-primary">
            Versão {g.titulo} · {contagem(g.eventos.length)}
          </summary>
          <div className="px-4 pb-4">
            <ListaDeEventos eventos={g.eventos} />
          </div>
        </details>
      ))}
      {semVersao.length > 0 && (
        <details className="rounded-padrao border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-[600] text-text-primary">
            Sem versão identificada · {contagem(semVersao.length)}
          </summary>
          <div className="px-4 pb-4">
            <ListaDeEventos eventos={semVersao} />
          </div>
        </details>
      )}
    </section>
  )
}
