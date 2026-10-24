import { redirect } from 'next/navigation'
import { obterSessao } from '@/lib/auth/sessao'

export default async function PaginaInicial() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  return (
    <main className="space-y-2 p-6">
      <h1 className="text-xl font-semibold text-neutral-900">Olá, {sessao.usuario.nome}</h1>
      <p className="text-sm text-neutral-600">Nenhum módulo configurado ainda.</p>
    </main>
  )
}
