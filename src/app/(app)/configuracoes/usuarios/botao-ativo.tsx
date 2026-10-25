'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { alterarAtivoAction } from './actions'

export interface BotaoAtivoProps {
  usuarioId: string
  ativo: boolean
  ehProprioUsuario: boolean
}

export function BotaoAtivo({ usuarioId, ativo, ehProprioUsuario }: BotaoAtivoProps) {
  const [estado, formAction, pendente] = useActionState(alterarAtivoAction, {})

  if (ehProprioUsuario) {
    return (
      <Button variant="outline" size="sm" disabled aria-disabled="true">
        Sua conta
      </Button>
    )
  }

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="usuarioId" value={usuarioId} />
      <input type="hidden" name="ativo" value={ativo ? 'false' : 'true'} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        aria-busy={pendente}
        onClick={(e) => {
          if (pendente) {
            e.preventDefault()
          }
        }}
      >
        {ativo ? 'Desativar' : 'Reativar'}
      </Button>
      <span role="status" className="sr-only">
        {estado.sucesso ?? ''}
      </span>
      {estado.erro && (
        <span role="alert" className="text-xs text-erro">
          {estado.erro}
        </span>
      )}
    </form>
  )
}
