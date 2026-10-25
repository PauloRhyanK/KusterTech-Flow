import { expect, test, type Page } from '@playwright/test'
import { contarUsuarios } from './support/banco'

function obterAdmin(): { id: string; email: string; senha: string } {
  const id = process.env.E2E_ADMIN_ID
  const email = process.env.E2E_ADMIN_EMAIL
  const senha = process.env.E2E_ADMIN_SENHA
  if (!id || !email || !senha) {
    throw new Error('E2E_ADMIN_ID, E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  return { id, email, senha }
}

async function fazerLogin(page: Page, email: string, senha: string): Promise<void> {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('admin cria um testador, vê na lista com Ativo, desativa e vê Desativado', async ({
  page,
}) => {
  const { email: adminEmail, senha: adminSenha } = obterAdmin()
  await fazerLogin(page, adminEmail, adminSenha)

  await page.goto('/configuracoes/usuarios')
  await expect(page.getByRole('heading', { level: 1, name: 'Usuários' })).toBeVisible()

  const botaoSuaConta = page.getByRole('button', { name: 'Sua conta' })
  await expect(botaoSuaConta).toBeVisible()
  await expect(botaoSuaConta).toBeDisabled()
  await expect(botaoSuaConta).toHaveAttribute('aria-disabled', 'true')

  const emailTestador = `e2e+testador-${Date.now()}@local.test`
  await page.getByLabel('E-mail').fill(emailTestador)
  await page.getByLabel('Nome').fill('Testador E2E')
  await page.getByLabel('Senha').fill('senha-segura-123')
  await page.getByLabel('Papel').selectOption('TESTADOR')
  await page.getByRole('button', { name: 'Criar usuário' }).click()

  await expect(page.getByRole('status')).toHaveText('Usuário criado.')

  const linha = page.locator('li', { hasText: emailTestador })
  await expect(linha).toBeVisible()
  await expect(linha.getByText('Testador E2E')).toBeVisible()
  await expect(linha.locator('[data-tom="sucesso"]')).toHaveText('Ativo')
  await expect(linha.getByText('TESTADOR (todos os clientes)')).toBeVisible()

  const botaoDesativar = linha.getByRole('button', { name: 'Desativar' })
  await botaoDesativar.click()

  await expect(linha.locator('[data-tom="neutro"]')).toHaveText('Desativado')
  await expect(linha.getByRole('button', { name: 'Reativar' })).toBeVisible()
})

test('testador acessa /configuracoes/usuarios e vê Sem permissão, sem lista', async ({
  browser,
  page,
}) => {
  const { email: adminEmail, senha: adminSenha } = obterAdmin()
  await fazerLogin(page, adminEmail, adminSenha)

  await page.goto('/configuracoes/usuarios')

  const emailTestador = `e2e+testador-sem-perm-${Date.now()}@local.test`
  const senhaTestador = 'senha-testador-123'
  await page.getByLabel('E-mail').fill(emailTestador)
  await page.getByLabel('Nome').fill('Testador Sem Permissao')
  await page.getByLabel('Senha').fill(senhaTestador)
  await page.getByLabel('Papel').selectOption('TESTADOR')
  await page.getByRole('button', { name: 'Criar usuário' }).click()

  await expect(page.getByRole('status')).toHaveText('Usuário criado.')

  const testadorContext = await browser.newContext()
  const testadorPage = await testadorContext.newPage()

  try {
    await fazerLogin(testadorPage, emailTestador, senhaTestador)
    await testadorPage.goto('/configuracoes/usuarios')

    await expect(testadorPage.getByRole('status')).toContainText('Sem permissão')
    await expect(testadorPage.getByRole('list', { name: 'Lista de usuários' })).toHaveCount(0)
    await expect(testadorPage.getByRole('button', { name: 'Criar usuário' })).toHaveCount(0)
  } finally {
    await testadorContext.close()
  }
})

test('POST forjado da action de criar por não-admin não cria usuário', async ({
  browser,
  page,
}) => {
  const { email: adminEmail, senha: adminSenha } = obterAdmin()
  await fazerLogin(page, adminEmail, adminSenha)

  await page.goto('/configuracoes/usuarios')

  const emailTestador = `e2e+testador-forjador-${Date.now()}@local.test`
  const senhaTestador = 'senha-forjador-123'
  await page.getByLabel('E-mail').fill(emailTestador)
  await page.getByLabel('Nome').fill('Testador Forjador')
  await page.getByLabel('Senha').fill(senhaTestador)
  await page.getByLabel('Papel').selectOption('TESTADOR')
  await page.getByRole('button', { name: 'Criar usuário' }).click()
  await expect(page.getByRole('status')).toHaveText('Usuário criado.')

  const emailInvasor = `e2e+invasor-${Date.now()}@local.test`
  await page.getByLabel('E-mail').fill(emailInvasor)
  await page.getByLabel('Nome').fill('Invasor')
  await page.getByLabel('Senha').fill('senha-invasor-123')
  await page.getByLabel('Papel').selectOption('ADMIN')

  const requestPromise = page.waitForRequest(
    (req) => req.method() === 'POST' && Boolean(req.headers()['next-action']),
  )
  await page.getByRole('button', { name: 'Criar usuário' }).click()
  const requestReal = await requestPromise
  await expect(page.getByRole('status')).toHaveText('Usuário criado.')

  const url = requestReal.url()
  const headers = requestReal.headers()
  const postData = requestReal.postDataBuffer()

  const testadorContext = await browser.newContext()
  const testadorPage = await testadorContext.newPage()

  try {
    await fazerLogin(testadorPage, emailTestador, senhaTestador)

    const totalAntes = await contarUsuarios()

    await testadorContext.request.post(url, {
      headers: {
        'next-action': headers['next-action']!,
        'content-type': headers['content-type']!,
      },
      data: postData!,
    })

    const totalDepois = await contarUsuarios()
    expect(totalDepois).toBe(totalAntes)
  } finally {
    await testadorContext.close()
  }
})
