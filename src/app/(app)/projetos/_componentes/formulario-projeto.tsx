'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import type { EstadoProjeto } from '../actions'

export interface FormularioProjetoProps {
  action: (estado: EstadoProjeto, form: FormData) => Promise<EstadoProjeto>
  valoresIniciais?: {
    projetoId: string
    nome: string
    descricao?: string | null
  }
  rotuloDoBotao: 'Criar projeto' | 'Salvar'
  clientesDisponiveis?: readonly { id: string; nome: string }[] | { id: string; nome: string }[]
}

export function FormularioProjeto({
  action,
  valoresIniciais,
  rotuloDoBotao,
  clientesDisponiveis = [],
}: FormularioProjetoProps) {
  const [estado, formAction, pendente] = useActionState(action, {})

  const emEdicao = Boolean(valoresIniciais?.projetoId)

  return (
    <div className="rounded-padrao border border-border bg-surface p-6">
      <form action={formAction} className="space-y-4 max-w-md">
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

        {emEdicao && valoresIniciais?.projetoId && (
          <input type="hidden" name="projetoId" value={valoresIniciais.projetoId} />
        )}

        <div className="space-y-1">
          <label htmlFor="nome" className="block text-sm font-medium text-text-primary">
            Nome
          </label>
          <input
            id="nome"
            name="nome"
            type="text"
            required
            maxLength={120}
            defaultValue={valoresIniciais?.nome ?? ''}
            key={valoresIniciais?.projetoId ?? 'novo-nome'}
            className="w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="descricao" className="block text-sm font-medium text-text-primary">
            Descrição
          </label>
          <textarea
            id="descricao"
            name="descricao"
            rows={4}
            maxLength={2000}
            aria-describedby="ajuda-descricao"
            defaultValue={valoresIniciais?.descricao ?? ''}
            key={valoresIniciais?.projetoId ? `${valoresIniciais.projetoId}-desc` : 'novo-desc'}
            className="w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          />
          <p id="ajuda-descricao" className="text-xs text-text-secondary">
            Opcional. Até 2000 caracteres.
          </p>
        </div>

        {!emEdicao && (
          <fieldset className="space-y-2 pt-1">
            <legend className="text-sm font-medium text-text-primary">Clientes</legend>
            <p className="text-xs text-text-secondary">
              Você pode associar clientes depois, na configuração do projeto.
            </p>
            {clientesDisponiveis.length > 0 && (
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-compacto border border-border p-3">
                {clientesDisponiveis.map((cliente) => (
                  <label
                    key={cliente.id}
                    className="flex items-center gap-2 text-sm text-text-primary"
                  >
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
            )}
          </fieldset>
        )}

        <div className="pt-2">
          <Button
            type="submit"
            aria-busy={pendente}
            onClick={(e) => {
              if (pendente) {
                e.preventDefault()
              }
            }}
          >
            {rotuloDoBotao}
          </Button>
        </div>
      </form>
    </div>
  )
}
