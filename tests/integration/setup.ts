import { execFileSync } from 'node:child_process'
import { PrismaPg } from '@prisma/adapter-pg'
import { DriverAdapterError } from '@prisma/driver-adapter-utils'

function obterUrlBancoTeste(): string {
  const urlTeste = process.env.DATABASE_URL_TEST?.trim()
  if (!urlTeste) {
    throw new Error('DATABASE_URL_TEST é obrigatória para executar os testes de integração.')
  }
  return urlTeste
}

async function garantirBancoDeTeste(urlTeste: string): Promise<void> {
  const parsed = new URL(urlTeste)
  const nomeBanco = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!nomeBanco || !/^[a-zA-Z0-9_-]+$/.test(nomeBanco)) {
    return
  }

  const urlManutencao = new URL(urlTeste)
  urlManutencao.pathname = '/postgres'

  const factory = new PrismaPg({ connectionString: urlManutencao.toString() })
  const adapter = await factory.connect()
  try {
    await adapter.executeScript(`CREATE DATABASE "${nomeBanco}"`)
  } catch (erro) {
    if (!(erro instanceof DriverAdapterError && erro.cause.kind === 'DatabaseAlreadyExists')) {
      throw erro
    }
  } finally {
    await adapter.dispose()
  }
}

export default async function setup(): Promise<void> {
  const urlTeste = obterUrlBancoTeste()
  process.env.DATABASE_URL = urlTeste

  await garantirBancoDeTeste(urlTeste)

  execFileSync('pnpm', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: urlTeste,
    },
  })
}
