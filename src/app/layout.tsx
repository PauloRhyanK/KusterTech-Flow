import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'KusterTech Flow',
    template: '%s — KusterTech Flow',
  },
  description: 'Central de Operações KusterTech',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  )
}
