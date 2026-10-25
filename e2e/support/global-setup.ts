import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { garantirBancoDeTeste } from '../../tests/support/banco-de-teste-compartilhado'

function carregarEnvSeNecessario(): void {
  if (!process.env.DATABASE_URL_TEST && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile()
    } catch {
      // Ignora se .env não existir (ex.: no CI)
    }
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

  const sufixo = `${Date.now()}-${randomBytes(4).toString('hex')}`
  process.env.E2E_SUFIXO = sufixo

  const { db } = await import('@/lib/db')
  try {
    await db.tentativaLogin.deleteMany({})
    await db.usuario.deleteMany({
      where: {
        email: {
          startsWith: 'e2e+',
          endsWith: '@local.test',
        },
      },
    })
    await db.usuarioPapel.deleteMany({
      where: {
        cliente: {
          nome: { startsWith: 'E2E ' },
        },
      },
    })
    await db.projetoCliente.deleteMany({
      where: {
        OR: [
          { projeto: { nome: { startsWith: 'E2E ' } } },
          { cliente: { nome: { startsWith: 'E2E ' } } },
        ],
      },
    })
    await db.projeto.deleteMany({
      where: {
        nome: { startsWith: 'E2E ' },
      },
    })
    await db.cliente.deleteMany({
      where: {
        nome: { startsWith: 'E2E ' },
      },
    })
  } finally {
    await db.$disconnect()
  }

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

  const { db: dbAdmin } = await import('@/lib/db')
  try {
    const admin = await dbAdmin.usuario.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    })
    process.env.E2E_ADMIN_ID = admin.id
  } finally {
    await dbAdmin.$disconnect()
  }

  process.env.E2E_ADMIN_EMAIL = email
  process.env.E2E_ADMIN_SENHA = senha
}
