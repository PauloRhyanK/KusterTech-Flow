import { db } from '@/lib/db'

interface LinhaTabela {
  table_name: string
}

export async function limparBanco(): Promise<void> {
  const tabelas = await db.$queryRaw<LinhaTabela[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
  `

  if (tabelas.length === 0) {
    return
  }

  const nomesCitados = tabelas
    .map(({ table_name }) => `"${table_name.replaceAll('"', '""')}"`)
    .join(', ')

  await db.$executeRawUnsafe(`TRUNCATE TABLE ${nomesCitados} RESTART IDENTITY CASCADE`)
}
