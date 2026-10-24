import { PrismaPg } from '@prisma/adapter-pg'
import { DriverAdapterError } from '@prisma/driver-adapter-utils'

export async function garantirBancoDeTeste(urlTeste: string): Promise<void> {
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
