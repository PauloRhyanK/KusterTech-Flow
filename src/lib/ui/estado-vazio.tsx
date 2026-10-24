import type { ReactNode } from 'react'
import { Clock, FileQuestion, Inbox, type LucideIcon, PlugZap, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type TipoDeEstadoVazio =
  | 'nenhum-registro'
  | 'nao-configurado'
  | 'falha-integracao'
  | 'dados-desatualizados'
  | 'sem-evidencia'

export interface EstadoVazioProps {
  tipo: TipoDeEstadoVazio
  titulo: string
  descricao: string
  acao?: ReactNode
  className?: string
}

const ICONES_POR_TIPO: Record<TipoDeEstadoVazio, LucideIcon> = {
  'nenhum-registro': Inbox,
  'nao-configurado': Settings2,
  'falha-integracao': PlugZap,
  'dados-desatualizados': Clock,
  'sem-evidencia': FileQuestion,
}

export function EstadoVazio({ tipo, titulo, descricao, acao, className }: EstadoVazioProps) {
  const Icone = ICONES_POR_TIPO[tipo]

  return (
    <div
      role="status"
      data-tipo={tipo}
      className={cn(
        'flex flex-col items-center justify-center rounded-amplo border border-border bg-surface p-8 text-center',
        className,
      )}
    >
      <div className="mb-3 text-text-secondary">
        <Icone size={18} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-text-primary">{titulo}</h3>
      <p className="mt-1 max-w-md text-sm text-text-secondary">{descricao}</p>
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  )
}
