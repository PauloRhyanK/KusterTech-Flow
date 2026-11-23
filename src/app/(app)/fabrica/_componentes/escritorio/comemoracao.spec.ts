import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { quemEntregou } from './comemoracao'

const a = (id: string, entregues: number | null) => ({
  id,
  numeros: { entregues, minutos: null, custoUsd: 0 },
})

test('primeira leitura não comemora ninguém', () =>
  expect(quemEntregou(null, [a('raia:x', 3)])).toEqual([]))

test('comemora quem aumentou entregues', () =>
  expect(
    quemEntregou(
      new Map([
        ['raia:x', 0],
        ['raia:y', 1],
      ]),
      [a('raia:x', 1), a('raia:y', 1)],
    ),
  ).toEqual(['raia:x']))

test('personagem novo ou sem contagem não comemora', () =>
  expect(quemEntregou(new Map(), [a('raia:z', 1), a('papel:revisor', null)])).toEqual([]))

test('o confete some com movimento reduzido (checagem estática do CSS)', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
  const bloco = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/.exec(css)?.[0] ?? ''
  expect(bloco).toContain('.esc-confete')
})
