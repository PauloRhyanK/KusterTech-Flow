import { createInterface } from 'node:readline'
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

async function lerSenhaDoTerminal(): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, terminal: false })
    return new Promise((resolve) => {
      let resolvido = false
      rl.once('line', (linha) => {
        resolvido = true
        rl.close()
        resolve(linha)
      })
      rl.once('close', () => {
        if (!resolvido) {
          resolve('')
        }
      })
    })
  }

  return new Promise((resolve, reject) => {
    process.stderr.write('Senha do administrador: ')
    const stdin = process.stdin
    const modoAnterior = stdin.isRaw
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    let senha = ''
    const aoReceberDados = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') {
          stdin.setRawMode(modoAnterior)
          stdin.pause()
          stdin.removeListener('data', aoReceberDados)
          process.stderr.write('\n')
          resolve(senha)
          return
        }
        if (char === '\u0003') {
          stdin.setRawMode(modoAnterior)
          stdin.pause()
          stdin.removeListener('data', aoReceberDados)
          process.stderr.write('\n')
          reject(new Error('Operação cancelada pelo usuário.'))
          return
        }
        if (char === '\u007f' || char === '\b') {
          senha = senha.slice(0, -1)
        } else {
          senha += char
        }
      }
    }

    stdin.on('data', aoReceberDados)
  })
}

async function executar(): Promise<void> {
  carregarEnvSeNecessario()

  const argsBrutos = process.argv.slice(2).filter((arg) => arg !== '--')
  let emailBruto: string | undefined
  let nomeBruto: string | undefined

  try {
    const { values } = parseArgs({
      args: argsBrutos,
      options: {
        email: { type: 'string' },
        nome: { type: 'string' },
      },
      strict: true,
    })
    emailBruto = values.email
    nomeBruto = values.nome
  } catch {
    console.error('Uso: pnpm criar-admin --email <email> --nome <nome>')
    process.exit(1)
  }

  if (!emailBruto?.trim() || !nomeBruto?.trim()) {
    console.error('Uso: pnpm criar-admin --email <email> --nome <nome>')
    process.exit(1)
  }

  const senha = process.env.FLOW_ADMIN_SENHA ?? (await lerSenhaDoTerminal())
  if (!senha) {
    console.error('A senha do administrador não foi informada.')
    process.exit(1)
  }

  const { db } = await import('@/lib/db')
  const { criarUsuario, normalizarEmail } = await import('@/modules/usuarios/service')

  try {
    const email = normalizarEmail(emailBruto)
    const existente = await db.usuario.findUnique({
      where: { email },
      select: { id: true },
    })

    if (existente) {
      console.error('Já existe um usuário com este e-mail.')
      process.exitCode = 1
      return
    }

    const criado = await criarUsuario({
      email,
      nome: nomeBruto.trim(),
      senha,
      papeis: [{ papel: 'ADMIN', clienteId: null }],
    })

    console.log(`Administrador criado com sucesso: ${email} (${criado.id})`)
  } catch (erro) {
    if (erro instanceof Error && erro.message.includes('Unique constraint')) {
      console.error('Já existe um usuário com este e-mail.')
    } else if (erro instanceof Error) {
      console.error(erro.message)
    } else {
      console.error('Erro ao criar administrador.')
    }
    process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

void executar()
