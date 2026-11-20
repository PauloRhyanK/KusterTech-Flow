import { Fragment } from 'react'
import type { PontoDoTrilho } from '@/modules/demandas/apresentacao'
import { cn } from '@/lib/utils'

export interface PontoDeEtapa {
  chave: string
  rotulo: string
  ponto: PontoDoTrilho
}

// Pontos de 9 px; o atual e o que espera o Paulo ganham um anel no tom.
const CLASSE_DO_PONTO: Record<PontoDoTrilho, string> = {
  feito: 'size-[9px] bg-marca-flow',
  atual: 'size-3 border-[2.5px] border-execucao bg-surface',
  espera: 'size-3 border-[2.5px] border-atencao bg-surface',
  travado: 'size-[9px] bg-erro',
  futuro: 'size-[9px] bg-border-strong',
}

function resumo(pontos: readonly PontoDeEtapa[]): string {
  const i = pontos.findIndex((p) => p.ponto !== 'feito')
  const atual = pontos[i]
  if (!atual) return 'Todas as etapas feitas'
  return `Etapa ${i + 1} de ${pontos.length}: ${atual.rotulo}`
}

export function TrilhoDeEtapas({ pontos }: { pontos: readonly PontoDeEtapa[] }) {
  return (
    <span role="img" aria-label={resumo(pontos)} className="flex w-[150px] shrink-0 items-center">
      {pontos.map((p, i) => {
        const proximo = pontos[i + 1]
        return (
          <Fragment key={p.chave}>
            <span
              data-ponto={p.ponto}
              title={p.rotulo}
              className={cn('shrink-0 rounded-full', CLASSE_DO_PONTO[p.ponto])}
            />
            {proximo && (
              <span
                className={cn(
                  'h-0.5 flex-1',
                  proximo.ponto === 'futuro' ? 'bg-border' : 'bg-marca-flow',
                )}
              />
            )}
          </Fragment>
        )
      })}
    </span>
  )
}
