import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  criarRecursoNoBanco,
  garantirMaquinaLocalNoBanco,
  nomeDeTeste,
  revogarFontesDaFabricaNoBanco,
} from './support/banco'
import { prepararPastaDaOficina } from './support/oficina'

function obterAdmin(): { email: string; senha: string } {
  const { E2E_ADMIN_EMAIL: email, E2E_ADMIN_SENHA: senha } = process.env
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

async function capturar(page: Page, projeto: string, nomeArquivo: string): Promise<void> {
  const caminho = path.join('e2e', 'capturas', projeto, nomeArquivo)
  fs.mkdirSync(path.dirname(caminho), { recursive: true })
  await page.screenshot({ path: caminho, fullPage: true })
}

const quadro = (page: Page, rotulo: string) => page.getByRole('group', { name: rotulo })
const QUADROS = ['CPU', 'Memória', 'Disco', 'Última limpeza']

let maquina: { id: string }

test.beforeAll(async () => {
  // Sem retrato da Fábrica: nenhum mínimo de memória acende aviso por acaso.
  await revogarFontesDaFabricaNoBanco()
  maquina = await garantirMaquinaLocalNoBanco()
})

test.afterEach(() => {
  prepararPastaDaOficina('vazia')
})

test('cenário completo: quatro quadros, o container que parou com erro no topo e a limpeza de hoje', async ({
  page,
}) => {
  prepararPastaDaOficina('completa')
  await entrarComoAdmin(page)
  await page.goto(`/maquinas/${maquina.id}`)

  await expect(quadro(page, 'CPU')).toContainText('62%')
  await expect(quadro(page, 'CPU')).toContainText('Carga 2,5')
  await expect(quadro(page, 'Memória')).toContainText('4,8 GB')
  await expect(quadro(page, 'Memória')).toContainText('Disponível 3,2 GB · swap 410 MB')
  await expect(quadro(page, 'Disco')).toContainText('49,0 GB')
  await expect(quadro(page, 'Disco')).toContainText('59% em uso')
  await expect(quadro(page, 'Última limpeza')).toContainText('hoje')
  await expect(quadro(page, 'Última limpeza')).toContainText('Liberou 3,2 GB · concluída')
  await expect(page.getByText(/^Leitura de há \d+ s$/)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Atenção' })).toHaveCount(0)

  const containers = page.getByRole('region', { name: 'Containers' })
  const primeira = containers.getByRole('row').nth(1)
  await expect(primeira).toContainText('runner-3-job')
  await expect(primeira).toContainText('Parou com erro')
  await expect(containers.getByRole('row').nth(2)).toContainText('fabrica-verificacao-a41c')
  await expect(containers.locator('summary')).toContainText('mais 4 containers')

  const limpezas = page.getByRole('region', { name: 'Limpeza diária' })
  await expect(limpezas.getByRole('row').nth(1)).toContainText('hoje')
  await expect(limpezas.getByRole('row').nth(1)).toContainText('Concluída')

  await expect(page.getByRole('region', { name: 'Para onde vai o disco' })).toContainText(
    'Docker (imagens e volumes)',
  )
  await expect(page.getByRole('region', { name: 'Cadastro' })).toContainText('Própria')
  await expect(page.locator('[data-tom="sucesso"]')).toHaveCount(0)
})

test('cenário vazio: "Sem dados" nos quadros e o cadastro visível', async ({ page }) => {
  prepararPastaDaOficina('vazia')
  await entrarComoAdmin(page)
  await page.goto(`/maquinas/${maquina.id}`)

  for (const rotulo of QUADROS) {
    await expect(quadro(page, rotulo)).toContainText('Sem dados')
  }
  await expect(page.getByRole('region', { name: 'Atenção' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Cadastro' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Cadastro' })).toContainText('oficina.exemplo.test')
})

test('cenário com aviso: a faixa de atenção e o item em "Espera você" que leva à máquina', async ({
  page,
}, testInfo) => {
  prepararPastaDaOficina('com-aviso')
  await entrarComoAdmin(page)

  const item = page
    .getByRole('list', { name: 'Espera você' })
    .getByRole('listitem')
    .filter({ hasText: 'Backup da noite não terminou' })
  await expect(item).toBeVisible()
  const link = item.getByRole('link', { name: /Ver a máquina/ })
  await expect(link).toHaveAttribute('href', `/maquinas/${maquina.id}`)
  await link.click()

  await expect(page).toHaveURL(new RegExp(`/maquinas/${maquina.id}$`))
  await expect(page.getByRole('region', { name: 'Atenção' })).toContainText(
    'Aviso da oficina: Backup da noite não terminou',
  )

  // Capturas para comparar com o desenho 02-maquina.html, claro e escuro.
  const projeto = testInfo.project.name
  if (projeto === 'mobile') {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true)
  }
  await capturar(page, projeto, 'maquina-local.png')
  await page.emulateMedia({ colorScheme: 'dark' })
  await capturar(page, projeto, 'maquina-local-escuro.png')
})

test('uma máquina comum não tem nenhum quadro', async ({ page }) => {
  prepararPastaDaOficina('completa')
  const comum = await criarRecursoNoBanco({
    tipo: 'SERVIDOR',
    nome: nomeDeTeste('Servidor comum'),
    provedor: 'Hetzner',
  })
  await entrarComoAdmin(page)
  await page.goto(`/maquinas/${comum.id}`)

  await expect(page.getByRole('heading', { level: 1, name: comum.nome })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Cadastro' })).toContainText('Hetzner')
  for (const rotulo of QUADROS) {
    await expect(quadro(page, rotulo)).toHaveCount(0)
  }
  await expect(page.getByRole('region', { name: 'Containers' })).toHaveCount(0)
})
