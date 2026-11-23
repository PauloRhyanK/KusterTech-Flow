'use client'

// Comemoração não é um estado do modelo: é o que a tela faz quando o contador de entregas de alguém sobe
// entre duas leituras. Dura alguns segundos e some.
import { useEffect, useRef, useState } from 'react'
import type { Agente } from '@/modules/fabrica/escritorio/model'

/** Ids de quem entregou mais do que na leitura anterior. Sem leitura anterior ou sem contagem, ninguém. */
export function quemEntregou(
  antes: Map<string, number> | null,
  agentes: Pick<Agente, 'id' | 'numeros'>[],
): string[] {
  if (!antes) return []
  return agentes
    .filter((a) => {
      const antigo = antes.get(a.id)
      return antigo !== undefined && a.numeros.entregues !== null && a.numeros.entregues > antigo
    })
    .map((a) => a.id)
}

export function useComemoracao(agentes: Agente[], duracaoMs = 2500): Set<string> {
  const anterior = useRef<Map<string, number> | null>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const [comemorando, setComemorando] = useState<Set<string>>(new Set())

  useEffect(() => {
    const ids = quemEntregou(anterior.current, agentes)
    anterior.current = new Map(
      agentes.flatMap((a) => (a.numeros.entregues === null ? [] : [[a.id, a.numeros.entregues]])),
    )
    if (ids.length === 0) return
    setComemorando((atual) => new Set([...atual, ...ids]))
    const t = setTimeout(() => {
      timers.current.delete(t)
      setComemorando((atual) => new Set([...atual].filter((id) => !ids.includes(id))))
    }, duracaoMs)
    timers.current.add(t)
  }, [agentes, duracaoMs])

  useEffect(() => {
    const ativos = timers.current
    return () => ativos.forEach(clearTimeout)
  }, [])

  return comemorando
}
