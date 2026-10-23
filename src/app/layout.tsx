import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'KusterTech Flow',
  description: 'Central de Operações KusterTech',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
