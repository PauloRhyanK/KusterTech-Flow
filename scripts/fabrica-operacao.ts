// Operação da Fábrica 2.0 pela linha de comando (enquanto não há tela): workers e planos aprovados.
//   worker-criar <nome> --email <admin>        mostra o token uma única vez (guarde num arquivo 0600)
//   worker-revogar <nome> --email <admin>
//   plano <arquivo.json> --email <admin>       { demandaId, conteudo, etapas[] } já aprovado pelo dono
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const USO =
  'Uso: fabrica-operacao worker-criar <nome> | worker-revogar <nome> | plano <arquivo.json> --email <admin>'

async function principal(): Promise<void> {
  if (!process.env.DATABASE_URL && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile()
    } catch {
      // dentro do contêiner o ambiente já vem pronto
    }
  }
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { email: { type: 'string' } },
  })
  const [comando, argumento] = positionals
  if (!comando || !argumento || !values.email?.trim()) {
    console.error(USO)
    process.exitCode = 1
    return
  }

  const { db } = await import('@/lib/db')
  try {
    const { normalizarEmail } = await import('@/modules/usuarios/service')
    const usuario = await db.usuario.findUnique({
      where: { email: normalizarEmail(values.email) },
      select: { id: true, papeis: { select: { papel: true, clienteId: true } } },
    })
    if (!usuario?.papeis.some((p) => p.papel === 'ADMIN' && p.clienteId === null)) {
      console.error('O e-mail informado não é de um administrador.')
      process.exitCode = 1
      return
    }
    const sujeito = { usuarioId: usuario.id, papeis: usuario.papeis }
    const servico = await import('@/modules/fabrica-operacao/service')

    if (comando === 'worker-criar') {
      const { token } = await servico.criarWorker(sujeito, argumento)
      // só o token vai para a saída padrão, para poder redirecionar direto para o arquivo
      process.stdout.write(`${token}\n`)
      console.error(`Worker "${argumento}" criado. O token não será mostrado de novo.`)
    } else if (comando === 'worker-revogar') {
      const w = await db.workerDaFabrica.findUnique({
        where: { nome: argumento },
        select: { id: true },
      })
      if (!w) throw new Error(`Worker "${argumento}" não existe.`)
      await servico.revogarWorker(sujeito, w.id)
      console.error(`Worker "${argumento}" revogado.`)
    } else if (comando === 'plano') {
      const dados = JSON.parse(readFileSync(argumento, 'utf8'))
      const { revisaoId } = await servico.registrarPlanoAprovado(sujeito, dados)
      console.error(`Plano registrado: revisão ${revisaoId}.`)
    } else {
      console.error(USO)
      process.exitCode = 1
    }
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : 'Falha na operação.')
    process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

await principal()
