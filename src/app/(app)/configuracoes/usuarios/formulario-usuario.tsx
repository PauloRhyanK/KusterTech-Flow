'use client'

import { useActionState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { criarUsuarioAction } from './actions'

export function FormularioUsuario() {
  const [estado, formAction, pendente] = useActionState(criarUsuarioAction, {})
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (estado.sucesso) {
      formRef.current?.reset()
    }
  }, [estado.sucesso])

  return (
    <div className="rounded-padrao border border-border bg-surface p-6">
      <h2 className="mb-4 text-[18px] font-[600] leading-[1.3] text-text-primary">Novo usuário</h2>

      <form ref={formRef} action={formAction} className="space-y-4 max-w-md">
        {estado.sucesso && (
          <div
            role="status"
            className="rounded-compacto border border-sucesso/30 bg-tonal-sucesso p-3 text-sm text-sucesso"
          >
            {estado.sucesso}
          </div>
        )}

        {estado.erro && (
          <div
            role="alert"
            className="rounded-compacto border border-erro/30 bg-tonal-erro p-3 text-sm text-erro"
          >
            {estado.erro}
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm font-medium text-text-primary">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="off"
            className="w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="nome" className="block text-sm font-medium text-text-primary">
            Nome
          </label>
          <input
            id="nome"
            name="nome"
            type="text"
            required
            autoComplete="off"
            className="w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
            required
            minLength={12}
            autoComplete="new-password"
            className="w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          />
          <p className="text-xs text-text-secondary">Mínimo de 12 caracteres.</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="papel" className="block text-sm font-medium text-text-primary">
            Papel
          </label>
          <select
            id="papel"
            name="papel"
            required
            defaultValue="TESTADOR"
            className="w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <option value="ADMIN">ADMIN</option>
            <option value="APROVADOR">APROVADOR</option>
            <option value="TESTADOR">TESTADOR</option>
          </select>
          <p className="text-xs text-text-secondary">válido para todos os clientes</p>
        </div>

        <div className="pt-2">
          <Button type="submit" disabled={pendente}>
            Criar usuário
          </Button>
        </div>
      </form>
    </div>
  )
}
