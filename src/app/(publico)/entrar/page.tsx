import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { obterSessao } from '@/lib/auth/sessao'
import { FormularioEntrar } from './formulario-entrar'

export const metadata: Metadata = {
  title: 'Entrar',
}

export default async function PaginaEntrar() {
  const sessao = await obterSessao()
  if (sessao) {
    redirect('/')
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div
        data-superficie
        className="w-full max-w-sm space-y-6 rounded-padrao border border-border bg-surface p-6"
      >
        <header className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold text-text-primary">KusterTech Flow</h1>
          <p className="text-sm text-text-secondary">Entre com sua conta para acessar o painel.</p>
        </header>
        <FormularioEntrar />
      </div>
    </main>
  )
}
