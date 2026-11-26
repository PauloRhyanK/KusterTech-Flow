'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export const INTERVALO_DA_BUSCA_MS = 3000

/** Relê a tela a cada 3 s enquanto `ativo` (a busca ainda não voltou da Fábrica). */
export function AtualizarEnquanto({ ativo }: { ativo: boolean }) {
  const router = useRouter()
  useEffect(() => {
    if (!ativo) return
    const t = setInterval(() => router.refresh(), INTERVALO_DA_BUSCA_MS)
    return () => clearInterval(t)
  }, [ativo, router])
  return null
}
