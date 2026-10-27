import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { obterFonteGitHub } from '@/modules/github/fonte'
import { executarCiclo } from '@/modules/github/reconciliacao'
import { INTERVALO_PADRAO_MS, resumirErroParaLog } from '@/modules/github/model'

const INTERVALO_HEARTBEAT_MS = 60_000
const INTERVALO_TIQUE_MS = 30_000
const ESPERA_MAXIMA_ENCERRAMENTO_MS = 8_000

async function rodarCiclo(): Promise<void> {
  const intervaloMs = Number(process.env.GITHUB_INTERVALO_MS) || INTERVALO_PADRAO_MS
  const resultado = await executarCiclo(obterFonteGitHub(process.env), new Date(), intervaloMs)
  if (resultado.catalogo || resultado.repositorios > 0) {
    log.info(resultado, 'ciclo de reconciliação do GitHub')
  }
}

async function umaVez(): Promise<void> {
  let codigo = 0
  try {
    await rodarCiclo()
  } catch (err) {
    log.error({ erro: resumirErroParaLog(err) }, 'ciclo de reconciliação do GitHub falhou')
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
      .catch((err) => {
        log.error({ erro: resumirErroParaLog(err) }, 'ciclo de reconciliação do GitHub falhou')
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
