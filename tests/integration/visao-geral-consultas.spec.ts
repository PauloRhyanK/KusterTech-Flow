import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const contador = vi.hoisted(() => ({ n: 0 }))

vi.mock('@/lib/db', async () => {
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { PrismaClient } = await import('@prisma/client')
  const base = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })
  const db = base.$extends({
    query: {
      $allOperations({ args, query }) {
        contador.n++
        return query(args)
      },
    },
  })
  return { db }
})

import { db } from '@/lib/db'
import { obterVisaoGeral } from '@/modules/visao-geral/queries'
import { limparBanco } from './banco-de-teste'
import {
  AGORA_DA_VISAO_GERAL,
  ampliarCenarioDaVisaoGeral,
  criarCenarioDaVisaoGeral,
  type CenarioDaVisaoGeral,
} from './fabricas/visao-geral'

let c: CenarioDaVisaoGeral

beforeEach(async () => {
  await limparBanco()
  c = await criarCenarioDaVisaoGeral(AGORA_DA_VISAO_GERAL)
})

afterAll(async () => {
  await db.$disconnect()
})

async function operacoes(): Promise<number> {
  contador.n = 0
  await obterVisaoGeral(c.admin, { expandido: null, agora: c.agora })
  return contador.n
}

test('obterVisaoGeral do admin faz o mesmo número de operações Prisma no cenário base e no cenário com 10 projetos incompletos, 10 alertas ativos e 10 homologações a mais, e no máximo 14', async () => {
  const base = await operacoes()
  await ampliarCenarioDaVisaoGeral(c, 10)
  const ampliado = await operacoes()

  expect(base).toBeGreaterThan(0)
  expect(ampliado).toBe(base)
  expect(base).toBeLessThanOrEqual(14)
})
