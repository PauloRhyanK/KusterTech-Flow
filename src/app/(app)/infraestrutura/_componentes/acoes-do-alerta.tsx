'use client'

import { useActionState } from 'react'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import { reconhecerAlertaAction, registrarResolucaoAction } from '../actions'

export interface AcoesDoAlertaProps {
  alertaId: string
  podeReconhecer: boolean
  podeRegistrarResolucao: boolean
}

export function AcoesDoAlerta({
  alertaId,
  podeReconhecer,
  podeRegistrarResolucao,
}: AcoesDoAlertaProps) {
  const [estadoReconhecer, reconhecer, pendenteReconhecer] = useActionState(
    reconhecerAlertaAction,
    {},
  )
  const [estadoResolver, resolver, pendenteResolver] = useActionState(registrarResolucaoAction, {})

  return (
    <div className="space-y-3">
      <MensagensDeEstado estado={{ ...estadoResolver, ...estadoReconhecer }} />
      <div className="flex flex-wrap items-start gap-2">
        {podeReconhecer && (
          <form action={reconhecer}>
            <input type="hidden" name="alertaId" value={alertaId} />
            <Button
              type="submit"
              aria-busy={pendenteReconhecer}
              onClick={(e) => {
                if (pendenteReconhecer) {
                  e.preventDefault()
                }
              }}
            >
              Reconhecer
            </Button>
          </form>
        )}
        {podeRegistrarResolucao && (
          <BotaoDeConfirmacao
            rotulo="Registrar resolução"
            rotuloDeConfirmacao="Confirmar resolução"
            action={resolver}
            pendente={pendenteResolver}
            camposOcultos={{ alertaId }}
          />
        )}
      </div>
    </div>
  )
}
