import type { Metadata } from 'next'
import './globals.css'
import { AplicadorDeTema } from '@/lib/tema/aplicar-tema'
import { ScriptDeTema } from '@/lib/tema/script-de-tema'
import { obterTemaAtual } from '@/lib/tema/servidor'

export const metadata: Metadata = {
  title: {
    default: 'KusterTech Flow',
    template: '%s — KusterTech Flow',
  },
  description: 'Central de Operações KusterTech',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const tema = await obterTemaAtual()

  return (
    <html
      lang="pt-BR"
      data-tema={tema}
      className={tema === 'escuro' ? 'dark' : undefined}
      suppressHydrationWarning
    >
      <head>
        <ScriptDeTema />
      </head>
      <body className="min-h-screen bg-background font-sans text-text-primary antialiased">
        <AplicadorDeTema tema={tema} />
        {children}
      </body>
    </html>
  )
}
