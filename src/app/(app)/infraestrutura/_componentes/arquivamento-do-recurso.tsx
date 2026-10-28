'use client'

import { useActionState } from 'react'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { alternarArquivamentoDeRecursoAction } from '../actions'

export interface ArquivamentoDoRecursoProps {
  recursoId: string
  arquivado: boolean
}

export function ArquivamentoDoRecurso({ recursoId, arquivado }: ArquivamentoDoRecursoProps) {
  const [estado, alternar, pendente] = useActionState(alternarArquivamentoDeRecursoAction, {})

  return (
    <div className="space-y-2">
      <MensagensDeEstado estado={estado} />
      <BotaoDeConfirmacao
        rotulo={arquivado ? 'Desarquivar' : 'Arquivar'}
        rotuloDeConfirmacao={arquivado ? 'Confirmar desarquivamento' : 'Confirmar arquivamento'}
        action={alternar}
        pendente={pendente}
        camposOcultos={{ recursoId, arquivar: arquivado ? 'false' : 'true' }}
      />
    </div>
  )
}
