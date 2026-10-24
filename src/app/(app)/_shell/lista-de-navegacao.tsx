'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ENTRADAS_SECUNDARIAS, MODULOS, itemAtivo } from '@/lib/ui/navegacao'
import { cn } from '@/lib/utils'

export interface ListaDeNavegacaoProps {
  aoNavegar?: () => void
}

const CLASSE_BASE_ITEM =
  'flex items-center gap-3 rounded-compacto border-l-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--marca-midnight)]'

const CLASSE_ATIVO = 'border-marca-flow text-text-primary'
const CLASSE_INATIVO =
  'border-transparent text-text-secondary hover:bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)] hover:text-text-primary'

const ESTILO_ATIVO = {
  background: 'color-mix(in srgb, var(--action-primary) 18%, var(--context-active) 10%)',
}

export function ListaDeNavegacao({ aoNavegar }: ListaDeNavegacaoProps) {
  const pathname = usePathname()
  const ativo = itemAtivo(pathname)

  return (
    <>
      <nav aria-label="Navegação principal" className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {MODULOS.map((modulo) => {
          const ehAtivo = ativo?.href === modulo.href

          return (
            <Link
              key={modulo.href}
              href={modulo.href}
              onClick={aoNavegar}
              aria-current={ehAtivo ? 'page' : undefined}
              style={ehAtivo ? ESTILO_ATIVO : undefined}
              className={cn(CLASSE_BASE_ITEM, ehAtivo ? CLASSE_ATIVO : CLASSE_INATIVO)}
            >
              <modulo.icone size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
              <span>{modulo.rotulo}</span>
            </Link>
          )
        })}
      </nav>

      <div className="shrink-0 space-y-1 border-t border-border px-3 pt-3">
        {ENTRADAS_SECUNDARIAS.map((sec) => {
          const ehAtivo = ativo?.href === sec.href

          return (
            <Link
              key={sec.href}
              href={sec.href}
              onClick={aoNavegar}
              aria-current={ehAtivo ? 'page' : undefined}
              style={ehAtivo ? ESTILO_ATIVO : undefined}
              className={cn(CLASSE_BASE_ITEM, ehAtivo ? CLASSE_ATIVO : CLASSE_INATIVO)}
            >
              <sec.icone size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
              <span>{sec.rotulo}</span>
            </Link>
          )
        })}
      </div>
    </>
  )
}
