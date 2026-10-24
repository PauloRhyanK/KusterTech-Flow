import { redirect } from 'next/navigation'
import { obterSessao } from '@/lib/auth/sessao'

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
        <span className="font-semibold text-neutral-900">KusterTech Flow</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-neutral-700">{sessao.usuario.nome}</span>
          <form method="post" action="/sair">
            <button
              type="submit"
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-100 focus:outline-2 focus:outline-offset-2 focus:outline-neutral-900"
            >
              Sair
            </button>
          </form>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  )
}
