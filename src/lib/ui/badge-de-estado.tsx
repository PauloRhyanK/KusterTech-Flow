import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type TomDeEstado = 'sucesso' | 'informacao' | 'atencao' | 'erro' | 'neutro' | 'execucao'

export interface BadgeDeEstadoProps {
  tom: TomDeEstado
  children: string
  icone?: ReactNode
  className?: string
}

const CLASSES_TOM: Record<TomDeEstado, string> = {
  sucesso: 'bg-tonal-sucesso text-sucesso',
  informacao: 'bg-tonal-informacao text-informacao',
  atencao: 'bg-tonal-atencao text-atencao',
  erro: 'bg-tonal-erro text-erro',
  neutro: 'bg-tonal-neutro text-neutro',
  execucao: 'bg-tonal-execucao text-execucao',
}

export function BadgeDeEstado({ tom, children, icone, className }: BadgeDeEstadoProps) {
  return (
    <span
      data-tom={tom}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-compacto px-2 py-0.5 text-[11px] font-[650] leading-[1.3]',
        CLASSES_TOM[tom],
        className,
      )}
    >
      {icone && (
        <span aria-hidden="true" className="shrink-0">
          {icone}
        </span>
      )}
      {children}
    </span>
  )
}
