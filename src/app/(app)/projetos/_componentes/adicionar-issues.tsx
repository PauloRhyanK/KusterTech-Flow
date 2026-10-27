'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import {
  adicionarIssuesAMilestoneAction,
  type EstadoEntregas,
} from '@/app/(app)/projetos/_acoes/entregas'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface AdicionarIssuesProps {
  projetoId: string
  milestoneId: string
  busca: string
  candidatas: readonly { id: string; numero: number; titulo: string; repositorio: string }[]
  total: number
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

export function AdicionarIssues({
  projetoId,
  milestoneId,
  busca,
  candidatas,
  total,
}: AdicionarIssuesProps) {
  const [estado, formAction, pendente] = useActionState<EstadoEntregas, FormData>(
    adicionarIssuesAMilestoneAction,
    {},
  )

  return (
    <details
      open={busca !== '' || estado.sucesso !== undefined || estado.erro !== undefined}
      className="rounded-padrao border border-border bg-surface p-4"
    >
      <summary className="cursor-pointer text-sm font-medium text-text-primary">
        Adicionar issues
      </summary>
      <div className="mt-4 space-y-4">
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <label htmlFor="busca-issue" className="block text-sm font-medium text-text-primary">
              Buscar issue
            </label>
            <input
              id="busca-issue"
              name="buscaIssue"
              type="search"
              maxLength={120}
              defaultValue={busca}
              placeholder="Título ou #número"
              className={CLASSE_CAMPO}
            />
          </div>
          <Button type="submit" variant="outline">
            Buscar
          </Button>
        </form>

        <MensagensDeEstado estado={estado} />

        {candidatas.length === 0 ? (
          <p className="text-sm text-text-secondary">Nenhuma issue disponível para adicionar.</p>
        ) : (
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="projetoId" value={projetoId} />
            <input type="hidden" name="milestoneId" value={milestoneId} />
            <fieldset className="space-y-2">
              <legend className="sr-only">Issues disponíveis</legend>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-compacto border border-border p-3">
                {candidatas.map((issue) => (
                  <label
                    key={issue.id}
                    className="flex items-start gap-2 text-sm text-text-primary"
                  >
                    <input
                      type="checkbox"
                      name="issueIds"
                      value={issue.id}
                      className="mt-0.5 rounded border-border text-action-primary focus:ring-focus-ring"
                    />
                    <span className="min-w-0 break-words">
                      #{issue.numero} {issue.titulo} ({issue.repositorio})
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {total > candidatas.length && (
              <p className="text-xs text-text-secondary">
                Mostrando {candidatas.length} de {total} issues. Refine a busca.
              </p>
            )}
            <Button
              type="submit"
              aria-busy={pendente}
              onClick={(e) => {
                if (pendente) {
                  e.preventDefault()
                }
              }}
            >
              Adicionar à milestone
            </Button>
          </form>
        )}
      </div>
    </details>
  )
}
