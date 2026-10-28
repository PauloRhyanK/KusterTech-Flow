'use client'

import { useActionState, useState } from 'react'
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

  // Só a mensagem da última ação executada fica na tela.
  const [ultima, setUltima] = useState<'reconhecer' | 'resolver'>('reconhecer')

  return (
    <div className="space-y-3">
      <MensagensDeEstado estado={ultima === 'reconhecer' ? estadoReconhecer : estadoResolver} />
      <div className="flex flex-wrap items-start gap-2">
        {podeReconhecer && (
          <form action={reconhecer} onSubmit={() => setUltima('reconhecer')}>
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
          <div onSubmit={() => setUltima('resolver')}>
            <BotaoDeConfirmacao
              rotulo="Registrar resolução"
              rotuloDeConfirmacao="Confirmar resolução"
              action={resolver}
              pendente={pendenteResolver}
              camposOcultos={{ alertaId }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
