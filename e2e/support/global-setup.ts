import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import { DriverAdapterError } from '@prisma/driver-adapter-utils'

function carregarEnvSeNecessario(): void {
  if (!process.env.DATABASE_URL_TEST && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile()
    } catch {
      // Ignora se .env não existir (ex.: no CI)
    }
  }
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

export default async function globalSetup(): Promise<void> {
  carregarEnvSeNecessario()

  const urlTeste = process.env.DATABASE_URL_TEST?.trim()
  if (!urlTeste) {
    throw new Error('DATABASE_URL_TEST é obrigatória para executar os testes E2E.')
  }

  process.env.DATABASE_URL = urlTeste

  await garantirBancoDeTeste(urlTeste)

  execFileSync('pnpm', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: urlTeste,
    },
  })

  const email = `e2e+${Date.now()}@local.test`
  const senha = randomBytes(24).toString('base64url')

  execFileSync(
    'node',
    ['--import', 'tsx', 'scripts/criar-admin.ts', '--email', email, '--nome', 'Admin E2E'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: urlTeste,
        FLOW_ADMIN_SENHA: senha,
      },
    },
  )

  process.env.E2E_ADMIN_EMAIL = email
  process.env.E2E_ADMIN_SENHA = senha
}
