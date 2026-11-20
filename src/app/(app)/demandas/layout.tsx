import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { exigirModulo } from '@/lib/modulos-rota'

export const metadata: Metadata = {
  title: 'Demandas',
}

export default function LayoutDasDemandas({ children }: { children: ReactNode }) {
  exigirModulo('demandas')
  return children
}
