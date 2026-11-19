import { expect, test, type Page } from '@playwright/test'
import { contarEvidenciasDeDeploy, criarProjetoNoBanco, nomeDeTeste } from './support/banco'

function obterAdmin(): { email: string; senha: string } {
  const { E2E_ADMIN_EMAIL: email, E2E_ADMIN_SENHA: senha } = process.env
  if (!email || !senha) {
    throw new Error('E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  return { email, senha }
}

async function entrar(page: Page): Promise<void> {
  const { email, senha } = obterAdmin()
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)
}

let projetoId = ''

test.beforeAll(async () => {
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Módulos congelados'))
  projetoId = projeto.id
})

for (const rota of ['entregas', 'homologacao', 'publicacoes', 'versoes']) {
  // O loading.tsx de (app) faz o Next enviar o status 200 antes do notFound(); a prova é a tela de "não encontrado".
  test(`/projetos/<p>/${rota} mostra "Registro não encontrado"`, async ({ page }) => {
    await entrar(page)
    await page.goto(`/projetos/${projetoId}/${rota}`)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Registro não encontrado' }),
    ).toBeVisible()
  })
}

test('POST /api/evidencias/deploy responde 404 e não grava evidência', async ({ request }) => {
  const antes = await contarEvidenciasDeDeploy()
  const r = await request.post('/api/evidencias/deploy', {
    headers: { authorization: 'Bearer fle_x' },
    data: {},
  })
  expect(r.status()).toBe(404)
  expect(r.headers()['content-type']).toMatch(/^application\/json/)
  expect(await r.json()).toEqual({ erro: 'Não encontrado.' })
  expect(await contarEvidenciasDeDeploy()).toBe(antes)
})

test('POST /api/evidencias/verificacao responde 404 igual a uma rota de API inexistente', async ({
  request,
}) => {
  const r = await request.post('/api/evidencias/verificacao', { data: {} })
  const inexistente = await request.post('/api/rota-que-nao-existe', { data: {} })
  expect(r.status()).toBe(404)
  expect(inexistente.status()).toBe(404)
  expect(r.headers()['content-type']).toBe(inexistente.headers()['content-type'])
  expect(await r.json()).toEqual({ erro: 'Não encontrado.' })
  expect(await inexistente.json()).toEqual({ erro: 'Não encontrado.' })
})

test('o projeto mostra só as abas Resumo, Desenvolvimento e Máquinas', async ({ page }) => {
  await entrar(page)
  await page.goto(`/projetos/${projetoId}`)
  const abas = page.getByRole('navigation', { name: 'Seções do projeto' })
  await expect(abas.getByRole('link')).toHaveText(['Resumo', 'Desenvolvimento', 'Máquinas'])
})

test('/desenvolvimento mostra "Registro não encontrado"', async ({ page }) => {
  await entrar(page)
  await page.goto('/desenvolvimento')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Registro não encontrado' }),
  ).toBeVisible()
})
