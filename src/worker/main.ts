import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { resumirErroParaLog } from '@/modules/github/model'
import { executarTarefas, TAREFAS_DO_CICLO } from './tarefas'

const INTERVALO_HEARTBEAT_MS = 60_000
const INTERVALO_TIQUE_MS = 30_000
const ESPERA_MAXIMA_ENCERRAMENTO_MS = 8_000

async function rodarCiclo(): Promise<boolean> {
  const resultados = await executarTarefas(TAREFAS_DO_CICLO, new Date())
  return resultados.every((r) => r.resultado === 'ok')
}

async function umaVez(): Promise<void> {
  let codigo = 0
  try {
    if (!(await rodarCiclo())) {
      codigo = 1
    }
  } catch (err) {
    log.error({ erro: resumirErroParaLog(err) }, 'ciclo do worker falhou')
    codigo = 1
  }
  await db.$disconnect()
  log.flush()
  process.exit(codigo)
}

function iniciarWorker(): void {
  let encerrando = false
  let cicloAtual: Promise<void> | null = null

  log.info('worker iniciado')

  const intervaloHeartbeat = setInterval(() => {
    log.info('worker heartbeat')
  }, INTERVALO_HEARTBEAT_MS)

  const tique = (): void => {
    if (cicloAtual || encerrando) {
      return
    }
    cicloAtual = rodarCiclo()
      .then(() => undefined)
      .catch((err) => {
        log.error({ erro: resumirErroParaLog(err) }, 'ciclo do worker falhou')
      })
      .finally(() => {
        cicloAtual = null
      })
  }
  const intervaloTique = setInterval(tique, INTERVALO_TIQUE_MS)
  tique()

  async function encerrar(sinal: NodeJS.Signals): Promise<void> {
    if (encerrando) {
      return
    }
    encerrando = true
    clearInterval(intervaloHeartbeat)
    clearInterval(intervaloTique)
    if (cicloAtual) {
      await Promise.race([
        cicloAtual,
        new Promise((resolver) => setTimeout(resolver, ESPERA_MAXIMA_ENCERRAMENTO_MS).unref()),
      ])
    }
    log.info({ sinal }, 'worker encerrado')
    log.flush()
    setTimeout(() => {
      process.exit(0)
    }, 1_000).unref()
  }

  process.on('SIGTERM', () => void encerrar('SIGTERM'))
  process.on('SIGINT', () => void encerrar('SIGINT'))
}

process.on('unhandledRejection', (erro) => {
  log.error({ err: erro }, 'rejeição não tratada no worker')
  log.flush()
  process.exit(1)
})

if (process.argv.includes('--uma-vez')) {
  void umaVez()
} else {
  iniciarWorker()
}
