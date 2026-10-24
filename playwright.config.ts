import { defineConfig, devices } from '@playwright/test'

if (!process.env.DATABASE_URL_TEST && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile()
  } catch {
    // Ignora se .env não existir
  }
}

const porta = Number(process.env.E2E_PORT ?? '3131')
const baseURL = `http://127.0.0.1:${porta}`
const urlBancoTeste = process.env.DATABASE_URL_TEST ?? ''

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/support/global-setup.ts',
  use: {
    baseURL,
    actionTimeout: 5_000,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
      },
    },
  ],
  // Nota: no Playwright, o webServer sobe antes do globalSetup; a rota inicial sem cookie
  // apenas redireciona para /entrar sem consultar o banco antes de o globalSetup aplicar as migrations.
  webServer: {
    command: `pnpm start -p ${porta}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...process.env,
      DATABASE_URL: urlBancoTeste,
    },
  },
})
