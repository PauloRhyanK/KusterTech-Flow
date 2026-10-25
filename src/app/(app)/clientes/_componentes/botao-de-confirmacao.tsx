'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

export interface BotaoDeConfirmacaoProps {
  rotulo: string
  rotuloDeConfirmacao: string
  action: (formData: FormData) => void | Promise<unknown>
  camposOcultos?: Record<string, string>
  pendente?: boolean
}

export function BotaoDeConfirmacao({
  rotulo,
  rotuloDeConfirmacao,
  action,
  camposOcultos,
  pendente = false,
}: BotaoDeConfirmacaoProps) {
  const [confirmando, setConfirmando] = useState(false)

  useEffect(() => {
    if (!confirmando) {
      return
    }

    const timer = setTimeout(() => {
      setConfirmando(false)
    }, 5000)

    return () => clearTimeout(timer)
  }, [confirmando])

  return (
    <form
      action={action as unknown as (formData: FormData) => Promise<void>}
      className="inline-block"
    >
      {camposOcultos &&
        Object.entries(camposOcultos).map(([chave, valor]) => (
          <input key={chave} type="hidden" name={chave} value={valor} />
        ))}
      <span className="sr-only" aria-live="polite">
        {confirmando ? 'Clique de novo para confirmar.' : ''}
      </span>
      <Button
        type={confirmando ? 'submit' : 'button'}
        variant={confirmando ? 'destructive' : 'outline'}
        aria-busy={pendente}
        onClick={(e) => {
          if (pendente) {
            e.preventDefault()
            return
          }
          if (!confirmando) {
            e.preventDefault()
            setConfirmando(true)
          }
        }}
      >
        {confirmando ? rotuloDeConfirmacao : rotulo}
      </Button>
    </form>
  )
}
