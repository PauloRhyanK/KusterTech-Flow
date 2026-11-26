'use client'

import { useActionState } from 'react'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import type { EstadoDoFormulario } from './formulario-do-sistema'

type Acao = (estado: EstadoDoFormulario, form: FormData) => Promise<EstadoDoFormulario>

export function TestarConexao({ sistemaId, action }: { sistemaId: string; action: Acao }) {
  const [estado, testar, pendente] = useActionState(action, {})
  return (
    <form action={testar} className="space-y-2">
      <input type="hidden" name="sistemaId" value={sistemaId} />
      <Button type="submit" variant="outline" aria-busy={pendente} disabled={pendente}>
        {pendente ? 'Testando…' : 'Testar conexão'}
      </Button>
      <MensagensDeEstado estado={estado} />
    </form>
  )
}

export function RevogarSistema({ sistemaId, action }: { sistemaId: string; action: Acao }) {
  const [estado, revogar, pendente] = useActionState(action, {})
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-text-secondary">
        Revogar este sistema? A busca para e os avisos pendentes não serão enviados.
      </p>
      <BotaoDeConfirmacao
        rotulo="Revogar"
        rotuloDeConfirmacao="Confirmar revogação"
        action={revogar}
        pendente={pendente}
        camposOcultos={{ sistemaId }}
      />
      <MensagensDeEstado estado={estado} />
    </div>
  )
}
