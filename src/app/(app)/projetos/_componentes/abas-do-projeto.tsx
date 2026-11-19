'use client'

import { Abas, type Aba } from '@/lib/ui/abas'

export interface AbasDoProjetoProps {
  abas: readonly Aba[]
  className?: string
}

// Reexporta o componente genérico até a Task 7 trocar os usos.
export function AbasDoProjeto({ abas, className }: AbasDoProjetoProps) {
  return <Abas abas={abas} rotulo="Seções do projeto" className={className} />
}
