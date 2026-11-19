import { expect, test } from '@playwright/test'

const GRUPOS = [
  { rotulo: 'Trabalho', itens: ['Início', 'Fábrica'] },
  { rotulo: 'Cadastro', itens: ['Clientes', 'Projetos', 'Máquinas'] },
]
const ITENS = GRUPOS.flatMap((g) => g.itens)
const ROTAS: Record<string, string> = {
  Início: '/',
  Fábrica: '/fabrica',
  Clientes: '/clientes',
  Projetos: '/projetos',
  Máquinas: '/maquinas',
}

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

test('menu lateral mostra os grupos Trabalho e Cadastro, os cinco itens e Configurações no rodapé', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile)

  const navPrincipal = page.getByRole('navigation', { name: 'Navegação principal' })
  await expect(navPrincipal).toBeVisible()

  for (const grupo of GRUPOS) {
    await expect(navPrincipal.getByText(grupo.rotulo, { exact: true })).toBeVisible()
    for (const item of grupo.itens) {
      await expect(navPrincipal.getByRole('link', { name: item })).toBeVisible()
    }
  }
  await expect(navPrincipal.getByRole('link')).toHaveCount(ITENS.length)
  await expect(navPrincipal.getByText('Infraestrutura')).toHaveCount(0)
  await expect(navPrincipal.getByText('Central de Desenvolvimento')).toHaveCount(0)

  const linkConfig = page.getByRole('link', { name: 'Configurações' })
  await expect(linkConfig).toBeVisible()
  await expect(linkConfig).toHaveAttribute('href', '/configuracoes')
})

test('cada item leva à rota certa, com título e sem badge de sucesso', async ({
  page,
  isMobile,
}) => {
  for (const m of ITENS) {
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

    const rota = ROTAS[m] ?? ''
    await expect(page).toHaveURL(new RegExp(`${rota === '/' ? '/$' : `${rota}$`}`))
    await expect(page.getByRole('heading', { level: 1, name: m, exact: true })).toBeVisible()
    if (m !== 'Fábrica') {
      await expect(page.locator('[data-tom="sucesso"]')).toHaveCount(0)
    }

    if (m === 'Clientes') {
      const lista = page.getByRole('list', { name: 'Lista de clientes' })
      const vazio = page.locator('[data-tipo="nenhum-registro"]')
      await expect(lista.or(vazio)).toBeVisible()
    } else if (m === 'Projetos') {
      const lista = page.getByRole('list', { name: 'Lista de projetos' })
      const vazio = page.locator('[data-tipo="nenhum-registro"]')
      await expect(lista.or(vazio)).toBeVisible()
    } else if (m === 'Máquinas') {
      const lista = page.getByRole('list', { name: 'Inventário de recursos' })
      const vazio = page.locator('[data-tipo="nenhum-registro"]')
      await expect(lista.or(vazio)).toBeVisible()
    } else if (m === 'Início') {
      await expect(page.getByRole('heading', { level: 2, name: 'Espera você' })).toBeVisible()
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
