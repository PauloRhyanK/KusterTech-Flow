import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

function carregarEnvSeNecessario(): void {
  if (!process.env.DATABASE_URL && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile()
    } catch {
      // Ignora se .env não existir (ex.: dentro do container)
    }
  }
}

const USO = 'Uso: pnpm importar-cadastro <arquivo.json> [--simular] --email <admin>'

const ROTULOS: Record<string, string> = {
  'criar-cliente': 'Clientes a criar',
  'atualizar-cliente': 'Clientes a atualizar',
  'criar-projeto': 'Projetos a criar',
  'atualizar-projeto': 'Projetos a atualizar',
  'associar-cliente': 'Clientes a associar a projetos',
  'vincular-repositorio': 'Repositórios a vincular',
  'criar-maquina': 'Máquinas a criar',
  'atualizar-maquina': 'Máquinas a atualizar',
  'associar-maquina': 'Máquinas a associar a projetos',
}

async function executar(): Promise<void> {
  carregarEnvSeNecessario()

  const argsBrutos = process.argv.slice(2).filter((arg) => arg !== '--')
  let caminho: string | undefined
  let email: string | undefined
  let simular = false
  try {
    const { values, positionals } = parseArgs({
      args: argsBrutos,
      options: { email: { type: 'string' }, simular: { type: 'boolean' } },
      allowPositionals: true,
      strict: true,
    })
    caminho = positionals[0]
    email = values.email
    simular = values.simular ?? false
  } catch {
    console.error(USO)
    process.exit(1)
  }
  if (!caminho || !email?.trim()) {
    console.error(USO)
    process.exit(1)
  }

  const { db } = await import('@/lib/db')

  try {
    let bruto: unknown
    try {
      bruto = JSON.parse(readFileSync(caminho, 'utf8'))
    } catch {
      console.error(`Não foi possível ler um JSON válido em ${caminho}.`)
      process.exitCode = 1
      return
    }

    const { arquivoDeCadastroSchema } = await import('@/modules/cadastro/model')
    const lido = arquivoDeCadastroSchema.safeParse(bruto)
    if (!lido.success) {
      console.error('Arquivo de cadastro inválido:')
      for (const problema of lido.error.issues) {
        console.error(`  - ${problema.path.join('.') || '(raiz)'}: ${problema.message}`)
      }
      process.exitCode = 1
      return
    }

    const { normalizarEmail } = await import('@/modules/usuarios/service')
    const usuario = await db.usuario.findUnique({
      where: { email: normalizarEmail(email) },
      select: { id: true, papeis: { select: { papel: true, clienteId: true } } },
    })
    const ehAdminGlobal = usuario?.papeis.some((p) => p.papel === 'ADMIN' && p.clienteId === null)
    if (!usuario || !ehAdminGlobal) {
      console.error('O e-mail informado não é de um administrador.')
      process.exitCode = 1
      return
    }

    const { importarCadastro } = await import('@/modules/cadastro/service')
    const plano = await importarCadastro(
      { usuarioId: usuario.id, papeis: usuario.papeis },
      lido.data,
      { simular },
    )

    console.log(simular ? 'Simulação (nada foi gravado):' : 'Importação:')
    for (const [tipo, rotulo] of Object.entries(ROTULOS)) {
      const total = plano.acoes.filter((a) => a.tipo === tipo).length
      if (total > 0) {
        console.log(`  ${rotulo}: ${total}`)
      }
    }
    if (plano.repositoriosPendentes.length > 0) {
      console.log('Ainda não visíveis para a GitHub App:')
      for (const repositorio of plano.repositoriosPendentes) {
        console.log(`  - ${repositorio}`)
      }
    }
    if (plano.erros.length > 0) {
      console.error('Erros (nada foi gravado):')
      for (const erro of plano.erros) {
        console.error(`  - ${erro}`)
      }
      process.exitCode = 1
    }
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : 'Erro ao importar o cadastro.')
    process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

void executar()
