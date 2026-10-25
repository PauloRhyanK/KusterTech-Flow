'use client'

import { useActionState } from 'react'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { Button } from '@/components/ui/button'
import { associarClienteAction, desassociarClienteAction } from '../actions'

export interface ClienteAssociado {
  id: string
  nome: string
}

export interface AssociacaoDeClientesProps {
  projetoId: string
  associados: readonly ClienteAssociado[] | ClienteAssociado[]
  disponiveis: readonly ClienteAssociado[] | ClienteAssociado[]
}

export function AssociacaoDeClientes({
  projetoId,
  associados,
  disponiveis,
}: AssociacaoDeClientesProps) {
  const [estado, formAction, pendente] = useActionState(associarClienteAction, {})

  return (
    <div className="space-y-6 rounded-padrao border border-border bg-surface p-6">
      <div
        role="status"
        aria-live="polite"
        className={
          estado.sucesso
            ? 'rounded-compacto border border-sucesso/30 bg-tonal-sucesso p-3 text-sm text-sucesso'
            : 'sr-only'
        }
      >
        {estado.sucesso ?? ''}
      </div>

      <div
        role="alert"
        aria-live="assertive"
        className={
          estado.erro
            ? 'rounded-compacto border border-erro/30 bg-tonal-erro p-3 text-sm text-erro'
            : 'sr-only'
        }
      >
        {estado.erro ?? ''}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Clientes associados</h3>
        {associados.length === 0 ? (
          <p className="text-sm text-text-secondary">Nenhum cliente associado.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {associados.map((cliente) => (
              <li
                key={cliente.id}
                className="flex items-center justify-between py-2 text-sm text-text-primary"
              >
                <span>{cliente.nome}</span>
                <BotaoDeConfirmacao
                  rotulo="Remover"
                  rotuloDeConfirmacao="Confirmar remoção"
                  action={desassociarClienteAction}
                  camposOcultos={{
                    projetoId,
                    clienteId: cliente.id,
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-2">
        {disponiveis.length === 0 ? (
          <p className="text-sm text-text-secondary">Todos os clientes já estão associados.</p>
        ) : (
          <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="projetoId" value={projetoId} />
            <div className="flex-1 space-y-1">
              <label htmlFor="clienteId" className="block text-sm font-medium text-text-primary">
                Cliente
              </label>
              <select
                id="clienteId"
                name="clienteId"
                required
                defaultValue=""
                className="w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <option value="" disabled>
                  Selecione um cliente
                </option>
                {disponiveis.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {cliente.nome}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="submit"
              aria-busy={pendente}
              onClick={(e) => {
                if (pendente) {
                  e.preventDefault()
                }
              }}
            >
              Associar
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
