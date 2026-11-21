import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  arquivarProjetosComRepositorioNoBanco,
  criarClienteNoBanco,
  criarProjetoNoBanco,
  criarUsuarioNoBanco,
  limparAtividadeNoBanco,
  nomeDeTeste,
  semearAtividadeNoBanco,
} from './support/banco'

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
  const caminho = path.join(
    'docs',
    'superpowers',
    'specs',
    'desenhos',
    '2026-11-20-atividade',
    'capturas',
    projeto,
    nomeArquivo,
  )
  fs.mkdirSync(path.dirname(caminho), { recursive: true })
  await page.screenshot({ path: caminho, fullPage: true })
}

async function semRolagemHorizontal(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
}

const titulo = (page: Page, nome: string) => page.getByRole('heading', { level: 2, name: nome })

test.beforeEach(async () => {
  await limparAtividadeNoBanco()
  await arquivarProjetosComRepositorioNoBanco()
})

test.afterAll(async () => {
  await limparAtividadeNoBanco()
  await arquivarProjetosComRepositorioNoBanco()
})

test('sem atividade: título Atividade com aviso entre "Espera você" e "Fábrica agora"', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await entrarComo(page, email, senha)

  await expect(titulo(page, 'Atividade')).toBeVisible()
  await expect(page.getByText('Nenhuma atividade nas últimas 24 horas.')).toBeVisible()
  const ordem = await page
    .getByRole('heading', { level: 2 })
    .evaluateAll((hs) => hs.map((h) => h.textContent?.trim()))
  const i = ordem.indexOf('Atividade')
  expect(ordem[i - 1]).toBe('Espera você')
  expect(ordem[i + 1]).toBe('Fábrica agora')
  if (testInfo.project.name === 'mobile') {
    expect(await semRolagemHorizontal(page)).toBe(true)
  }
  await capturar(page, testInfo.project.name, 'inicio-sem-atividade.png')
})

test('com atividade em dois repositórios: linha com 4 mergeados e 2 abertos', async ({
  page,
}, testInfo) => {
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Atividade Início'))
  await semearAtividadeNoBanco(projeto.id, testInfo.project.name, new Date())
  const { email, senha } = obterAdmin()
  await entrarComo(page, email, senha)

  await expect(page.getByText('4 PRs mergeados nas últimas 24 h')).toBeVisible()
  const linha = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: projeto.nome }) })
  await expect(linha.getByText('4', { exact: true })).toBeVisible()
  await expect(linha.getByText('mergeados hoje')).toBeVisible()
  await expect(linha.getByText('2', { exact: true })).toBeVisible()
  await expect(linha.getByText('abertos')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Legenda da origem' })).toBeVisible()
  expect(await semRolagemHorizontal(page)).toBe(true)
  await capturar(page, testInfo.project.name, 'inicio-atividade.png')
})

test('aba Desenvolvimento: quadros 4 e 2, merges (inclui o de 30 h, fora da janela) em ordem e links externos', async ({
  page,
}, testInfo) => {
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Atividade Aba'))
  await semearAtividadeNoBanco(projeto.id, testInfo.project.name, new Date())
  const { email, senha } = obterAdmin()
  await entrarComo(page, email, senha)

  await page.goto(`/projetos/${projeto.id}/desenvolvimento`)
  const secao = page.getByRole('region', { name: 'Atividade do projeto' })
  await expect(secao.getByText('Mergeados hoje')).toBeVisible()
  await expect(secao.getByText('4', { exact: true })).toBeVisible()
  await expect(secao.getByText('2', { exact: true })).toBeVisible()
  await expect(secao.getByRole('list', { name: 'Legenda da origem' })).toBeVisible()

  const itens = secao.getByRole('list', { name: 'Últimos merges' }).getByRole('listitem')
  await expect(itens).toHaveCount(5)
  const titulos = [
    'Corrige PDF cortado',
    'Ajusta o cadastro',
    'Melhora a busca',
    'Nova tela de relatórios',
    'Entrega antiga',
  ]
  for (const [i, t] of titulos.entries()) {
    await expect(itens.nth(i)).toContainText(t)
    await expect(itens.nth(i).getByRole('link')).toHaveAttribute('target', '_blank')
  }
  if (testInfo.project.name === 'mobile') {
    expect(await semRolagemHorizontal(page)).toBe(true)
  }
  await capturar(page, testInfo.project.name, 'projeto-desenvolvimento.png')
})

test('TESTADOR escopado por cliente não vê o título Atividade no Início', async ({ page }) => {
  const cliente = await criarClienteNoBanco(nomeDeTeste('Cliente Atividade'))
  const testador = {
    email: `${nomeDeTeste('testador-atividade').replace(/\W+/g, '-').toLowerCase()}@local.test`,
    senha: 'senha-super-segura-123',
  }
  await criarUsuarioNoBanco({
    ...testador,
    nome: 'Testador da Atividade',
    papel: 'TESTADOR',
    clienteId: cliente.id,
  })
  await entrarComo(page, testador.email, testador.senha)

  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible()
  await expect(titulo(page, 'Atividade')).toHaveCount(0)
})
