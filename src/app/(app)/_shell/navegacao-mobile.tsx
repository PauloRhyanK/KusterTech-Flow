'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ENTRADAS_SECUNDARIAS, MODULOS, itemAtivo } from '@/lib/ui/navegacao'
import { Marca } from '@/lib/ui/marca'
import { MenuDoUsuario } from './menu-do-usuario'
import { cn } from '@/lib/utils'

export interface NavegacaoMobileProps {
  usuario: {
    nome: string
    email: string
  }
}

export function NavegacaoMobile({ usuario }: NavegacaoMobileProps) {
  const [aberto, setAberto] = useState(false)
  const pathname = usePathname()
  const ativo = itemAtivo(pathname)
  const [pathnameAnterior, setPathnameAnterior] = useState(pathname)

  if (pathname !== pathnameAnterior) {
    setPathnameAnterior(pathname)
    setAberto(false)
  }

  return (
    <Sheet open={aberto} onOpenChange={setAberto}>
      <SheetTrigger
        aria-label="Abrir navegação"
        className="flex size-11 items-center justify-center rounded-compacto text-text-primary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring md:hidden"
      >
        <Menu size={18} strokeWidth={1.75} aria-hidden="true" />
      </SheetTrigger>

      <SheetContent
        side="left"
        className="dark flex w-64 flex-col border-r border-border p-0 select-none"
        style={{ background: 'var(--marca-midnight)' }}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Navegação</SheetTitle>
        </SheetHeader>

        <div className="flex h-14 shrink-0 items-center px-6">
          <Marca variante="compacta" />
        </div>

        <nav
          aria-label="Navegação principal"
          className="flex-1 space-y-1 overflow-y-auto px-3 py-2"
        >
          {MODULOS.map((modulo) => {
            const ehAtivo = ativo?.href === modulo.href

            return (
              <Link
                key={modulo.href}
                href={modulo.href}
                onClick={() => setAberto(false)}
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
                <modulo.icone
                  size={18}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className="shrink-0"
                />
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
                  onClick={() => setAberto(false)}
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
      </SheetContent>
    </Sheet>
  )
}
