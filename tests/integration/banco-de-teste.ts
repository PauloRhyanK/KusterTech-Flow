import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '@/lib/db'

interface LinhaTabela {
  table_name: string
}

const MIGRATION_DE_DEMANDAS = 'prisma/migrations/20261120120000_demandas/migration.sql'
const MARCADOR_DO_MODELO_PADRAO = '-- Modelo padrão'

/** Limpa todas as tabelas e reaplica o modelo de etapas padrão que a migration semeia. */
export async function limparBanco(): Promise<void> {
  const tabelas = await db.$queryRaw<LinhaTabela[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
  `

  if (tabelas.length > 0) {
    const nomesCitados = tabelas
      .map(({ table_name }) => `"${table_name.replaceAll('"', '""')}"`)
      .join(', ')

    await db.$executeRawUnsafe(`TRUNCATE TABLE ${nomesCitados} RESTART IDENTITY CASCADE`)
  }

  await semearModeloPadrao()
}

// O TRUNCATE apaga o modelo semeado pela migration; reaplica só o trecho de semente (sem o índice).
export async function semearModeloPadrao(): Promise<void> {
  const sql = readFileSync(join(process.cwd(), MIGRATION_DE_DEMANDAS), 'utf8')
  const trecho = sql.slice(sql.indexOf(MARCADOR_DO_MODELO_PADRAO))
  for (const comando of trecho.split(';')) {
    const util = comando
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .trim()
    if (util !== '' && !util.startsWith('CREATE UNIQUE INDEX')) await db.$executeRawUnsafe(util)
  }
}
