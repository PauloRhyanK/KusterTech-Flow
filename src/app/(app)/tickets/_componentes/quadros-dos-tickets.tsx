import type { Periodo } from '@/modules/tickets/model'
import { QuadroDeMetrica } from '@/lib/ui/quadro-de-metrica'
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
    { rotulo: `chegaram ${NO_PERIODO[periodo]}`, valor: quadros.chegaram },
    { rotulo: 'viraram demanda', valor: quadros.viraramDemanda },
    { rotulo: 'orientados na hora', valor: quadros.orientados },
    { rotulo: 'sem demanda', valor: quadros.semDemanda },
  ]
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      {itens.map((i) => (
        <div key={i.rotulo} className={`${CLASSE_DO_CARTAO} px-3 py-2`}>
          <QuadroDeMetrica rotulo={i.rotulo} valor={String(i.valor)} />
        </div>
      ))}
    </div>
  )
}
