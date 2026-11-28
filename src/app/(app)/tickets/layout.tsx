import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { exigirModulo } from '@/lib/modulos-rota'

export const metadata: Metadata = {
  title: 'Tickets',
}

export default function LayoutDosTickets({ children }: { children: ReactNode }) {
  exigirModulo('tickets')
  return children
}
