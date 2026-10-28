import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import type { Indicador } from '@/modules/visao-geral/model'

export interface ListaDeIndicadoresProps {
  indicadores: readonly Indicador[]
}

export function ListaDeIndicadores({ indicadores }: ListaDeIndicadoresProps) {
  return (
    <dl className="divide-y divide-border overflow-hidden rounded-padrao border border-border bg-surface">
      {indicadores.map((indicador) => (
        <div
          key={indicador.rotulo}
          data-sem-dados={indicador.semDados ? '' : undefined}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
        >
          <div className="min-w-0">
            <dt className="text-[13px] font-medium text-text-primary">{indicador.rotulo}</dt>
            <dd className="text-[13px] text-text-secondary">{indicador.detalhe}</dd>
          </div>
          <dd className="shrink-0 text-[15px] font-[650] text-text-primary">
            {indicador.semDados ? (
              <BadgeDeEstado tom="neutro">Sem dados</BadgeDeEstado>
            ) : (
              indicador.valor
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
