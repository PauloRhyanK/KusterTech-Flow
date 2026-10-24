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

export function extrairIniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) {
    const unico = partes[0]
    return unico ? unico.charAt(0).toUpperCase() : '?'
  }
  const primeiro = partes[0]
  const ultimo = partes[partes.length - 1]
  const c1 = primeiro ? primeiro.charAt(0).toUpperCase() : '?'
  const c2 = ultimo ? ultimo.charAt(0).toUpperCase() : '?'
  return `${c1}${c2}`
}

export function MenuDoUsuario({ usuario }: MenuDoUsuarioProps) {
  const iniciais = extrairIniciais(usuario.nome)

  return (
    <>
      <form id="formulario-sair" method="post" action="/sair" className="hidden" />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Menu do usuário, ${usuario.nome}`}
          className="flex w-full items-center justify-between rounded-compacto p-2 text-left text-sm text-text-primary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-xs font-semibold text-text-secondary"
            >
              {iniciais}
            </span>
            <span className="hidden max-w-[9rem] truncate text-xs font-medium text-text-primary md:inline">
              {usuario.nome}
            </span>
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
                <p className="truncate text-xs leading-[1.3] text-text-secondary">
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
          <DropdownMenuItem
            variant="destructive"
            nativeButton
            render={<button type="submit" form="formulario-sair" />}
          >
            <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>Sair</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
