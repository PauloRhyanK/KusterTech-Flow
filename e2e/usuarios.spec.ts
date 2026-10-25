import { expect, test, type Page } from '@playwright/test'
import { contarUsuarios, existeUsuarioPorEmail } from './support/banco'

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

  await expect(page.getByRole('status').filter({ hasText: 'Usuário criado.' })).toBeVisible()

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

  await expect(page.getByRole('status').filter({ hasText: 'Usuário criado.' })).toBeVisible()

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
  await expect(page.getByRole('status').filter({ hasText: 'Usuário criado.' })).toBeVisible()

  const emailInvasor = `e2e+invasor-${Date.now()}@local.test`
  await page.getByLabel('E-mail').fill(emailInvasor)
  await page.getByLabel('Nome').fill('Invasor')
  await page.getByLabel('Senha').fill('senha-invasor-123')
  await page.getByLabel('Papel').selectOption('ADMIN')

  let capturada: { url: string; headers: Record<string, string>; body: Buffer } | null = null

  await page.route('**/configuracoes/usuarios', async (rota) => {
    const req = rota.request()
    if (req.method() === 'POST' && req.headers()['next-action']) {
      capturada = {
        url: req.url(),
        headers: req.headers(),
        body: req.postDataBuffer()!,
      }
      return rota.abort()
    }
    return rota.continue()
  })

  await page.getByRole('button', { name: 'Criar usuário' }).click()
  await expect.poll(() => capturada !== null).toBe(true)
  await page.unroute('**/configuracoes/usuarios')

  expect(await existeUsuarioPorEmail(emailInvasor)).toBe(false)

  // Controle positivo: replay com o request do próprio contexto do admin
  const totalAntesPositivo = await contarUsuarios()
  const respPositiva = await page.request.post(capturada!.url, {
    headers: {
      'next-action': capturada!.headers['next-action']!,
      'content-type': capturada!.headers['content-type']!,
    },
    data: capturada!.body,
  })
  expect(respPositiva.ok()).toBe(true)

  const totalAposPositivo = await contarUsuarios()
  expect(totalAposPositivo).toBe(totalAntesPositivo + 1)
  expect(await existeUsuarioPorEmail(emailInvasor)).toBe(true)

  // Controle negativo: replay com e-mail alterado no contexto do testador
  const emailInvasor2 = `e2e+invasor2-${Date.now()}@local.test`
  const bodyReplay = Buffer.from(
    capturada!.body.toString('latin1').replace(emailInvasor, emailInvasor2),
    'latin1',
  )

  const testadorContext = await browser.newContext()
  const testadorPage = await testadorContext.newPage()

  try {
    await fazerLogin(testadorPage, emailTestador, senhaTestador)

    const totalAntesNegativo = await contarUsuarios()

    const respNegativa = await testadorContext.request.post(capturada!.url, {
      headers: {
        'next-action': capturada!.headers['next-action']!,
        'content-type': capturada!.headers['content-type']!,
      },
      data: bodyReplay,
    })

    const totalAposNegativo = await contarUsuarios()
    expect(totalAposNegativo).toBe(totalAntesNegativo)
    expect(await existeUsuarioPorEmail(emailInvasor2)).toBe(false)

    const textoResp = await respNegativa.text()
    expect(textoResp).not.toContain('Usuário criado.')
  } finally {
    await testadorContext.close()
  }
})
