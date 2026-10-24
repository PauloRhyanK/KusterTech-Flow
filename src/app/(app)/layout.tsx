import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { obterSessao } from '@/lib/auth/sessao'
import { NavegacaoLateral } from './_shell/navegacao-lateral'
import { BarraSuperior } from './_shell/barra-superior'

export default async function AppLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const usuario = {
    nome: sessao.usuario.nome,
    email: sessao.usuario.email,
  }

  return (
    <div className="min-h-screen bg-background text-text-primary md:grid md:grid-cols-[256px_1fr]">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-compacto focus:border focus:border-border focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-text-primary focus:shadow-md focus:outline-none focus:ring-2 focus:ring-focus-ring"
      >
        Pular para o conteúdo
      </a>

      <NavegacaoLateral usuario={usuario} />

      <div className="flex min-h-screen flex-col">
        <BarraSuperior usuario={usuario} />
        <main id="conteudo" tabIndex={-1} className="flex-1 p-6 outline-none">
          {children}
        </main>
      </div>
    </div>
  )
}
