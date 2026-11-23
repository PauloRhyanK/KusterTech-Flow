import Link from 'next/link'
import type { DemandaQueVemAi } from '@/modules/demandas/apresentacao'
import { CLASSE_DO_CARTAO, TituloDeSecao } from '@/lib/ui/titulo-de-secao'
import { cn } from '@/lib/utils'

import { TOM_DO_ESTADO } from '@/app/(app)/demandas/_componentes/lista-de-demandas'

/** As demandas que a Fábrica ainda está fazendo: só aparecem na fila acima quando ficam prontas. */
export function VemAiDaFabrica({ demandas }: { demandas: readonly DemandaQueVemAi[] }) {
  return (
    <section aria-labelledby="titulo-vem-ai" className="min-w-0">
      <TituloDeSecao id="titulo-vem-ai">Vem aí da Fábrica</TituloDeSecao>
      <div className={CLASSE_DO_CARTAO}>
        {demandas.length === 0 ? (
          <p className="px-4 py-3 text-sm text-text-secondary">
            A Fábrica não está fazendo nenhuma demanda agora.
          </p>
        ) : (
          <ul aria-label="Vem aí da Fábrica" className="divide-y divide-border">
            {demandas.map((d) => (
              <li
                key={d.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/demandas/${d.id}`}
                    className="block truncate text-sm font-[650] text-text-primary hover:underline"
                    title={d.titulo}
                  >
                    {d.titulo}
                  </Link>
                  <p className="truncate text-xs text-text-secondary">{d.projeto}</p>
                </div>
                <span className={cn('whitespace-nowrap text-sm', TOM_DO_ESTADO[d.estado.tom])}>
                  {d.estado.texto}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-2 text-xs text-text-secondary">
        Ainda em produção. Elas sobem sozinhas quando ficam prontas e aí entram na fila acima.
      </p>
    </section>
  )
}
