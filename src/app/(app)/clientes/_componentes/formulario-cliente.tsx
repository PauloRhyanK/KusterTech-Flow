'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'

export interface EstadoCliente {
  erro?: string
  sucesso?: string
}

export interface FormularioClienteProps {
  action: (estado: EstadoCliente, form: FormData) => Promise<EstadoCliente>
  valoresIniciais?: {
    clienteId: string
    nome: string
    observacoes: string
  }
  rotuloDoBotao: 'Criar cliente' | 'Salvar'
}

export function FormularioCliente({
  action,
  valoresIniciais,
  rotuloDoBotao,
}: FormularioClienteProps) {
  const [estado, formAction, pendente] = useActionState(action, {})

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

        {valoresIniciais?.clienteId && (
          <input type="hidden" name="clienteId" value={valoresIniciais.clienteId} />
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
            key={valoresIniciais?.clienteId ?? 'novo-nome'}
            className="w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="observacoes" className="block text-sm font-medium text-text-primary">
            Observações
          </label>
          <textarea
            id="observacoes"
            name="observacoes"
            rows={4}
            maxLength={2000}
            aria-describedby="ajuda-observacoes"
            defaultValue={valoresIniciais?.observacoes ?? ''}
            key={valoresIniciais?.clienteId ? `${valoresIniciais.clienteId}-obs` : 'novo-obs'}
            className="w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          />
          <p id="ajuda-observacoes" className="text-xs text-text-secondary">
            Opcional. Até 2000 caracteres.
          </p>
        </div>

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
