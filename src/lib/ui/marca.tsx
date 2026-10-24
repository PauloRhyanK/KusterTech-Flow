import { cn } from '@/lib/utils'

export type VarianteDaMarca = 'principal' | 'compacta' | 'simbolo'
export type TamanhoDaMarca = 'sm' | 'md' | 'lg'

export interface MarcaProps {
  variante?: VarianteDaMarca
  tamanho?: TamanhoDaMarca
  className?: string
}

export interface SimboloDaMarcaProps {
  tamanho?: number
  className?: string
}

const TAMANHOS_TEXTO: Record<TamanhoDaMarca, string> = {
  sm: 'text-[22px]',
  md: 'text-[30px]',
  lg: 'text-[40px]',
}

const TAMANHOS_SIMBOLO: Record<TamanhoDaMarca, number> = {
  sm: 20,
  md: 28,
  lg: 36,
}

/**
 * Símbolo visual da marca KusterTech Flow composto por três losangos arredondados.
 * Este elemento SVG é sempre `aria-hidden="true"`. Consumidores que utilizarem
 * o símbolo fora do componente `Marca` devem fornecer nome acessível no contêiner
 * (por exemplo, via `aria-label` ou texto contextual associado).
 */
export function SimboloDaMarca({ tamanho = 24, className }: SimboloDaMarcaProps) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      {/* Losango superior esquerdo: Signal Blue */}
      <rect
        x="4.7"
        y="4.7"
        width="5.6"
        height="5.6"
        rx="1.2"
        transform="rotate(45 7.5 7.5)"
        className="fill-action-primary"
      />
      {/* Losango superior direito: Flow Teal */}
      <rect
        x="13.7"
        y="4.7"
        width="5.6"
        height="5.6"
        rx="1.2"
        transform="rotate(45 16.5 7.5)"
        className="fill-marca-flow"
      />
      {/* Losango inferior: neutro (currentColor / cor de texto sobre o fundo atual) */}
      <rect
        x="9.2"
        y="13.7"
        width="5.6"
        height="5.6"
        rx="1.2"
        transform="rotate(45 12 16.5)"
        className="fill-current"
      />
    </svg>
  )
}

export function Marca({ variante = 'compacta', tamanho = 'md', className }: MarcaProps) {
  if (variante === 'simbolo') {
    return (
      <div
        role="img"
        aria-label="KusterTech Flow"
        className={cn('inline-flex items-center justify-center', className)}
      >
        <SimboloDaMarca tamanho={TAMANHOS_SIMBOLO[tamanho]} />
      </div>
    )
  }

  const classeTamanho = TAMANHOS_TEXTO[tamanho]

  if (variante === 'principal') {
    return (
      <div
        role="img"
        aria-label="KusterTech Flow"
        className={cn(
          'inline-flex min-w-[120px] flex-col items-end font-sans leading-none',
          classeTamanho,
          className,
        )}
      >
        <div aria-hidden="true" className="flex items-baseline">
          <span className="font-[600] text-marca-kuster">Kuster</span>
          <span className="font-[700] text-marca-tech">Tech</span>
        </div>
        {tamanho !== 'sm' && (
          <div
            aria-hidden="true"
            data-marca-flow
            className="text-[0.25em] font-[650] uppercase leading-none tracking-[0.18em] text-marca-flow"
          >
            FLOW
          </div>
        )}
      </div>
    )
  }

  // variante === 'compacta'
  return (
    <div
      role="img"
      aria-label="KusterTech Flow"
      className={cn(
        'inline-flex min-w-[120px] items-baseline font-sans leading-none',
        classeTamanho,
        className,
      )}
    >
      <span aria-hidden="true" className="inline-flex items-baseline">
        <span className="font-[600] text-marca-kuster">Kuster</span>
        <span className="font-[700] text-marca-tech">Tech</span>
      </span>
      {tamanho !== 'sm' && (
        <>
          <span aria-hidden="true" className="inline-block w-[1ch]" />
          <span
            aria-hidden="true"
            data-marca-flow
            className="text-[0.25em] font-[650] uppercase leading-none tracking-[0.18em] text-marca-flow"
          >
            FLOW
          </span>
        </>
      )}
    </div>
  )
}
