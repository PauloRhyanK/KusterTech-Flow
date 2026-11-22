import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { exigirModulo } from '@/lib/modulos-rota'

export const metadata: Metadata = {
  title: 'Decidir',
}

export default function LayoutDoDecidir({ children }: { children: ReactNode }) {
  exigirModulo('decidir')
  return children
}
