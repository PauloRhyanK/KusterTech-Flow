'use client'

import { useActionState, useState } from 'react'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import { encerrarDemandaAction } from '../[id]/actions'

// "Encerrar demanda" do Paulo, com um passo de confirmação: a demanda fica descartada e a
// Fábrica para de trabalhar nela.
export function EncerrarDemanda({ demandaId }: { demandaId: string }) {
  const [estado, enviar, pendente] = useActionState(encerrarDemandaAction, {})
  const [confirmando, setConfirmando] = useState(false)
  return (
    <section aria-label="Encerrar demanda" className="space-y-2">
      <MensagensDeEstado estado={{ erro: estado.erro }} />
      {confirmando ? (
        <form
          action={enviar}
          className="flex flex-wrap items-center gap-3 rounded-padrao border border-erro/30 bg-tonal-erro px-4 py-3"
        >
          <input type="hidden" name="demandaId" value={demandaId} />
          <p className="min-w-48 flex-1 text-sm text-text-primary">
            Encerrar esta demanda? A Fábrica para de trabalhar nela.
          </p>
          <Button type="button" variant="ghost" onClick={() => setConfirmando(false)}>
            Cancelar
          </Button>
          <Button type="submit" variant="destructive" disabled={pendente} aria-busy={pendente}>
            Sim, encerrar
          </Button>
        </form>
      ) : (
        <Button type="button" variant="outline" onClick={() => setConfirmando(true)}>
          Encerrar demanda
        </Button>
      )}
    </section>
  )
}
