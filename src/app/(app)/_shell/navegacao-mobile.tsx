'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Marca } from '@/lib/ui/marca'
import { ListaDeNavegacao } from './lista-de-navegacao'
import { MenuDoUsuario } from './menu-do-usuario'

export interface NavegacaoMobileProps {
  usuario: {
    nome: string
    email: string
  }
}

export function NavegacaoMobile({ usuario }: NavegacaoMobileProps) {
  const [aberto, setAberto] = useState(false)
  const pathname = usePathname()
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
        showCloseButton={false}
        className="dark flex data-[side=left]:w-64 flex-col border-r border-border p-0 select-none"
        style={{ background: 'var(--marca-midnight)' }}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Navegação</SheetTitle>
        </SheetHeader>

        <div className="flex h-14 shrink-0 items-center justify-between px-6">
          <Marca variante="compacta" />
          <SheetClose
            aria-label="Fechar navegação"
            className="flex size-8 items-center justify-center rounded-compacto text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--marca-midnight)]"
          >
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </SheetClose>
        </div>

        <ListaDeNavegacao aoNavegar={() => setAberto(false)} />

        <div className="shrink-0 p-3 pt-2">
          <MenuDoUsuario usuario={usuario} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
