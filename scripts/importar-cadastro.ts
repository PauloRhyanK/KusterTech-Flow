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
    const { AVISO_DE_IMPORTACAO_INTERROMPIDA, relatorioDaImportacao } =
      await import('@/modules/cadastro/model')
    let plano
    try {
      plano = await importarCadastro({ usuarioId: usuario.id, papeis: usuario.papeis }, lido.data, {
        simular,
      })
    } catch (erro) {
      console.error(erro instanceof Error ? erro.message : 'Erro ao importar o cadastro.')
      if (!simular) {
        console.error(AVISO_DE_IMPORTACAO_INTERROMPIDA)
      }
      process.exitCode = 1
      return
    }

    const { saida, erros } = relatorioDaImportacao(plano, simular)
    for (const linha of saida) {
      console.log(linha)
    }
    for (const linha of erros) {
      console.error(linha)
    }
    if (erros.length > 0) {
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
