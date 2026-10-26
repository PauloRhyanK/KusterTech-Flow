import { execFileSync } from 'node:child_process'

export function rodarWorkerUmaVez(): void {
  const urlTeste = process.env.DATABASE_URL_TEST?.trim()
  if (!urlTeste) {
    throw new Error('DATABASE_URL_TEST é obrigatória para rodar o worker nos testes E2E.')
  }

  execFileSync('pnpm', ['worker:uma-vez'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      GITHUB_FONTE: 'fixtures',
      DATABASE_URL: urlTeste,
    },
  })
}
