import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface AbasDaMilestoneProps {
  rotas: { issues: string; homologacao: string }
  ativa: 'issues' | 'homologacao'
}

const ABAS = [
  { chave: 'issues', rotulo: 'Issues' },
  { chave: 'homologacao', rotulo: 'Homologação' },
] as const

export function AbasDaMilestone({ rotas, ativa }: AbasDaMilestoneProps) {
  return (
    <nav
      aria-label="Seções da milestone"
      className="flex w-full min-w-0 max-w-full items-center gap-1 overflow-x-auto border-b border-border"
    >
      {ABAS.map((aba) => {
        const atual = aba.chave === ativa
        return (
          <Link
            key={aba.chave}
            href={rotas[aba.chave]}
            aria-current={atual ? 'page' : undefined}
            className={cn(
              'relative inline-flex shrink-0 items-center border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
              atual
                ? 'border-action-primary font-semibold text-text-primary'
                : 'border-transparent text-text-secondary hover:border-border hover:text-text-primary',
            )}
          >
            {aba.rotulo}
          </Link>
        )
      })}
    </nav>
  )
}
