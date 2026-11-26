import type { ReactNode } from 'react'
import { exigirModulo } from '@/lib/modulos-rota'

export default function LayoutDosSistemas({ children }: { children: ReactNode }) {
  exigirModulo('relatos')
  return children
}
