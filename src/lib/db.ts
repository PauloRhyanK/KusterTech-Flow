import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const escopoGlobal = globalThis as unknown as {
  db?: PrismaClient
}

function criarClientePrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString && process.env.NEXT_PHASE !== 'phase-production-build') {
    throw new Error('DATABASE_URL não definida')
  }

  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 3_000,
  })
  return new PrismaClient({ adapter })
}

export const db: PrismaClient = escopoGlobal.db ?? criarClientePrisma()

if (process.env.NODE_ENV !== 'production') {
  escopoGlobal.db = db
}
