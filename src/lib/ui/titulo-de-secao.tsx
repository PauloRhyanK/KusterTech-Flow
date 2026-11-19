import type { ReactNode } from 'react'

// Título de bloco do Início: pequeno, em maiúsculas, com um complemento opcional ao lado.
export function TituloDeSecao({
  id,
  children,
  complemento,
}: {
  id: string
  children: string
  complemento?: ReactNode
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <h2
        id={id}
        className="text-[13px] font-[600] uppercase tracking-[0.06em] text-text-secondary"
      >
        {children}
      </h2>
      {complemento}
    </div>
  )
}

export const CLASSE_DO_CARTAO = 'rounded-padrao border border-border bg-surface'
export const CLASSE_DO_LINK = 'whitespace-nowrap text-sm font-medium text-text-link hover:underline'
