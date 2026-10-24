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

test.afterEach(async () => {
  await definirTemaNoBanco(obterAdmin().id, 'sistema')
})

test('sem sessão, HTML inicial tem data-tema="sistema" e o script de tema', async ({ request }) => {
  const html = await (await request.get('/entrar')).text()
  expect(html).toContain('data-tema="sistema"')
  expect(html).toContain('prefers-color-scheme')
})

test('com preferência escuro no banco, o HTML inicial já vem com class="dark" (sem flash)', async ({
  page,
}) => {
  const { id, email, senha } = obterAdmin()
  await definirTemaNoBanco(id, 'escuro')

  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)

  const html = await (await page.request.get('/')).text()
  expect(html).toMatch(/<html[^>]*class="dark"/)
  expect(html).toContain('data-tema="escuro"')
})

test('tema sistema segue prefers-color-scheme e muda sem recarregar', async ({ browser }) => {
  const contexto = await browser.newContext({ colorScheme: 'dark' })
  try {
    const page = await contexto.newPage()
    await page.goto('/entrar')
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).not.toHaveClass(/dark/)

    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveClass(/dark/)
  } finally {
    await contexto.close()
  }
})

test('com reduced-motion, body não declara transição', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/entrar')
  expect(await page.evaluate(() => getComputedStyle(document.body).transitionDuration)).toMatch(
    /^0s/,
  )
})
