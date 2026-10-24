'use client'

import Link from 'next/link'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronsUpDown, LogOut, Palette, Settings } from 'lucide-react'

export interface MenuDoUsuarioProps {
  usuario: {
    nome: string
    email: string
  }
}

export function MenuDoUsuario({ usuario }: MenuDoUsuarioProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Menu do usuário"
        className="flex w-full items-center justify-between rounded-compacto p-2 text-left text-sm text-text-primary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <span className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-xs font-semibold text-text-secondary"
          >
            {usuario.nome.slice(0, 2).toUpperCase()}
          </span>
          <span className="hidden text-xs font-medium text-text-primary md:inline">Conta</span>
        </span>
        <ChevronsUpDown
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
          className="shrink-0 text-text-tertiary"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" side="top" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="truncate text-xs font-medium leading-none text-text-primary">
                {usuario.nome}
              </p>
              <p className="truncate text-[11px] leading-none text-text-secondary">
                {usuario.email}
              </p>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/configuracoes/aparencia" />}>
          <Palette size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>Aparência</span>
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/configuracoes" />}>
          <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>Configurações</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" className="p-0">
          <form method="post" action="/sair" className="w-full">
            <button
              type="submit"
              className="flex w-full cursor-default items-center gap-1.5 px-1.5 py-1 text-sm text-cor-erro hover:text-cor-erro focus:outline-none"
            >
              <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>Sair</span>
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
