// Migra as demandas já existentes para a regra "até o ar" (spec 12). Rode UMA vez depois do deploy,
// com a DATABASE_URL do ambiente. Idempotente: demanda que já tem partes não muda.
// Uso: pnpm migrar:ate-o-ar
import { db } from '@/lib/db'
import { migrarDemandasAteOAr } from '@/modules/demandas/migracao-ate-o-ar-service'

migrarDemandasAteOAr()
  .then((r) => console.log(`${r.migradas} migradas, ${r.reabertas} reabertas, ${r.noAr} no ar`))
  .catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : erro)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
