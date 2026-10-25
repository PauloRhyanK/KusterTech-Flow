import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import {
  contarClientes,
  criarClienteNoBanco,
  criarUsuarioNoBanco,
  nomeDeTeste,
} from './support/banco'

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

test('admin cria um cliente, vê na lista com "Sem projetos", abre o detalhe, edita o nome e vê "Cliente atualizado."; busca pelo nome novo encontra, busca por nome inexistente mostra "Nenhum cliente encontrado para esta busca."', async ({
  page,
}) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  await page.goto('/clientes')
  await expect(page.getByRole('heading', { level: 1, name: 'Clientes' })).toBeVisible()

  await page.getByRole('link', { name: 'Novo cliente' }).first().click()
  await expect(page).toHaveURL(/\/clientes\/novo$/)

  const nomeInicial = nomeDeTeste('Cliente Alfa')
  const nomeEditado = nomeDeTeste('Cliente Alfa Editado')

  await page.getByLabel('Nome').fill(nomeInicial)
  await page.getByLabel('Observações').fill('Primeira linha de observações\nSegunda linha técnica')
  await page.getByRole('button', { name: 'Criar cliente' }).click()

  // Redireciona para o detalhe
  await expect(page).toHaveURL(/\/clientes\/[0-9a-fA-F-]+$/)
  await expect(page.getByRole('heading', { level: 1, name: nomeInicial })).toBeVisible()
  await expect(page.getByText('Primeira linha de observações')).toBeVisible()
  await expect(page.getByText('Nenhum projeto associado.')).toBeVisible()

  // Volta para a lista
  await page.goto('/clientes')
  const linhaInicial = page.locator('li', { hasText: nomeInicial })
  await expect(linhaInicial).toBeVisible()
  await expect(linhaInicial.getByText('Sem projetos')).toBeVisible()

  // Abre o detalhe e edita o nome
  await linhaInicial.getByRole('link', { name: nomeInicial }).click()
  await page.getByRole('link', { name: 'Editar' }).click()
  await expect(page).toHaveURL(/\/clientes\/[0-9a-fA-F-]+\/editar$/)

  await page.getByLabel('Nome').fill(nomeEditado)
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Cliente atualizado.' })).toBeVisible()

  // Busca na lista
  await page.goto('/clientes')
  await page.getByPlaceholder('Buscar por nome').fill(nomeEditado)
  await page.getByRole('button', { name: 'Buscar' }).click()
  await expect(page.locator('li', { hasText: nomeEditado })).toBeVisible()

  await page.getByPlaceholder('Buscar por nome').fill(nomeDeTeste('Inexistente Absoluto'))
  await page.getByRole('button', { name: 'Buscar' }).click()
  await expect(page.getByText('Nenhum cliente encontrado para esta busca.')).toBeVisible()
  await expect(page.getByText('Tente outro nome.')).toBeVisible()
})

test('nome repetido com caixa diferente mostra "Já existe um cliente com este nome." e a contagem no banco não muda', async ({
  page,
}) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  const nomeBase = nomeDeTeste('Cliente Duplicado')
  await criarClienteNoBanco(nomeBase)

  const contagemAntes = await contarClientes()

  await page.goto('/clientes/novo')
  await page.getByLabel('Nome').fill(nomeBase.toUpperCase())
  await page.getByRole('button', { name: 'Criar cliente' }).click()

  await expect(
    page.getByRole('alert').filter({ hasText: 'Já existe um cliente com este nome.' }),
  ).toBeVisible()

  const contagemDepois = await contarClientes()
  expect(contagemDepois).toBe(contagemAntes)
})

test('arquivar exige confirmação; cliente arquivado mostra o badge e some da seleção de clientes no cadastro de usuários', async ({
  page,
}) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  const nomeCliente = nomeDeTeste('Cliente Arquivamento')
  const cliente = await criarClienteNoBanco(nomeCliente)

  await page.goto(`/clientes/${cliente.id}`)
  await expect(page.getByRole('heading', { level: 1, name: nomeCliente })).toBeVisible()

  // Primeiro clique troca o rótulo e não submete
  const botaoArquivar = page.getByRole('button', { name: 'Arquivar' })
  await botaoArquivar.click()

  const botaoConfirmar = page.getByRole('button', { name: 'Confirmar arquivamento' })
  await expect(botaoConfirmar).toBeVisible()

  // Segundo clique submete
  await botaoConfirmar.click()

  // Página é revalidada: mostra badge "Arquivado" e botão vira "Reativar"
  await expect(page.locator('[data-tom="neutro"]').filter({ hasText: 'Arquivado' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reativar' })).toBeVisible()

  // Na lista de clientes mostra o badge Arquivado
  await page.goto('/clientes')
  const linha = page.locator('li', { hasText: nomeCliente })
  await expect(linha.locator('[data-tom="neutro"]')).toHaveText('Arquivado')

  // No cadastro de usuários, o cliente arquivado não aparece na seleção
  await page.goto('/configuracoes/usuarios')
  const selectCliente = page.getByLabel('Cliente')
  await expect(selectCliente).toBeVisible()
  const options = await selectCliente.locator('option').allTextContents()
  expect(options).not.toContain(nomeCliente)
})

test('testador escopado ao cliente A vê só A na lista; /clientes/<B> mostra "Sem permissão para esta área."; /clientes/novo mostra Sem permissão; /clientes/<uuid inexistente> mostra "Registro não encontrado" dentro do shell', async ({
  browser,
  page,
}) => {
  const { email: adminEmail, senha: adminSenha } = obterAdmin()
  await fazerLogin(page, adminEmail, adminSenha)

  const clienteA = await criarClienteNoBanco(nomeDeTeste('Cliente Escopo A'))
  const clienteB = await criarClienteNoBanco(nomeDeTeste('Cliente Escopo B'))

  const emailTestador = `e2e+testador-${Date.now()}@local.test`
  const senhaTestador = 'senha-testador-123'
  await criarUsuarioNoBanco({
    email: emailTestador,
    nome: 'Testador Escopo A',
    senha: senhaTestador,
    papel: 'TESTADOR',
    clienteId: clienteA.id,
  })

  // Teste de "Registro não encontrado" no shell com admin
  const uuidInexistente = randomUUID()
  await page.goto(`/clientes/${uuidInexistente}`)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Registro não encontrado' }),
  ).toBeVisible()
  await expect(
    page.getByText('Este registro não existe ou não está disponível para você.'),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ir para a Visão Geral' })).toBeVisible()

  // Testador escopado em outro contexto
  const testadorContext = await browser.newContext()
  const testadorPage = await testadorContext.newPage()

  try {
    await fazerLogin(testadorPage, emailTestador, senhaTestador)

    await testadorPage.goto('/clientes')
    await expect(testadorPage.getByText(clienteA.nome)).toBeVisible()
    await expect(testadorPage.getByText(clienteB.nome)).toHaveCount(0)
    await expect(testadorPage.getByRole('link', { name: 'Novo cliente' })).toHaveCount(0)

    // Acesso direto ao cliente B
    await testadorPage.goto(`/clientes/${clienteB.id}`)
    await expect(testadorPage.getByRole('status')).toContainText('Sem permissão para esta área.')
    await expect(testadorPage.getByText(clienteB.nome)).toHaveCount(0)

    // Acesso direto a /clientes/novo
    await testadorPage.goto('/clientes/novo')
    await expect(testadorPage.getByRole('status')).toContainText('Sem permissão para esta área.')
    await expect(testadorPage.getByRole('button', { name: 'Criar cliente' })).toHaveCount(0)
  } finally {
    await testadorContext.close()
  }
})
