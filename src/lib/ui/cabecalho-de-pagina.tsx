import type { ReactNode } from 'react'
import { Breadcrumbs, type Trilha } from './breadcrumbs'
import { cn } from '@/lib/utils'

export interface CabecalhoDePaginaProps {
  trilhas: readonly Trilha[]
  titulo: string
  contexto?: string
  situacao?: ReactNode
  acoes?: ReactNode
  className?: string
}

export function CabecalhoDePagina({
  trilhas,
  titulo,
  contexto,
  situacao,
  acoes,
  className,
}: CabecalhoDePaginaProps) {
  return (
    <header className={cn('space-y-3', className)}>
      <Breadcrumbs trilhas={trilhas} />
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h1 className="text-[24px] font-[650] leading-[1.25] text-text-primary">{titulo}</h1>
          {contexto && <p className="text-sm text-text-secondary">{contexto}</p>}
          {situacao && <div className="pt-1">{situacao}</div>}
        </div>
        {acoes && <div className="flex shrink-0 items-center gap-2 pt-1 md:pt-0">{acoes}</div>}
      </div>
    </header>
  )
}
