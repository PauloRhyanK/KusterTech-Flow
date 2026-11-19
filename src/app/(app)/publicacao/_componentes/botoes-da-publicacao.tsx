'use client'

import { useActionState } from 'react'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import { alternarPausaGeralAction, redefinirNoArAction, retomarFilaAction } from '../actions'

export function BotaoDaPausaGeral({ pausada }: { pausada: boolean }) {
  const [estado, alternar, pendente] = useActionState(alternarPausaGeralAction, {})
  return (
    <div className="flex flex-col items-end gap-2">
      <form action={alternar}>
        <Button type="submit" variant="outline" size="lg" aria-busy={pendente} disabled={pendente}>
          {pausada ? 'Retomar tudo' : 'Pausar tudo'}
        </Button>
      </form>
      <MensagensDeEstado estado={{ erro: estado.erro }} />
    </div>
  )
}

export function BotaoDeRetomarFila({ repositorioId }: { repositorioId: string }) {
  const [estado, retomar, pendente] = useActionState(retomarFilaAction, {})
  return (
    <div className="space-y-2">
      <form action={retomar}>
        <input type="hidden" name="repositorioId" value={repositorioId} />
        <Button type="submit" variant="outline" size="sm" aria-busy={pendente} disabled={pendente}>
          Retomar a fila
        </Button>
      </form>
      <MensagensDeEstado estado={{ erro: estado.erro }} />
    </div>
  )
}

export function BotaoDeRedefinirNoAr({ repositorioId }: { repositorioId: string }) {
  const [estado, redefinir, pendente] = useActionState(redefinirNoArAction, {})
  return (
    <div className="space-y-2">
      <BotaoDeConfirmacao
        rotulo="Redefinir o que está no ar"
        rotuloDeConfirmacao="Confirmar: o próximo pedido vale como o primeiro"
        action={redefinir}
        pendente={pendente}
        camposOcultos={{ repositorioId }}
        classeDoBotao="h-auto whitespace-normal py-1 text-left"
      />
      <MensagensDeEstado estado={{ erro: estado.erro }} />
    </div>
  )
}
