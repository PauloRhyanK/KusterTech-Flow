'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export interface Aba {
  rotulo: string
  href: string
  disponivel: boolean
  contador?: number
}

export interface AbasProps {
  abas: readonly Aba[]
  rotulo: string
  className?: string
}

export function Abas({ abas, rotulo, className }: AbasProps) {
  const pathname = usePathname()

  return (
    <nav
      aria-label={rotulo}
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
              'relative inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
              ativa
                ? 'border-action-primary font-semibold text-text-primary'
                : 'border-transparent text-text-secondary hover:border-border hover:text-text-primary',
            )}
          >
            <span>{aba.rotulo}</span>
            {aba.contador !== undefined && aba.contador > 0 && (
              <span className="text-[13px] text-text-secondary">{aba.contador}</span>
            )}
            {!aba.disponivel && <span className="sr-only"> (ainda não disponível)</span>}
          </Link>
        )
      })}
    </nav>
  )
}
