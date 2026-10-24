import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface CarregandoProps {
  linhas?: number
  rotulo?: string
  className?: string
}

export function Carregando({ linhas = 5, rotulo = 'Carregando…', className }: CarregandoProps) {
  return (
    <div role="status" aria-live="polite" className={cn('w-full space-y-3', className)}>
      <span className="sr-only">{rotulo}</span>
      {Array.from({ length: linhas }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full rounded-compacto" />
      ))}
    </div>
  )
}
