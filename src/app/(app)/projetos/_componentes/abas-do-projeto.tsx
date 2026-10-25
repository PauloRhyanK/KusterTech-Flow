'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Aba } from '@/modules/projetos/model'

export interface AbasDoProjetoProps {
  abas: readonly Aba[]
  className?: string
}

export function AbasDoProjeto({ abas, className }: AbasDoProjetoProps) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Seções do projeto"
      className={cn(
        'flex w-full min-w-0 max-w-full items-center gap-1 overflow-x-auto border-b border-border',
        className,
      )}
    >
      {abas.map((aba) => {
        const ativa = pathname === aba.href

        return (
          <Link
            key={aba.href}
            href={aba.href}
            aria-current={ativa ? 'page' : undefined}
            className={cn(
              'relative inline-flex shrink-0 items-center border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
              ativa
                ? 'border-action-primary font-semibold text-text-primary'
                : 'border-transparent text-text-secondary hover:border-border hover:text-text-primary',
            )}
          >
            <span>{aba.rotulo}</span>
            {!aba.disponivel && <span className="sr-only"> (ainda não disponível)</span>}
          </Link>
        )
      })}
    </nav>
  )
}
