import type { ReactNode } from 'react'
import { exigirModulo } from '@/lib/modulos-rota'

export default function Layout({ children }: { children: ReactNode }) {
  exigirModulo('entregas')
  return children
}
