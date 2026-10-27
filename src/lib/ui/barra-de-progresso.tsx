import { cn } from '@/lib/utils'
import { textoDoProgresso, type ProgressoDaMilestone } from '@/modules/entregas/model'

export interface BarraDeProgressoProps {
  progresso: ProgressoDaMilestone
  className?: string
}

// Progresso de desenvolvimento (issues fechadas no GitHub). Nunca usa o tom de sucesso:
// 100% aqui não significa disponível em QA nem aprovado (D20, A04).
export function BarraDeProgresso({ progresso, className }: BarraDeProgressoProps) {
  const texto = textoDoProgresso(progresso)

  if (progresso.percentual === null) {
    return <span className={cn('text-xs text-text-secondary', className)}>{texto}</span>
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-valuenow={progresso.percentual}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={texto}
        className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-surface-subtle"
      >
        <div className="h-full bg-marca-flow" style={{ width: `${progresso.percentual}%` }} />
      </div>
      <span className="text-xs text-text-secondary">{texto}</span>
    </div>
  )
}
