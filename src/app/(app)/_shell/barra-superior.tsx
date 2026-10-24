import { NavegacaoMobile } from './navegacao-mobile'
import { MenuDoUsuario } from './menu-do-usuario'

export interface BarraSuperiorProps {
  usuario: {
    nome: string
    email: string
  }
}

export function BarraSuperior({ usuario }: BarraSuperiorProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 md:hidden">
      <NavegacaoMobile usuario={usuario} />
      <MenuDoUsuario usuario={usuario} />
    </header>
  )
}
