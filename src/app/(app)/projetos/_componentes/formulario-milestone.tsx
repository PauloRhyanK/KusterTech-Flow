'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import {
  criarMilestoneAction,
  editarMilestoneAction,
  type EstadoEntregas,
} from '@/app/(app)/projetos/_acoes/entregas'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface FormularioMilestoneProps {
  projetoId: string
  milestone?: { id: string; titulo: string; descricao: string | null; prazo: string | null }
  clientesDoProjeto?: readonly { id: string; nome: string }[]
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

export function FormularioMilestone({
  projetoId,
  milestone,
  clientesDoProjeto = [],
}: FormularioMilestoneProps) {
  const emEdicao = milestone !== undefined
  const [estado, formAction, pendente] = useActionState<EstadoEntregas, FormData>(
    emEdicao ? editarMilestoneAction : criarMilestoneAction,
    {},
  )

  return (
    <form action={formAction} className="max-w-md space-y-4">
      <MensagensDeEstado estado={estado} />
      <input type="hidden" name="projetoId" value={projetoId} />
      {milestone && <input type="hidden" name="milestoneId" value={milestone.id} />}

      <div className="space-y-1">
        <label htmlFor="milestone-titulo" className="block text-sm font-medium text-text-primary">
          Título
        </label>
        <input
          id="milestone-titulo"
          name="titulo"
          type="text"
          required
          maxLength={120}
          defaultValue={milestone?.titulo ?? ''}
          className={CLASSE_CAMPO}
        />
      </div>

      <div className="space-y-1">
        <label
          htmlFor="milestone-descricao"
          className="block text-sm font-medium text-text-primary"
        >
          Descrição
        </label>
        <textarea
          id="milestone-descricao"
          name="descricao"
          rows={3}
          maxLength={2000}
          defaultValue={milestone?.descricao ?? ''}
          className={CLASSE_CAMPO}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="milestone-prazo" className="block text-sm font-medium text-text-primary">
          Prazo
        </label>
        <input
          id="milestone-prazo"
          name="prazo"
          type="date"
          defaultValue={milestone?.prazo ?? ''}
          className={CLASSE_CAMPO}
        />
      </div>

      {!emEdicao && clientesDoProjeto.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-text-primary">Clientes</legend>
          <div className="max-h-40 space-y-2 overflow-y-auto rounded-compacto border border-border p-3">
            {clientesDoProjeto.map((cliente) => (
              <label key={cliente.id} className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  name="clientesIds"
                  value={cliente.id}
                  className="rounded border-border text-action-primary focus:ring-focus-ring"
                />
                <span>{cliente.nome}</span>
              </label>
            ))}
          </div>
        </fieldset>
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
        {emEdicao ? 'Salvar' : 'Criar milestone'}
      </Button>
    </form>
  )
}
