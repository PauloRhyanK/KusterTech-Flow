import Link from 'next/link'
import { Circle, CircleCheck, CircleDashed } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { cn } from '@/lib/utils'
import type { ItemChecklist } from '@/modules/projetos/model'

export interface ChecklistDeConfiguracaoProps {
  itens: readonly ItemChecklist[]
  className?: string
}

export function ChecklistDeConfiguracao({ itens, className }: ChecklistDeConfiguracaoProps) {
  return (
    <ol aria-label="Configuração do projeto" className={cn('space-y-3', className)}>
      {itens.map((item) => (
        <li
          key={item.chave}
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0">
              {item.estado === 'concluido' && (
                <CircleCheck
                  size={18}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className="text-sucesso"
                />
              )}
              {item.estado === 'pendente' && (
                <Circle size={18} strokeWidth={1.75} aria-hidden="true" className="text-atencao" />
              )}
              {item.estado === 'indisponivel' && (
                <CircleDashed
                  size={18}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className="text-neutro"
                />
              )}
            </span>
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-text-primary">{item.titulo}</p>
              <p className="text-sm text-text-secondary">{item.descricao}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-center">
            {item.estado === 'concluido' && <BadgeDeEstado tom="sucesso">Concluído</BadgeDeEstado>}
            {item.estado === 'pendente' && <BadgeDeEstado tom="atencao">Pendente</BadgeDeEstado>}
            {item.estado === 'indisponivel' && (
              <BadgeDeEstado tom="neutro">Ainda não disponível</BadgeDeEstado>
            )}
            {item.acao && (
              <Link
                href={item.acao.href}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                {item.acao.rotulo}
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
