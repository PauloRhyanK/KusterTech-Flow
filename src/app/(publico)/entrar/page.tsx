import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { obterSessao } from '@/lib/auth/sessao'
import { Marca } from '@/lib/ui/marca'
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
        <header className="flex flex-col items-center space-y-3 text-center">
          <h1 className="sr-only">Entrar</h1>
          <Marca variante="principal" tamanho="lg" />
          <p className="text-sm text-text-secondary">Entre com sua conta para acessar o painel.</p>
        </header>
        <FormularioEntrar />
      </div>
    </main>
  )
}
