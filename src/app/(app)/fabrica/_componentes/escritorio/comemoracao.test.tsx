import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Agente } from '@/modules/fabrica/escritorio/model'
import { useComemoracao } from './comemoracao'

const a = (id: string, entregues: number | null) => ({
  id,
  numeros: { entregues, minutos: null, custoUsd: 0 },
})

afterEach(() => vi.useRealTimers())

test('a comemoração termina depois de 2500 ms', () => {
  vi.useFakeTimers()
  const ag = (n: number) => [a('raia:x', n)] as unknown as Agente[]
  const { result, rerender } = renderHook(({ l }) => useComemoracao(l), {
    initialProps: { l: ag(0) },
  })
  expect(result.current.size).toBe(0)
  rerender({ l: ag(1) })
  expect(result.current.has('raia:x')).toBe(true)
  act(() => void vi.advanceTimersByTime(2499))
  expect(result.current.has('raia:x')).toBe(true)
  act(() => void vi.advanceTimersByTime(1))
  expect(result.current.size).toBe(0)
})
