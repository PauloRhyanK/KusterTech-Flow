// Migra as demandas já existentes para a regra "até o ar" (spec 12). Rode UMA vez depois do deploy,
// com o worker parado (a migração não trava os pedidos de publicação) e a DATABASE_URL do ambiente.
// Idempotente: demanda que já tem partes não muda.
// Uso: pnpm migrar:ate-o-ar

function carregarEnvSeNecessario(): void {
  if (!process.env.DATABASE_URL && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile()
    } catch {
      // Ignora se .env não existir (ex.: dentro do container)
    }
  }
}

async function executar(): Promise<void> {
  carregarEnvSeNecessario()
  const { db } = await import('@/lib/db')
  const { migrarDemandasAteOAr } = await import('@/modules/demandas/migracao-ate-o-ar-service')
  try {
    const r = await migrarDemandasAteOAr()
    console.log(`${r.migradas} migradas, ${r.reabertas} reabertas, ${r.noAr} no ar`)
  } finally {
    await db.$disconnect()
  }
}

executar().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro)
  process.exitCode = 1
})
