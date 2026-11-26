import { Fragment } from 'react'
import type { PontoAteOAr } from '@/modules/demandas/partes'
import { cn } from '@/lib/utils'

const ROTULOS = ['Pedida', 'Plano', 'Feita', 'No ar'] as const

// Cheio no verde-água da marca; em andamento é o anel roxo; o último ponto fica verde (no ar,
// conferido) ou com anel vermelho (não chegou).
const CLASSE_DO_PONTO: Record<PontoAteOAr, string> = {
  vazio: 'size-2.5 bg-border-strong',
  cheio: 'size-2.5 bg-marca-flow',
  andando: 'size-[13px] border-[2.5px] border-execucao bg-surface',
  verde: 'size-[13px] bg-sucesso',
  vermelho: 'size-[13px] border-[2.5px] border-erro bg-surface',
}

const PALAVRA: Record<PontoAteOAr, string> = {
  vazio: 'pendente',
  cheio: 'feito',
  andando: 'em andamento',
  verde: 'no ar',
  vermelho: 'não chegou',
}

const CLASSE_DO_ROTULO: Record<PontoAteOAr, string> = {
  vazio: 'text-text-tertiary',
  cheio: 'text-text-secondary',
  andando: 'font-[650] text-execucao',
  verde: 'font-[650] text-sucesso',
  vermelho: 'font-[650] text-erro',
}

const linha = (proximo: PontoAteOAr | undefined) =>
  proximo === undefined || proximo === 'vazio' ? 'bg-border' : 'bg-marca-flow'

function resumo(pontos: readonly PontoAteOAr[]): string {
  return `Até o ar: ${pontos.map((p, i) => `${ROTULOS[i]?.toLowerCase()} ${PALAVRA[p]}`).join(', ')}`
}

/** Os quatro pontos: pedida, plano, feita e no ar. O grande leva os rótulos embaixo. */
export function TrilhoAteOAr({
  pontos,
  grande = false,
}: {
  pontos: readonly PontoAteOAr[]
  grande?: boolean
}) {
  if (!grande) {
    return (
      <span
        role="img"
        aria-label={resumo(pontos)}
        className="flex w-[110px] shrink-0 items-center md:w-[150px]"
      >
        {pontos.map((p, i) => (
          <Fragment key={ROTULOS[i]}>
            <span
              data-ponto={p}
              title={ROTULOS[i]}
              className={cn('shrink-0 rounded-full', CLASSE_DO_PONTO[p])}
            />
            {i < pontos.length - 1 && <span className={cn('h-0.5 flex-1', linha(pontos[i + 1]))} />}
          </Fragment>
        ))}
      </span>
    )
  }
  return (
    <ol aria-label="Até o ar" className="flex max-w-[520px] items-start">
      {pontos.map((p, i) => (
        <li
          key={ROTULOS[i]}
          aria-current={p === 'andando' || p === 'vermelho' ? 'step' : undefined}
          className={cn(
            'relative min-w-[72px] flex-1 whitespace-nowrap text-center text-[11px] uppercase tracking-[0.06em]',
            CLASSE_DO_ROTULO[p],
          )}
        >
          {i > 0 && (
            <span
              aria-hidden="true"
              className={cn('absolute top-[5.5px] right-1/2 h-0.5 w-full', linha(p))}
            />
          )}
          <span className="relative z-10 mx-auto mb-1.5 flex h-[13px] items-center justify-center">
            <span
              data-ponto={p}
              aria-hidden="true"
              className={cn('block rounded-full', CLASSE_DO_PONTO[p])}
            />
          </span>
          {ROTULOS[i]}
        </li>
      ))}
    </ol>
  )
}
