'use client'

import { useActionState, useEffect, useRef } from 'react'
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
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 focus:outline-2 focus:outline-offset-2 focus:outline-neutral-900"
        >
          <span className="font-medium">Erro: </span>
          {estado.erro}
        </div>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-medium text-neutral-900">
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
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-2 focus:outline-offset-0 focus:outline-neutral-900"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="senha" className="block text-sm font-medium text-neutral-900">
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
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-2 focus:outline-offset-0 focus:outline-neutral-900"
        />
      </div>

      <button
        type="submit"
        disabled={pendente}
        aria-disabled={pendente}
        className="w-full rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 focus:outline-2 focus:outline-offset-2 focus:outline-neutral-900 disabled:opacity-60"
      >
        {pendente ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  )
}
