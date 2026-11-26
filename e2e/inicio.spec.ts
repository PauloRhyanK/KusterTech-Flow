import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  arquivarProjetosComRepositorioNoBanco,
  criarClienteNoBanco,
  criarUsuarioNoBanco,
  nomeDeTeste,
  revogarFontesDaFabricaNoBanco,
} from './support/banco'
import { enviarRetratoDaFabrica, retratoDeTeste } from './support/fabrica'

function obterAdmin(): { email: string; senha: string } {
  const { E2E_ADMIN_EMAIL: email, E2E_ADMIN_SENHA: senha } = process.env
  if (!email || !senha) {
    throw new Error('E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  return { email, senha }
}

async function entrarComo(page: Page, email: string, senha: string): Promise<void> {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function capturar(page: Page, projeto: string, nomeArquivo: string): Promise<void> {
  const caminho = path.join('e2e', 'capturas', projeto, nomeArquivo)
  fs.mkdirSync(path.dirname(caminho), { recursive: true })
  await page.screenshot({ path: caminho, fullPage: true })
}

async function semRolagemHorizontal(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
}

async function criarToken(page: Page): Promise<string> {
  await page.goto('/configuracoes/fabrica')
  await page.getByLabel('Nome').fill(nomeDeTeste('Máquina do Início'))
  await page.getByRole('button', { name: 'Criar token' }).click()
  await expect(page.getByText('Token criado.')).toBeVisible()
  return (await page.locator('code').first().textContent())?.trim() ?? ''
}

const titulo = (page: Page, nome: string) => page.getByRole('heading', { level: 2, name: nome })

test.beforeEach(async () => {
  await revogarFontesDaFabricaNoBanco()
  await arquivarProjetosComRepositorioNoBanco()
})

test.afterAll(async () => {
  await revogarFontesDaFabricaNoBanco()
})

test('admin sem retrato vê "A Fábrica ainda não enviou dados." e "Nada espera você…"', async ({
  page,
}) => {
  const { email, senha } = obterAdmin()
  await entrarComo(page, email, senha)

  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible()
  await expect(titulo(page, 'Espera você')).toBeVisible()
  await expect(page.getByText('Nada espera você nas fontes disponíveis.')).toBeVisible()
  await expect(titulo(page, 'Fábrica agora')).toBeVisible()
  await expect(page.getByText('A Fábrica ainda não enviou dados.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Configurar o envio' })).toHaveAttribute(
    'href',
    '/configuracoes/fabrica',
  )
  await expect(titulo(page, 'Cadastro')).toBeVisible()
  await expect(page.locator('[data-tom="sucesso"]')).toHaveCount(0)
})

test('com um retrato com plano ativo e decisão, o admin vê a decisão resumida no Decidir e a linha do plano', async ({
  page,
  request,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await entrarComo(page, email, senha)
  const token = await criarToken(page)
  const feature = nomeDeTeste('Painel do Início')
  const envio = await enviarRetratoDaFabrica(request, token, retratoDeTeste(feature))
  expect(envio.status).toBe(200)

  await page.goto('/')
  const espera = page.getByRole('list', { name: 'Espera você' })
  // Com o Decidir ativo, a decisão da Fábrica entra na pilha: o Início mostra o resumo dela.
  await expect(
    espera.getByRole('listitem').filter({ hasText: 'Homologar o painel da Fábrica' }),
  ).toHaveCount(0)
  const decidir = espera.getByRole('listitem').filter({ hasText: /esperam? sua resposta/ })
  await expect(decidir).toContainText(
    'Decisões da Fábrica, pedidos das demandas e avisos da publicação',
  )
  await expect(decidir.getByRole('link', { name: /Abrir Decidir/ })).toHaveAttribute(
    'href',
    '/decidir',
  )

  const plano = page
    .getByRole('list', { name: 'Planos em curso' })
    .getByRole('listitem')
    .filter({ hasText: feature })
  await expect(plano).toContainText('Fase 1 de 1 · 0 de 1 raias concluídas · 1 executando')
  await expect(plano.getByRole('img')).toHaveAttribute(
    'aria-label',
    '0 de 1 raias concluídas, 1 executando, 0 falharam',
  )
  await expect(plano).toContainText('Aguarda decisão')
  await expect(page.getByText('Vagas: 1 de 2 ocupadas · memória disponível 5,0 GB')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Abrir a Fábrica' })).toHaveAttribute(
    'href',
    '/fabrica',
  )
  await expect(page.locator('[data-tom="sucesso"]')).toHaveCount(0)

  const projeto = testInfo.project.name
  if (projeto === 'mobile') {
    expect(await semRolagemHorizontal(page)).toBe(true)
  }
  await capturar(page, projeto, 'inicio-admin.png')
  await page.emulateMedia({ colorScheme: 'dark' })
  await capturar(page, projeto, 'inicio-admin-escuro.png')
})

test('testador de cliente não vê "Fábrica agora" nem o quadro das máquinas, e vê "Seus projetos"', async ({
  page,
  request,
}, testInfo) => {
  const admin = obterAdmin()
  await entrarComo(page, admin.email, admin.senha)
  const token = await criarToken(page)
  expect(
    (await enviarRetratoDaFabrica(request, token, retratoDeTeste(nomeDeTeste('Oculto')))).status,
  ).toBe(200)
  await page.context().clearCookies()

  const cliente = await criarClienteNoBanco(nomeDeTeste('Cliente do Início'))
  const testador = {
    email: `e2e+testador-inicio-${Date.now()}@local.test`,
    senha: 'senha-super-segura-123',
  }
  await criarUsuarioNoBanco({
    ...testador,
    nome: 'Testador do Início',
    papel: 'TESTADOR',
    clienteId: cliente.id,
  })
  await entrarComo(page, testador.email, testador.senha)

  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible()
  await expect(titulo(page, 'Espera você')).toBeVisible()
  await expect(titulo(page, 'Seus projetos')).toBeVisible()
  await expect(titulo(page, 'Fábrica agora')).toHaveCount(0)
  await expect(titulo(page, 'Máquinas')).toHaveCount(0)
  await expect(titulo(page, 'Cadastro')).toHaveCount(0)
  await expect(page.getByText('Homologar o painel da Fábrica')).toHaveCount(0)

  const projeto = testInfo.project.name
  if (projeto === 'mobile') {
    expect(await semRolagemHorizontal(page)).toBe(true)
  }
  await capturar(page, projeto, 'inicio-testador.png')
})
