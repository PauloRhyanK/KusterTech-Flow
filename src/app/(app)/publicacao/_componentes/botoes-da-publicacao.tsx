'use client'

import { useActionState } from 'react'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import {
  cancelarPedidoAction,
  definirPausaGeralAction,
  mudarModoDoPedidoAction,
  publicarAgoraAction,
  redefinirNoArAction,
  retomarFilaAction,
} from '../actions'

export function BotaoDaPausaGeral({ pausada }: { pausada: boolean }) {
  const [estado, definir, pendente] = useActionState(definirPausaGeralAction, {})
  return (
    <div className="flex flex-col items-end gap-2">
      <form action={definir}>
        <input type="hidden" name="pausar" value={pausada ? 'false' : 'true'} />
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

export function BotaoDePublicarAgora({
  repositorioId,
  rotulo = 'Publicar agora',
}: {
  repositorioId: string
  rotulo?: string
}) {
  const [estado, publicar, pendente] = useActionState(publicarAgoraAction, {})
  return (
    <div className="space-y-2">
      <form action={publicar}>
        <input type="hidden" name="repositorioId" value={repositorioId} />
        <Button type="submit" variant="outline" size="sm" aria-busy={pendente} disabled={pendente}>
          {rotulo}
        </Button>
      </form>
      <MensagensDeEstado estado={estado} />
    </div>
  )
}

export function BotaoDeMudarModo({
  pedidoId,
  modo,
}: {
  pedidoId: string
  modo: 'imediato' | 'lote'
}) {
  const [estado, mudar, pendente] = useActionState(mudarModoDoPedidoAction, {})
  return (
    <div className="space-y-2">
      <form action={mudar}>
        <input type="hidden" name="pedidoId" value={pedidoId} />
        <input type="hidden" name="modo" value={modo} />
        <Button type="submit" variant="outline" size="sm" aria-busy={pendente} disabled={pendente}>
          {modo === 'imediato' ? 'Mudar para imediato' : 'Mandar para o lote'}
        </Button>
      </form>
      <MensagensDeEstado estado={estado} />
    </div>
  )
}

export function BotaoDeCancelarPedido({ pedidoId }: { pedidoId: string }) {
  const [estado, cancelar, pendente] = useActionState(cancelarPedidoAction, {})
  return (
    <div className="space-y-2">
      <form action={cancelar}>
        <input type="hidden" name="pedidoId" value={pedidoId} />
        <Button type="submit" variant="outline" size="sm" aria-busy={pendente} disabled={pendente}>
          Cancelar
        </Button>
      </form>
      <MensagensDeEstado estado={estado} />
    </div>
  )
}
