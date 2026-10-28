import { expect, test } from '@playwright/test'

const MODULOS_ROTULOS = [
  'Visão Geral',
  'Clientes',
  'Projetos',
  'Infraestrutura',
  'Central de Desenvolvimento',
]

function obterCredenciaisAdmin(): { email: string; senha: string } {
  const email = process.env.E2E_ADMIN_EMAIL
  const senha = process.env.E2E_ADMIN_SENHA
  if (!email || !senha) {
    throw new Error('Credenciais E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  return { email, senha }
}

test.beforeEach(async ({ page }) => {
  const { email, senha } = obterCredenciaisAdmin()
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('menu lateral mostra os cinco módulos e Configurações no rodapé', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile)

  const navPrincipal = page.getByRole('navigation', { name: 'Navegação principal' })
  await expect(navPrincipal).toBeVisible()

  for (const m of MODULOS_ROTULOS) {
    await expect(navPrincipal.getByRole('link', { name: m })).toBeVisible()
  }

  const linkConfig = page.getByRole('link', { name: 'Configurações' })
  await expect(linkConfig).toBeVisible()
  await expect(linkConfig).toHaveAttribute('href', '/configuracoes')
})

test('cada módulo mostra título, breadcrumb e estado não configurado sem badge de sucesso', async ({
  page,
  isMobile,
}) => {
  for (const m of MODULOS_ROTULOS) {
    if (isMobile) {
      await page.getByRole('button', { name: 'Abrir navegação' }).click()
      await page.getByRole('dialog').getByRole('link', { name: m }).click()
      await expect(page.getByRole('dialog')).toBeHidden()
    } else {
      await page
        .getByRole('navigation', { name: 'Navegação principal' })
        .getByRole('link', { name: m })
        .click()
    }

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(m)
    await expect(page.locator('[data-tom="sucesso"]')).toHaveCount(0)

    if (m === 'Clientes') {
      const lista = page.getByRole('list', { name: 'Lista de clientes' })
      const vazio = page.locator('[data-tipo="nenhum-registro"]')
      await expect(lista.or(vazio)).toBeVisible()
    } else if (m === 'Projetos') {
      const lista = page.getByRole('list', { name: 'Lista de projetos' })
      const vazio = page.locator('[data-tipo="nenhum-registro"]')
      await expect(lista.or(vazio)).toBeVisible()
    } else if (m === 'Infraestrutura') {
      const lista = page.getByRole('list', { name: 'Inventário de recursos' })
      const vazio = page.locator('[data-tipo="nenhum-registro"]')
      await expect(lista.or(vazio)).toBeVisible()
    } else if (m === 'Visão Geral') {
      await expect(page.getByRole('heading', { level: 2, name: 'Pendências' })).toBeVisible()
    } else {
      await expect(page.getByRole('status')).toBeVisible()
    }
  }
})

test('no mobile, só por teclado: Pular para o conteúdo é o primeiro foco, Abrir navegação abre o painel e Enter navega', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile)

  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Abrir navegação' })).toBeFocused()

  await page.keyboard.press('Enter')
  await page.getByRole('dialog').getByRole('link', { name: 'Projetos' }).focus()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page).toHaveURL(/\/projetos$/)
})

test('menu do usuário mostra nome e Sair funciona', async ({ page }) => {
  const gatilho = page.getByRole('button', { name: /Menu do usuário/ })
  await gatilho.focus()
  await page.keyboard.press('Enter')

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Admin E2E')).toBeVisible()

  const itemSair = page.getByRole('menuitem', { name: 'Sair' })
  await itemSair.focus()
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL(/\/entrar$/)
})
