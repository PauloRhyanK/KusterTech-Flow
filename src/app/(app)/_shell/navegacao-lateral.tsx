'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ENTRADAS_SECUNDARIAS, MODULOS, itemAtivo } from '@/lib/ui/navegacao'
import { Marca } from '@/lib/ui/marca'
import { MenuDoUsuario } from './menu-do-usuario'
import { cn } from '@/lib/utils'

export interface NavegacaoLateralProps {
  usuario: {
    nome: string
    email: string
  }
}

export function NavegacaoLateral({ usuario }: NavegacaoLateralProps) {
  const pathname = usePathname()
  const ativo = itemAtivo(pathname)

  return (
    <aside
      className="dark hidden md:flex h-screen sticky top-0 w-64 flex-col border-r border-border select-none"
      style={{ background: 'var(--marca-midnight)' }}
    >
      <div className="flex h-14 shrink-0 items-center px-6">
        <Marca variante="compacta" />
      </div>

      <nav aria-label="Navegação principal" className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {MODULOS.map((modulo) => {
          const ehAtivo = ativo?.href === modulo.href

          return (
            <Link
              key={modulo.href}
              href={modulo.href}
              aria-current={ehAtivo ? 'page' : undefined}
              style={
                ehAtivo
                  ? {
                      background:
                        'color-mix(in srgb, var(--action-primary) 18%, var(--context-active) 10%)',
                    }
                  : undefined
              }
              className={cn(
                'flex items-center gap-3 rounded-compacto border-l-2 px-3 py-2 text-sm font-medium transition-colors',
                ehAtivo
                  ? 'border-marca-flow text-text-primary'
                  : 'border-transparent text-text-secondary hover:bg-surface-subtle/50 hover:text-text-primary',
              )}
            >
              <modulo.icone size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
              <span>{modulo.rotulo}</span>
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto shrink-0 space-y-2 border-t border-border p-3">
        <div className="space-y-1">
          {ENTRADAS_SECUNDARIAS.map((sec) => {
            const ehAtivo = ativo?.href === sec.href

            return (
              <Link
                key={sec.href}
                href={sec.href}
                aria-current={ehAtivo ? 'page' : undefined}
                style={
                  ehAtivo
                    ? {
                        background:
                          'color-mix(in srgb, var(--action-primary) 18%, var(--context-active) 10%)',
                      }
                    : undefined
                }
                className={cn(
                  'flex items-center gap-3 rounded-compacto border-l-2 px-3 py-2 text-sm font-medium transition-colors',
                  ehAtivo
                    ? 'border-marca-flow text-text-primary'
                    : 'border-transparent text-text-secondary hover:bg-surface-subtle/50 hover:text-text-primary',
                )}
              >
                <sec.icone size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                <span>{sec.rotulo}</span>
              </Link>
            )
          })}
        </div>
        <MenuDoUsuario usuario={usuario} />
      </div>
    </aside>
  )
}
