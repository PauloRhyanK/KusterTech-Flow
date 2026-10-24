import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const escopoGlobal = globalThis as unknown as {
  db?: PrismaClient
}

function criarClientePrisma(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  })
  return new PrismaClient({ adapter })
}

export const db: PrismaClient = escopoGlobal.db ?? criarClientePrisma()

if (process.env.NODE_ENV !== 'production') {
  escopoGlobal.db = db
}
