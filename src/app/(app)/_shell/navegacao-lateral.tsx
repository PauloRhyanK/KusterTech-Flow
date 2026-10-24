'use client'

import { Marca } from '@/lib/ui/marca'
import { ListaDeNavegacao } from './lista-de-navegacao'
import { MenuDoUsuario } from './menu-do-usuario'

export interface NavegacaoLateralProps {
  usuario: {
    nome: string
    email: string
  }
}

export function NavegacaoLateral({ usuario }: NavegacaoLateralProps) {
  return (
    <aside
      className="dark sticky top-0 hidden h-screen w-64 flex-col border-r border-border select-none md:flex"
      style={{ background: 'var(--marca-midnight)' }}
    >
      <div className="flex h-14 shrink-0 items-center px-6">
        <Marca variante="compacta" />
      </div>

      <ListaDeNavegacao />

      <div className="shrink-0 p-3 pt-2">
        <MenuDoUsuario usuario={usuario} />
      </div>
    </aside>
  )
}
