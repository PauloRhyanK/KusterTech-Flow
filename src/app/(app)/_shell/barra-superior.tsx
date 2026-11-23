import type { ModuloId } from '@/lib/modulos'
import { NavegacaoMobile } from './navegacao-mobile'
import { MenuDoUsuario } from './menu-do-usuario'

export interface BarraSuperiorProps {
  usuario: {
    nome: string
    email: string
  }
  modulosAtivos?: readonly ModuloId[]
  contadores?: Partial<Record<string, number>>
}

export function BarraSuperior({ usuario, modulosAtivos, contadores }: BarraSuperiorProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 md:hidden">
      <NavegacaoMobile usuario={usuario} modulosAtivos={modulosAtivos} contadores={contadores} />
      <MenuDoUsuario usuario={usuario} />
    </header>
  )
}
