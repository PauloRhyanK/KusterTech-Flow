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
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 rounded border border-neutral-200 p-6">
        <header className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold text-neutral-900">KusterTech Flow</h1>
          <p className="text-sm text-neutral-600">Entre com sua conta para acessar o painel.</p>
        </header>
        <FormularioEntrar />
      </div>
    </main>
  )
}
