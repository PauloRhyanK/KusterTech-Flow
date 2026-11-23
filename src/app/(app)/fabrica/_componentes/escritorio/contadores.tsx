'use client'

// Contadores do andar: trabalhando, livres e quem precisa de você. Cada um é um filtro do mapa.
import type { Grupo, contarEstados } from '@/modules/fabrica/escritorio/model'
import { cn } from '@/lib/utils'

const GRUPOS: { grupo: Grupo; texto: string; cor: string }[] = [
  { grupo: 'trabalhando', texto: 'trabalhando', cor: 'var(--pixel-folha)' },
  { grupo: 'livre', texto: 'livres', cor: 'var(--pixel-metal)' },
  {
    grupo: 'chamando',
    texto: 'precisam de você',
    cor: 'var(--pixel-balao-alerta-borda)',
  },
]

export interface ContadoresProps {
  contagem: ReturnType<typeof contarEstados>
  filtro: Grupo | null
  onFiltrar: (g: Grupo | null) => void
}

export function Contadores({ contagem, filtro, onFiltrar }: ContadoresProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {GRUPOS.map(({ grupo, texto, cor }) => {
        const n = contagem[grupo]
        const aceso = filtro === grupo
        return (
          <button
            key={grupo}
            type="button"
            aria-pressed={aceso}
            onClick={() => onFiltrar(aceso ? null : grupo)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-text-primary',
              aceso && 'ring-2 ring-focus-ring',
            )}
          >
            <i
              aria-hidden
              className="inline-block size-2.5 rounded-full"
              style={{ background: cor }}
            />
            <b>{n}</b> {texto}
          </button>
        )
      })}
    </div>
  )
}
