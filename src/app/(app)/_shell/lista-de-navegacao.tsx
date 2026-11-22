'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ModuloId } from '@/lib/modulos'
import { ENTRADAS_SECUNDARIAS, GRUPOS_DE_NAVEGACAO, itemAtivo } from '@/lib/ui/navegacao'
import { cn } from '@/lib/utils'

export interface ListaDeNavegacaoProps {
  aoNavegar?: () => void
  /** Sem a lista, nenhum item é escondido por módulo. */
  modulosAtivos?: readonly ModuloId[]
  /** Número ao lado do item, por `href`; só aparece quando maior que zero. */
  contadores?: Partial<Record<string, number>>
}

const CLASSE_BASE_ITEM =
  'flex items-center gap-3 rounded-compacto border-l-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--marca-midnight)]'

const CLASSE_ATIVO = 'border-marca-flow text-text-primary'
const CLASSE_INATIVO =
  'border-transparent text-text-secondary hover:bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)] hover:text-text-primary'

const ESTILO_ATIVO = {
  background: 'color-mix(in srgb, var(--action-primary) 18%, var(--context-active) 10%)',
}

export function ListaDeNavegacao({ aoNavegar, modulosAtivos, contadores }: ListaDeNavegacaoProps) {
  const pathname = usePathname()
  const ativo = itemAtivo(pathname)

  return (
    <>
      <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto px-3 py-2">
        {GRUPOS_DE_NAVEGACAO.map((grupo) => (
          <div key={grupo.rotulo} className="space-y-1 pb-2">
            <p className="px-3 pb-1 pt-3 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
              {grupo.rotulo}
            </p>
            {grupo.itens
              .filter(
                (item) => !item.modulo || !modulosAtivos || modulosAtivos.includes(item.modulo),
              )
              .map((item) => {
                const ehAtivo = ativo?.href === item.href
                const contador = contadores?.[item.href] ?? 0

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={aoNavegar}
                    aria-current={ehAtivo ? 'page' : undefined}
                    style={ehAtivo ? ESTILO_ATIVO : undefined}
                    className={cn(CLASSE_BASE_ITEM, ehAtivo ? CLASSE_ATIVO : CLASSE_INATIVO)}
                  >
                    <item.icone
                      size={18}
                      strokeWidth={1.75}
                      aria-hidden="true"
                      className="shrink-0"
                    />
                    <span>{item.rotulo}</span>
                    {contador > 0 ? (
                      <span
                        aria-label={`${contador} esperando`}
                        className="ml-auto rounded-full bg-tonal-atencao px-2 py-0.5 text-xs font-semibold text-atencao"
                      >
                        {contador}
                      </span>
                    ) : null}
                  </Link>
                )
              })}
          </div>
        ))}
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
