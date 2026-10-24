import { Breadcrumbs, type Trilha } from '@/lib/ui/breadcrumbs'
import { NavegacaoMobile } from './navegacao-mobile'
import { MenuDoUsuario } from './menu-do-usuario'

export interface BarraSuperiorProps {
  trilhas?: readonly Trilha[]
  usuario: {
    nome: string
    email: string
  }
}

export function BarraSuperior({ trilhas = [], usuario }: BarraSuperiorProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 md:px-6">
      <div className="flex items-center gap-3">
        <NavegacaoMobile usuario={usuario} />
        {trilhas.length > 0 && <Breadcrumbs trilhas={trilhas} />}
      </div>
      <div className="flex items-center md:hidden">
        <MenuDoUsuario usuario={usuario} />
      </div>
    </header>
  )
}
