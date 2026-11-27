'use client'

import { useEffect, useRef } from 'react'

/** O conteúdo de uma figura da mensagem (diagrama ou imagem) em tela cheia. Esc e "Fechar" fecham. */
export function VisorAmpliado({
  titulo,
  aberto,
  onFechar,
  children,
}: {
  titulo: string
  aberto: boolean
  onFechar: () => void
  children: React.ReactNode
}) {
  const fechar = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!aberto) return
    fechar.current?.focus()
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onFechar()
    }
    document.addEventListener('keydown', aoTeclar, true)
    return () => document.removeEventListener('keydown', aoTeclar, true)
  }, [aberto, onFechar])

  if (!aberto) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2.5">
        <p className="min-w-0 truncate text-sm font-[600] text-text-primary">{titulo}</p>
        <button
          ref={fechar}
          type="button"
          onClick={onFechar}
          className="shrink-0 rounded-compacto border border-border-strong bg-surface px-3 py-1 text-[13px] font-[600] text-text-primary hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          Fechar
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-8">{children}</div>
    </div>
  )
}

/** A moldura de uma figura na mensagem: a área, a legenda e o "Ampliar". */
export function Figura({
  legenda,
  onAmpliar,
  children,
}: {
  legenda: string
  onAmpliar: () => void
  children: React.ReactNode
}) {
  return (
    <figure className="my-2 overflow-hidden rounded-compacto border border-border bg-surface-subtle">
      <div className="grid place-items-center overflow-x-auto p-3">{children}</div>
      <figcaption className="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-[12.5px] text-text-secondary">
        <span className="min-w-0 break-all">{legenda}</span>
        <button
          type="button"
          onClick={onAmpliar}
          className="shrink-0 font-[600] text-text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          Ampliar
        </button>
      </figcaption>
    </figure>
  )
}
