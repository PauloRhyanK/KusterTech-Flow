'use client'

import { useTransition } from 'react'
import { amanhaAcao, pularAcao, type EstadoDoDecidir } from '../actions'

const BOTAO =
  'font-[550] text-text-secondary underline-offset-2 hover:text-text-primary hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'

/** "Pular esta · Deixar para amanhã" e a dica do teclado. */
export function Rodape({
  chave,
  aoTerminar,
  desabilitado = false,
}: {
  chave: string
  aoTerminar: (r: EstadoDoDecidir) => void
  desabilitado?: boolean
}) {
  const [pendente, iniciar] = useTransition()
  const fazer = (acao: (c: string) => Promise<EstadoDoDecidir>) =>
    iniciar(async () => {
      aoTerminar(await acao(chave))
    })
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-tertiary">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={desabilitado || pendente}
          onClick={() => fazer(pularAcao)}
          className={BOTAO}
        >
          Pular esta
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          disabled={desabilitado || pendente}
          onClick={() => fazer(amanhaAcao)}
          className={BOTAO}
        >
          Deixar para amanhã
        </button>
      </div>
      <span className="hidden md:inline">Enter envia · setas trocam de item</span>
    </div>
  )
}
