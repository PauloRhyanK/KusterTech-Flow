import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { rodarWorkerUmaVez } from './worker'
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
    const dosExemplos = { repositorio: { nomeCompleto: { startsWith: 'kustertech-exemplo/' } } }
    await db.repositorioGitHub.updateMany({
      where: { nomeCompleto: { startsWith: 'kustertech-exemplo/' } },
      data: { projetoId: null, vinculadoEm: null },
    })
    await db.issueVinculo.deleteMany({
      where: {
        OR: [
          { original: dosExemplos },
          { correcao: dosExemplos },
          { criadoPor: { email: { startsWith: 'e2e+' } } },
        ],
      },
    })
    // Publicação antes de tudo o que ela referencia (versões, evidências, issues e usuários).
    await db.autorizacaoItem.deleteMany({ where: { autorizacao: dosExemplos } })
    await db.autorizacaoProd.deleteMany({ where: dosExemplos })
    await db.composicaoDePublicacao.deleteMany({ where: dosExemplos })
    await db.divergenciaDeDeploy.deleteMany({ where: { versao: dosExemplos } })
    await db.verificacaoProd.deleteMany({ where: { versao: dosExemplos } })
    // Homologação (criada pela tarefa do worker) antes de milestones, versões e issues; as tarefas
    // do GitHub apontam para as solicitações.
    await db.tarefaGitHub.deleteMany({ where: dosExemplos })
    await db.solicitacaoDeCorrecao.deleteMany({})
    await db.homologacaoItem.deleteMany({})
    await db.eventoTimeline.deleteMany({})
    await db.homologacao.deleteMany({})
    await db.milestoneIssue.deleteMany({
      where: {
        OR: [{ issue: dosExemplos }, { milestone: { projeto: { nome: { startsWith: 'E2E ' } } } }],
      },
    })
    await db.milestoneCliente.deleteMany({
      where: {
        OR: [
          { milestone: { projeto: { nome: { startsWith: 'E2E ' } } } },
          { cliente: { nome: { startsWith: 'E2E ' } } },
        ],
      },
    })
    await db.milestone.deleteMany({ where: { projeto: { nome: { startsWith: 'E2E ' } } } })
    // Implantação, na ordem das FKs: presenças → evidências → versões → ambientes.
    const versoesDeExemplo = { versao: dosExemplos }
    const projetosE2E = { projeto: { nome: { startsWith: 'E2E ' } } }
    await db.presencaIssueVersao.deleteMany({
      where: { OR: [{ issue: dosExemplos }, versoesDeExemplo] },
    })
    await db.evidenciaDeploy.deleteMany({
      where: { OR: [versoesDeExemplo, { ambiente: projetosE2E }, { versao: projetosE2E }] },
    })
    await db.versao.deleteMany({ where: { OR: [dosExemplos, projetosE2E] } })
    await db.ambiente.deleteMany({ where: projetosE2E })
    await db.pullRequestGitHub.deleteMany({ where: dosExemplos })
    await db.issueGitHub.deleteMany({ where: dosExemplos })
    await db.repositorioGitHub.deleteMany({
      where: { nomeCompleto: { startsWith: 'kustertech-exemplo/' } },
    })
    // Sem esta linha o worker considera o catálogo recente e não recataloga os repositórios apagados.
    await db.integracaoGitHub.deleteMany({})

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

  // Recataloga os repositórios de exemplo (fixtures) para que o E2E os encontre sem projeto.
  rodarWorkerUmaVez()

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
