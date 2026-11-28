import type { Periodo } from '@/modules/tickets/model'
import { cn } from '@/lib/utils'
import { CLASSE_DO_CARTAO } from '@/lib/ui/titulo-de-secao'

export interface QuadrosDoPeriodo {
  chegaram: number
  viraramDemanda: number
  orientados: number
  semDemanda: number
}

const NO_PERIODO: Record<Periodo, string> = {
  '7': 'em 7 dias',
  '30': 'em 30 dias',
  '90': 'em 90 dias',
  tudo: 'em todo o período',
}

/** Os quatro números do topo: o que chegou e para onde foi. */
export function QuadrosDosTickets({
  quadros,
  periodo = '7',
}: {
  quadros: QuadrosDoPeriodo
  periodo?: Periodo
}) {
  const itens = [
    { rotulo: `chegaram ${NO_PERIODO[periodo]}`, valor: quadros.chegaram, atencao: false },
    { rotulo: 'viraram demanda', valor: quadros.viraramDemanda, atencao: false },
    { rotulo: 'orientados na hora', valor: quadros.orientados, atencao: false },
    { rotulo: 'sem demanda', valor: quadros.semDemanda, atencao: quadros.semDemanda > 0 },
  ]
  // Como no esboço: o número em destaque em cima, o rótulo pequeno embaixo.
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      {itens.map((i) => (
        <div key={i.rotulo} className={`${CLASSE_DO_CARTAO} px-3 py-2`}>
          <p
            className={cn(
              'text-[20px] font-[650] leading-[1.3] tracking-[-0.02em] text-text-primary',
              i.atencao && 'text-atencao',
            )}
          >
            {i.valor}
          </p>
          <p className="text-xs text-text-secondary">{i.rotulo}</p>
        </div>
      ))}
    </div>
  )
}
