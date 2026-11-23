// Semente do histórico da previsão do escritório da Fábrica: preenche IntervaloDaFabrica a partir de
// ExecucaoAgente e dos eventos `etapa_concluida` das demandas. Idempotente: pode rodar de novo sem duplicar.
// Uso: pnpm semear-intervalos   (com DATABASE_URL do ambiente)
import { db } from '@/lib/db'
import { semearIntervalos } from '@/modules/fabrica/escritorio/intervalos'

async function main(): Promise<void> {
  await semearIntervalos()
  const total = await db.intervaloDaFabrica.count()
  console.log(`intervalos da Fábrica: ${total}`)
}

main()
  .catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : erro)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
