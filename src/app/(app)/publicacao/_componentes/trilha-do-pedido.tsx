import type { EstadoDaEtapa, EtapaDaTrilha } from '@/modules/fila-de-publicacao/apresentacao'
import { cn } from '@/lib/utils'

const TEXTO_DO_ESTADO: Record<EstadoDaEtapa, string> = {
  feita: 'feita',
  atual: 'em andamento',
  pendente: 'pendente',
  falhou: 'falhou',
}

const PONTO: Record<EstadoDaEtapa, string> = {
  feita: 'bg-sucesso',
  atual: 'bg-execucao',
  pendente: 'bg-border-strong',
  falhou: 'bg-erro',
}

export function TrilhaDoPedido({ etapas }: { etapas: EtapaDaTrilha[] }) {
  return (
    <ol aria-label="Etapas da publicação" className="space-y-1.5">
      {etapas.map((e) => (
        <li key={e.chave} className="flex items-start gap-2 text-sm">
          <span
            aria-hidden="true"
            className={cn('mt-1.5 inline-block size-2 shrink-0 rounded-full', PONTO[e.estado])}
          />
          <span
            className={cn(
              e.estado === 'pendente' ? 'text-text-tertiary' : 'text-text-primary',
              e.estado === 'falhou' && 'font-[600] text-erro',
            )}
          >
            {e.rotulo}
            <span className="sr-only">{`: ${TEXTO_DO_ESTADO[e.estado]}`}</span>
          </span>
          <span className="text-xs text-text-secondary">{e.detalhe ?? '—'}</span>
        </li>
      ))}
    </ol>
  )
}
