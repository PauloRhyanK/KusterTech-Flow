import Link from 'next/link'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import type { resumoDeSaude } from '@/modules/infra/model'

export interface ResumoDeSaudeProps {
  projetoId: string
  saude: ReturnType<typeof resumoDeSaude>
}

// Sem fonte de monitoramento o resumo diz "Sem dados" em tom neutro, nunca saudável (UX-13).
export function ResumoDeSaude({ projetoId, saude }: ResumoDeSaudeProps) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <BadgeDeEstado tom={saude.tom}>{saude.texto}</BadgeDeEstado>
      <p className="text-sm text-text-secondary">{saude.detalhe}</p>
      <Link
        href={`/projetos/${projetoId}/saude`}
        className="text-sm text-text-link hover:underline"
      >
        Ver saúde e erros
      </Link>
    </div>
  )
}
