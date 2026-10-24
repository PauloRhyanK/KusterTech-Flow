import type { ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface LinhaOperacional {
  id: string
  nome: ReactNode
  contexto?: ReactNode
  estado?: ReactNode
  indicador?: ReactNode
  acoes?: ReactNode
  href?: string
}

export interface ListaOperacionalProps {
  linhas: readonly LinhaOperacional[]
  filtros?: ReactNode
  vazio: ReactNode
  rotulo: string
  className?: string
}

export function ListaOperacional({
  linhas,
  filtros,
  vazio,
  rotulo,
  className,
}: ListaOperacionalProps) {
  if (linhas.length === 0) {
    return (
      <div className={cn('space-y-4', className)}>
        {filtros && <div>{filtros}</div>}
        {vazio}
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)}>
      {filtros && <div>{filtros}</div>}
      <ul
        aria-label={rotulo}
        className="divide-y divide-border overflow-hidden rounded-padrao border border-border bg-surface"
      >
        {linhas.map((linha) => (
          <li
            key={linha.id}
            className="flex min-h-[40px] md:min-h-[44px] items-center justify-between gap-3 px-4 py-2 text-[13px] leading-[1.45] transition-colors dark:even:bg-surface-subtle/40"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="truncate font-medium text-text-primary">
                {linha.href ? (
                  <Link href={linha.href} className="transition-colors hover:underline">
                    {linha.nome}
                  </Link>
                ) : (
                  linha.nome
                )}
              </div>
              {linha.contexto && (
                <div className="shrink-0 text-xs text-text-secondary">{linha.contexto}</div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {linha.indicador && <div>{linha.indicador}</div>}
              {linha.estado && <div>{linha.estado}</div>}
              {linha.acoes && <div>{linha.acoes}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
