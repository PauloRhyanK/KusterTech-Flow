import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { obterSessao } from '@/lib/auth/sessao'

export const metadata: Metadata = {
  title: 'Início',
}

export default async function PaginaInicial() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  return (
    <main className="space-y-2 p-6">
      <h1 className="text-xl font-semibold text-text-primary">Olá, {sessao.usuario.nome}</h1>
      <p className="text-sm text-text-secondary">Nenhum módulo configurado ainda.</p>
    </main>
  )
}
