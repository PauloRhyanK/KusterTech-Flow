import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { exigirModulo } from '@/lib/modulos-rota'

export const metadata: Metadata = {
  title: 'Publicação',
}

export default function LayoutDaPublicacao({ children }: { children: ReactNode }) {
  exigirModulo('fila-de-publicacao')
  return children
}
