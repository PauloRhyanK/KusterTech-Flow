'use client'

import { useEffect, useLayoutEffect } from 'react'
import { resolverTema, type Tema } from '@/lib/tema/tema'

export function AplicadorDeTema({ tema }: { tema: Tema }) {
  useLayoutEffect(() => {
    const raiz = document.documentElement
    raiz.dataset.tema = tema

    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null

    const resolvido = resolverTema(tema, Boolean(media?.matches))
    raiz.classList.toggle('dark', resolvido === 'escuro')
  }, [tema])

  useEffect(() => {
    if (tema !== 'sistema') {
      return
    }

    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null

    if (!media) {
      return
    }

    const raiz = document.documentElement
    const aoMudar = (evento: MediaQueryListEvent) => {
      const resolvido = resolverTema('sistema', evento.matches)
      raiz.classList.toggle('dark', resolvido === 'escuro')
    }

    media.addEventListener('change', aoMudar)
    return () => {
      media.removeEventListener('change', aoMudar)
    }
  }, [tema])

  return null
}
