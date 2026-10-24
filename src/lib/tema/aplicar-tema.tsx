'use client'

import { useEffect } from 'react'
import { resolverTema, type Tema } from '@/lib/tema/tema'

export function AplicadorDeTema({ tema }: { tema: Tema }) {
  useEffect(() => {
    const raiz = document.documentElement
    raiz.dataset.tema = tema

    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null

    const aplicar = (sistemaEscuro: boolean) => {
      const resolvido = resolverTema(tema, sistemaEscuro)
      raiz.classList.toggle('dark', resolvido === 'escuro')
    }

    aplicar(Boolean(media?.matches))

    if (tema !== 'sistema' || !media) {
      return
    }

    const aoMudar = (evento: MediaQueryListEvent) => {
      aplicar(evento.matches)
    }

    media.addEventListener('change', aoMudar)
    return () => {
      media.removeEventListener('change', aoMudar)
    }
  }, [tema])

  return null
}
