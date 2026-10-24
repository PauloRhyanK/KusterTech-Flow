import { log } from '@/lib/log'

const INTERVALO_HEARTBEAT_MS = 60_000

let encerrando = false

log.info('worker iniciado')

const intervaloHeartbeat = setInterval(() => {
  log.info('worker heartbeat')
}, INTERVALO_HEARTBEAT_MS)

function encerrar(sinal: NodeJS.Signals): void {
  if (encerrando) {
    return
  }
  encerrando = true
  clearInterval(intervaloHeartbeat)
  log.info({ sinal }, 'worker encerrado')
  log.flush()
  setTimeout(() => {
    process.exit(0)
  }, 1_000).unref()
}

process.on('SIGTERM', () => encerrar('SIGTERM'))
process.on('SIGINT', () => encerrar('SIGINT'))
process.on('unhandledRejection', (erro) => {
  log.error({ err: erro }, 'rejeição não tratada no worker')
  log.flush()
  process.exit(1)
})
