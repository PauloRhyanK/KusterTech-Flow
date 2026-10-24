import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Trilha {
  rotulo: string
  href?: string
}

export interface BreadcrumbsProps {
  trilhas: readonly Trilha[]
  className?: string
}

export function Breadcrumbs({ trilhas, className }: BreadcrumbsProps) {
  if (!trilhas || trilhas.length === 0) {
    return null
  }

  return (
    <nav
      aria-label="Trilha de navegação"
      className={cn('flex items-center text-xs font-normal text-text-secondary', className)}
    >
      <ol className="flex flex-wrap items-center gap-1.5">
        {trilhas.map((trilha, indice) => {
          const ehUltima = indice === trilhas.length - 1

          return (
            <li key={`${trilha.rotulo}-${indice}`} className="inline-flex items-center gap-1.5">
              {indice > 0 && (
                <ChevronRight
                  size={16}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className="shrink-0 text-text-tertiary"
                />
              )}
              {ehUltima ? (
                <span aria-current="page" className="font-medium text-text-primary">
                  {trilha.rotulo}
                </span>
              ) : trilha.href ? (
                <Link href={trilha.href} className="transition-colors hover:text-text-primary">
                  {trilha.rotulo}
                </Link>
              ) : (
                <span>{trilha.rotulo}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
