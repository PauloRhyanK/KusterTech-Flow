'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { criarUsuarioAction } from './actions'

export interface FormularioUsuarioProps {
  clientes: { id: string; nome: string }[]
}

export function FormularioUsuario({ clientes }: FormularioUsuarioProps) {
  const [estado, formAction, pendente] = useActionState(criarUsuarioAction, {})

  return (
    <div className="rounded-padrao border border-border bg-surface p-6">
      <h2 className="mb-4 text-[18px] font-[600] leading-[1.3] text-text-primary">Novo usuário</h2>

      <form action={formAction} className="space-y-4 max-w-md">
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
            aria-describedby="ajuda-senha"
            className="w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          />
          <p id="ajuda-senha" className="text-xs text-text-secondary">
            Mínimo de 12 caracteres.
          </p>
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
        </div>

        <div className="space-y-1">
          <label htmlFor="clienteId" className="block text-sm font-medium text-text-primary">
            Cliente
          </label>
          <select
            id="clienteId"
            name="clienteId"
            defaultValue=""
            aria-describedby="ajuda-cliente"
            className="w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <option value="">Todos os clientes</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          <p id="ajuda-cliente" className="text-xs text-text-secondary">
            Aprovadores e testadores podem ser limitados a um cliente. Administradores são sempre
            globais.
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
            Criar usuário
          </Button>
        </div>
      </form>
    </div>
  )
}
