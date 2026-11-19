import { cn } from '@/lib/utils'

export interface QuadroDeMetricaProps {
  rotulo: string
  valor: string | null
  complemento?: string
  barra?: { pct: number; tom: 'informacao' | 'atencao' }
  nota?: string
  className?: string
}

const COR_DA_BARRA: Record<NonNullable<QuadroDeMetricaProps['barra']>['tom'], string> = {
  informacao: 'bg-action-primary',
  atencao: 'bg-atencao',
}

// Uma medida com rótulo, número em destaque e, opcionalmente, barra e nota. Sem moldura:
// quem usa decide se é um cartão próprio ou parte de outro.
export function QuadroDeMetrica({
  rotulo,
  valor,
  complemento,
  barra,
  nota,
  className,
}: QuadroDeMetricaProps) {
  const pct = barra ? Math.min(100, Math.max(0, Math.round(barra.pct))) : 0
  return (
    <div className={cn('space-y-1', className)}>
      <p className="text-[13px] text-text-secondary">{rotulo}</p>
      {valor === null ? (
        <p className="text-[22px] font-[650] leading-[1.3] tracking-[-0.02em] text-text-tertiary">
          Sem dados
        </p>
      ) : (
        <p className="text-[22px] font-[650] leading-[1.3] tracking-[-0.02em] text-text-primary">
          {valor}
          {complemento && (
            <span className="ml-1.5 text-[13px] font-normal tracking-normal text-text-secondary">
              {complemento}
            </span>
          )}
        </p>
      )}
      {valor !== null && barra && (
        <div
          role="progressbar"
          aria-label={rotulo}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="!mt-2.5 h-2.5 overflow-hidden rounded-full bg-surface-subtle"
        >
          <div
            className={cn('h-full rounded-full', COR_DA_BARRA[barra.tom])}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {nota && <p className="text-[13px] text-text-secondary">{nota}</p>}
    </div>
  )
}
