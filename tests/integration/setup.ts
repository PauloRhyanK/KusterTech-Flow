import { execFileSync } from 'node:child_process'
import { garantirBancoDeTeste } from '../support/banco-de-teste-compartilhado'

function obterUrlBancoTeste(): string {
  const urlTeste = process.env.DATABASE_URL_TEST?.trim()
  if (!urlTeste) {
    throw new Error('DATABASE_URL_TEST é obrigatória para executar os testes de integração.')
  }
  return urlTeste
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
