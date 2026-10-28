import { formatarDataHora } from '@/lib/data'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import type { EventoDaExecucao } from '@/modules/desenvolvimento/model'

export interface LinhaDoTempoDaExecucaoProps {
  eventos: readonly EventoDaExecucao[]
}

export function LinhaDoTempoDaExecucao({ eventos }: LinhaDoTempoDaExecucaoProps) {
  if (eventos.length === 0) {
    return (
      <EstadoVazio
        tipo="sem-evidencia"
        titulo="Nenhum evento com data nas fontes lidas."
        descricao="A linha do tempo mostra só o que o Seeds e o GitHub registraram com data."
      />
    )
  }

  return (
    <ol
      aria-label="Linha do tempo da execução"
      className="divide-y divide-border overflow-hidden rounded-padrao border border-border bg-surface"
    >
      {eventos.map((evento) => (
        <li
          key={`${evento.origem}-${evento.titulo}`}
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-2 text-[13px]"
        >
          <span className="font-medium text-text-primary">{evento.titulo}</span>
          <span className="text-text-secondary">
            <time dateTime={evento.em.toISOString()}>{formatarDataHora(evento.em)}</time>
            {' · '}
            {evento.origem}
          </span>
        </li>
      ))}
    </ol>
  )
}
