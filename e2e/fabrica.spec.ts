import { expect, test, type Page } from '@playwright/test'
import { nomeDeTeste, revogarFontesDaFabricaNoBanco } from './support/banco'
import { enviarRetratoDaFabrica, retratoDeTeste } from './support/fabrica'

function obterAdmin(): { email: string; senha: string } {
  const email = process.env.E2E_ADMIN_EMAIL
  const senha = process.env.E2E_ADMIN_SENHA
  if (!email || !senha) {
    throw new Error('E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  return { email, senha }
}

async function criarFonte(page: Page, nome: string): Promise<string> {
  await page.goto('/configuracoes/fabrica')
  await page.getByLabel('Nome').fill(nome)
  await page.getByRole('button', { name: 'Criar token' }).click()
  await expect(page.getByText('Token criado.')).toBeVisible()
  return (await page.locator('code').first().textContent())?.trim() ?? ''
}

async function revogarFonte(page: Page, nome: string): Promise<void> {
  await page.goto('/configuracoes/fabrica')
  const linha = page.getByRole('listitem').filter({ hasText: nome })
  await linha.getByRole('button', { name: 'Revogar' }).click()
  await linha.getByRole('button', { name: 'Confirmar revogação' }).click()
  await expect(page.getByText('Token revogado.')).toBeVisible()
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

  await page.goto('/fabrica')
  await expect(page.getByRole('heading', { level: 1, name: 'Fábrica', exact: true })).toBeVisible()
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

test('a aba Avisos mostra os avisos do retrato e o contador', async ({ page, request }) => {
  await entrarComoAdmin(page)
  const nomeDaFonte = nomeDeTeste('Fonte dos avisos')
  const token = await criarFonte(page, nomeDaFonte)
  const mensagem = nomeDeTeste('Vaga reduzida por falta de memória')
  const retrato = {
    ...retratoDeTeste(nomeDeTeste('Plano dos avisos')),
    avisos: [{ em: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), mensagem }],
  }
  expect((await enviarRetratoDaFabrica(request, token, retrato)).status).toBe(200)

  await page.goto('/fabrica')
  const abas = page.getByRole('navigation', { name: 'Seções da Fábrica' })
  await expect(abas.getByRole('link', { name: 'Avisos' })).toContainText('1')
  await abas.getByRole('link', { name: 'Avisos' }).click()
  await expect(page).toHaveURL(/\/fabrica\/avisos$/)
  await expect(page.getByText(mensagem)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Planos na fila' })).toHaveCount(0)

  await revogarFonte(page, nomeDaFonte)
})

test('sem retrato, /fabrica e /fabrica/avisos mostram que a Fábrica ainda não enviou o estado', async ({
  page,
}) => {
  await revogarFontesDaFabricaNoBanco()
  await entrarComoAdmin(page)

  for (const rota of ['/fabrica', '/fabrica/avisos']) {
    await page.goto(rota)
    await expect(page.getByText('A Fábrica ainda não enviou o estado.')).toBeVisible()
  }
})
