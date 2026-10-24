import { expect, test } from '@playwright/test'

function obterCredenciaisAdmin(): { email: string; senha: string } {
  const email = process.env.E2E_ADMIN_EMAIL
  const senha = process.env.E2E_ADMIN_SENHA
  if (!email || !senha) {
    throw new Error('Credenciais E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  return { email, senha }
}

test('sem sessão, / redireciona para /entrar', async ({ page }) => {
  const resposta = await page.goto('/')
  expect(resposta?.status()).toBe(200)
  await expect(page).toHaveURL(/\/entrar$/)
})

test('senha errada mostra mensagem genérica e mantém o e-mail', async ({ page }) => {
  const { email } = obterCredenciaisAdmin()

  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill('senha-errada-12345')
  await page.getByRole('button', { name: 'Entrar' }).click()

  const alerta = page.locator('form').getByRole('alert')
  await expect(alerta).toBeVisible()
  await expect(alerta).toContainText('E-mail ou senha incorretos.')
  await expect(alerta).toBeFocused()
  await expect(page.getByLabel('E-mail')).toHaveValue(email)
})

test('login correto leva a / com o nome do admin; sair volta para /entrar', async ({ page }) => {
  const { email, senha } = obterCredenciaisAdmin()

  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Olá, Admin E2E' })).toBeVisible()
  await expect(page.getByText('Nenhum módulo configurado ainda.')).toBeVisible()

  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page).toHaveURL(/\/entrar$/)
})

test('cookie de sessão inválido não quebra: redireciona para /entrar', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    {
      name: 'flow_sessao',
      value: 'invalido',
      url: baseURL ?? 'http://127.0.0.1:3131',
    },
  ])

  const resposta = await page.goto('/')
  expect(resposta?.status()).toBe(200)
  await expect(page).toHaveURL(/\/entrar$/)
})

test('autenticado, /entrar redireciona para /', async ({ page }) => {
  const { email, senha } = obterCredenciaisAdmin()

  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.goto('/entrar')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Olá, Admin E2E' })).toBeVisible()
})

test('após sair, voltar a / redireciona para /entrar', async ({ page }) => {
  const { email, senha } = obterCredenciaisAdmin()

  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page).toHaveURL(/\/entrar$/)

  await page.goto('/')
  await expect(page).toHaveURL(/\/entrar$/)
})

test('POST /sair sem cookie redireciona para /entrar sem erro 500', async ({ request }) => {
  const resposta = await request.post('/sair', { maxRedirects: 0 })
  expect(resposta.status()).toBeGreaterThanOrEqual(300)
  expect(resposta.status()).toBeLessThan(400)
  expect(resposta.headers()['location']).toMatch(/\/entrar$/)
})
