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
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <span className="font-semibold text-text-primary">KusterTech Flow</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-text-secondary">{sessao.usuario.nome}</span>
          <form method="post" action="/sair">
            <button
              type="submit"
              className="rounded-compacto border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
