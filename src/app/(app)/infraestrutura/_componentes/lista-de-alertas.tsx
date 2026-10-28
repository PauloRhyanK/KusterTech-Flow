import type { ReactNode } from 'react'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { ListaOperacional } from '@/lib/ui/lista-operacional'
import {
  apresentarEstadoDoAlerta,
  apresentarSeveridade,
  vezesRecebido,
} from '@/modules/infra/model'
import type { AlertaNaLista } from '@/modules/infra/queries'

export interface ListaDeAlertasProps {
  alertas: readonly AlertaNaLista[]
  rotulo: string
  vazio: ReactNode
  filtros?: ReactNode
}

// Componente único da fila, do recurso e do projeto: o mesmo registro, o mesmo link (UX-12).
export function ListaDeAlertas({ alertas, rotulo, vazio, filtros }: ListaDeAlertasProps) {
  const linhas = alertas.map((a) => {
    const estado = apresentarEstadoDoAlerta(a.estado)
    const severidade = apresentarSeveridade(a.severidade)
    const vezes = vezesRecebido(a.ocorrencias)
    return {
      id: a.id,
      ancora: `alerta-${a.id}`,
      nome: a.titulo,
      href: `/infraestrutura/alertas/${a.id}`,
      contexto: a.recurso ? `${a.recurso.nome} · ${vezes}` : vezes,
      indicador: (
        <span className="text-xs text-text-secondary">
          Última: {formatarDataHora(a.ultimaOcorrenciaEm)}
        </span>
      ),
      estado: (
        <span className="flex items-center gap-1.5">
          <BadgeDeEstado tom={severidade.tom}>{severidade.texto}</BadgeDeEstado>
          <BadgeDeEstado tom={estado.tom}>{estado.texto}</BadgeDeEstado>
        </span>
      ),
    }
  })

  return <ListaOperacional rotulo={rotulo} linhas={linhas} filtros={filtros} vazio={vazio} />
}
