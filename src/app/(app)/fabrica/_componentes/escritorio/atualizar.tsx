'use client'

// Relê a tela a cada 30 s (a Fábrica manda o retrato a cada 60 s); as animações rodam entre uma leitura e outra.
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export const INTERVALO_DE_LEITURA_MS = 30_000

export function Atualizar() {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => router.refresh(), INTERVALO_DE_LEITURA_MS)
    return () => clearInterval(t)
  }, [router])
  return null
}
