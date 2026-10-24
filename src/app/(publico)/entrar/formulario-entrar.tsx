'use client'

import { useActionState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { type EstadoEntrar, entrar } from './actions'

const estadoInicial: EstadoEntrar = {}

export function FormularioEntrar() {
  const [estado, acao, pendente] = useActionState(entrar, estadoInicial)
  const alertaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (estado.erro) {
      alertaRef.current?.focus()
    }
  }, [estado])

  return (
    <form action={acao} noValidate className="space-y-4">
      {estado.erro ? (
        <div
          ref={alertaRef}
          id="erro-entrar"
          role="alert"
          tabIndex={-1}
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--cor-erro) var(--tint-badge), var(--surface))',
          }}
          className="rounded-[var(--radius-compacto)] border border-erro p-3 text-sm text-erro focus:outline-none focus:ring-2 focus-visible:ring-2 ring-focus-ring ring-offset-2 ring-offset-surface"
        >
          <span className="font-medium">Erro: </span>
          {estado.erro}
        </div>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-medium text-text-primary">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={estado.email ?? ''}
          aria-invalid={Boolean(estado.erro)}
          aria-describedby={estado.erro ? 'erro-entrar' : undefined}
          className="w-full rounded-[var(--radius-compacto)] border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 ring-focus-ring ring-offset-2 ring-offset-surface"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="senha" className="block text-sm font-medium text-text-primary">
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(estado.erro)}
          aria-describedby={estado.erro ? 'erro-entrar' : undefined}
          className="w-full rounded-[var(--radius-compacto)] border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 ring-focus-ring ring-offset-2 ring-offset-surface"
        />
      </div>

      <Button
        type="submit"
        aria-busy={pendente}
        onClick={(evento) => {
          if (pendente) {
            evento.preventDefault()
          }
        }}
        className="h-auto w-full rounded-[var(--radius-compacto)] bg-action-primary px-4 py-2 text-sm font-medium text-action-foreground hover:bg-action-hover focus-visible:ring-2 ring-focus-ring ring-offset-2 ring-offset-surface aria-busy:opacity-60"
      >
        {pendente ? 'Entrando...' : 'Entrar'}
      </Button>
    </form>
  )
}
