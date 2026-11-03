import { expect, test, type Page } from '@playwright/test'
import { nomeDeTeste } from './support/banco'
import { enviarRetratoDaFabrica, retratoDeTeste } from './support/fabrica'

function obterAdmin(): { email: string; senha: string } {
  const email = process.env.E2E_ADMIN_EMAIL
  const senha = process.env.E2E_ADMIN_SENHA
  if (!email || !senha) {
    throw new Error('E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  return { email, senha }
}

async function entrarComoAdmin(page: Page): Promise<void> {
  const { email, senha } = obterAdmin()
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('admin cria token em Configurações, a máquina envia um retrato e a Central mostra o estado; revogado, o token responde 401', async ({
  page,
  request,
}) => {
  await entrarComoAdmin(page)

  await page.goto('/configuracoes/fabrica')
  await expect(page.getByRole('heading', { level: 1, name: 'Fábrica de agentes' })).toBeVisible()
  const nomeDaFonte = nomeDeTeste('Máquina de agentes')
  await page.getByLabel('Nome').fill(nomeDaFonte)
  await page.getByRole('button', { name: 'Criar token' }).click()
  await expect(page.getByText('Token criado.')).toBeVisible()
  const token = (await page.locator('code').first().textContent())?.trim() ?? ''
  expect(token).toMatch(/^ff_/)

  const feature = nomeDeTeste('Painel da Fábrica')
  const envio = await enviarRetratoDaFabrica(request, token, retratoDeTeste(feature))
  expect(envio.status).toBe(200)

  await page.goto('/desenvolvimento')
  await page.getByRole('link', { name: 'Fábrica de agentes', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Fábrica de agentes' })).toBeVisible()
  await expect(page.getByText(feature)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Vagas e memória' })).toContainText('5120 MB')
  await expect(page.getByText(/Dados recebidos em/)).toBeVisible()
  await expect(page.getByText(/A máquina parou de enviar/)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Homologar o painel da Fábrica' })).toHaveAttribute(
    'href',
    'https://github.com/kustertech-exemplo/automacao/issues/7',
  )

  await page.goto('/configuracoes/fabrica')
  const linha = page.getByRole('listitem').filter({ hasText: nomeDaFonte })
  await linha.getByRole('button', { name: 'Revogar' }).click()
  await linha.getByRole('button', { name: 'Confirmar revogação' }).click()
  await expect(page.getByText('Token revogado.')).toBeVisible()

  const depois = await enviarRetratoDaFabrica(request, token, retratoDeTeste(feature))
  expect(depois.status).toBe(401)
})
