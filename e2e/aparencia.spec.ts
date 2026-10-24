import { expect, test } from '@playwright/test'
import { definirTemaNoBanco } from './support/banco'

function obterAdmin(): { id: string; email: string; senha: string } {
  const id = process.env.E2E_ADMIN_ID
  const email = process.env.E2E_ADMIN_EMAIL
  const senha = process.env.E2E_ADMIN_SENHA
  if (!id || !email || !senha) {
    throw new Error('E2E_ADMIN_ID, E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  return { id, email, senha }
}

test.beforeEach(async ({ page }) => {
  const { email, senha } = obterAdmin()
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test.afterEach(async () => {
  const { id } = obterAdmin()
  await definirTemaNoBanco(id, 'sistema')
})

test('escolher Escuro aplica sem recarregar, persiste após reload e o HTML inicial vem com class="dark"', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/configuracoes/aparencia')

  await expect(page.locator('html')).not.toHaveClass(/dark/)

  await page.getByLabel('Escuro').check()

  await page.evaluate(() => {
    ;(window as Window & { __e2eMarca?: boolean }).__e2eMarca = true
  })

  await page.getByRole('button', { name: 'Salvar' }).click()

  await expect(page.getByRole('status')).toHaveText('Preferência salva.')
  expect(await page.evaluate(() => (window as Window & { __e2eMarca?: boolean }).__e2eMarca)).toBe(
    true,
  )

  await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByLabel('Escuro')).toBeChecked()

  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByLabel('Escuro')).toBeChecked()

  const html = await (await page.request.get('/configuracoes/aparencia')).text()
  expect(html).toMatch(/<html[^>]*class="dark"/)
  expect(html).toContain('data-tema="escuro"')
})

test('voltar para Sistema remove a classe quando o sistema está claro', async ({ page }) => {
  const { id } = obterAdmin()
  await definirTemaNoBanco(id, 'escuro')

  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/configuracoes/aparencia')

  await expect(page.locator('html')).toHaveClass(/dark/)

  await page.getByLabel('Sistema (padrão)').check()
  await page.getByRole('button', { name: 'Salvar' }).click()

  await expect(page.getByRole('status')).toHaveText('Preferência salva.')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(page.getByLabel('Sistema (padrão)')).toBeChecked()

  await page.reload()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(page.getByLabel('Sistema (padrão)')).toBeChecked()
})

test('atalho Aparência no menu do usuário leva à página', async ({ page }) => {
  await page.goto('/')

  const gatilho = page.getByRole('button', { name: /Menu do usuário/ })
  await gatilho.click()

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()

  const itemAparencia = page.getByRole('menuitem', { name: 'Aparência' })
  await expect(itemAparencia).toBeVisible()
  await itemAparencia.click()

  await expect(page).toHaveURL(/\/configuracoes\/aparencia$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aparência')
})
