import { expect, test, type Page } from '@playwright/test'
import {
  contarProjetos,
  criarClienteNoBanco,
  criarProjetoNoBanco,
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

test('admin cria projeto sem clientes e cai em /projetos/<id>/configuracao; a lista mostra "Sem clientes" e "Configuração pendente"', async ({
  page,
}) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  await page.goto('/projetos')
  await expect(page.getByRole('heading', { level: 1, name: 'Projetos' })).toBeVisible()

  await page.getByRole('link', { name: 'Novo projeto' }).first().click()
  await expect(page).toHaveURL(/\/projetos\/novo$/)

  const nomeProjeto = nomeDeTeste('Projeto Alfa')

  await page.getByLabel('Nome').fill(nomeProjeto)
  await page.getByLabel('Descrição').fill('Descrição do projeto inicial')
  await page.getByRole('button', { name: 'Criar projeto' }).click()

  // Redireciona para a configuração inicial
  await expect(page).toHaveURL(/\/projetos\/[0-9a-fA-F-]+\/configuracao$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Configuração inicial' })).toBeVisible()
  await expect(page.getByText(nomeProjeto).first()).toBeVisible()

  // Volta para a lista de projetos
  await page.goto('/projetos')
  const linha = page.locator('li', { hasText: nomeProjeto })
  await expect(linha).toBeVisible()
  await expect(linha.getByText('Sem clientes', { exact: true })).toBeVisible()
  await expect(linha.getByText('Configuração pendente', { exact: true })).toBeVisible()
})

test('na configuração, associa os clientes A e B: a lista global mostra o projeto uma vez com "A, B"; /clientes/<A> e /clientes/<B> listam o mesmo projeto (mesmo id no href) (UX-02, A02)', async ({
  page,
}) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  const clienteA = await criarClienteNoBanco(nomeDeTeste('Cliente A'))
  const clienteB = await criarClienteNoBanco(nomeDeTeste('Cliente B'))
  const nomeProjeto = nomeDeTeste('Projeto Compartilhado')
  const projeto = await criarProjetoNoBanco(nomeProjeto)

  await page.goto(`/projetos/${projeto.id}/configuracao`)
  await expect(page.getByRole('heading', { level: 1, name: 'Configuração inicial' })).toBeVisible()

  // Associa Cliente A
  await page.getByLabel('Cliente').selectOption(clienteA.id)
  await page.getByRole('button', { name: 'Associar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Cliente associado.' })).toBeVisible()
  await expect(page.getByText(clienteA.nome)).toBeVisible()

  // Associa Cliente B
  await page.getByLabel('Cliente').selectOption(clienteB.id)
  await page.getByRole('button', { name: 'Associar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Cliente associado.' })).toBeVisible()
  await expect(page.getByText(clienteB.nome)).toBeVisible()

  // Lista global mostra o projeto apenas UMA vez com ambos os clientes
  await page.goto('/projetos')
  const linhas = page.locator('li', { hasText: nomeProjeto })
  await expect(linhas).toHaveCount(1)
  await expect(
    linhas.getByText(
      new RegExp(`${clienteA.nome}, ${clienteB.nome}|${clienteB.nome}, ${clienteA.nome}`),
    ),
  ).toBeVisible()

  // /clientes/<A> lista o projeto com o mesmo id
  await page.goto(`/clientes/${clienteA.id}`)
  const linkNoClienteA = page
    .locator('li', { hasText: nomeProjeto })
    .getByRole('link', { name: nomeProjeto })
  await expect(linkNoClienteA).toBeVisible()
  const hrefA = await linkNoClienteA.getAttribute('href')
  expect(hrefA).toContain(projeto.id)

  // /clientes/<B> lista o mesmo projeto com o mesmo id
  await page.goto(`/clientes/${clienteB.id}`)
  const linkNoClienteB = page
    .locator('li', { hasText: nomeProjeto })
    .getByRole('link', { name: nomeProjeto })
  await expect(linkNoClienteB).toBeVisible()
  const hrefB = await linkNoClienteB.getAttribute('href')
  expect(hrefB).toContain(projeto.id)
})

test('associar A de novo não é oferecido no select; remover B exige confirmação e some de /clientes/<B>; renomear para o nome de outro projeto mostra "Já existe um projeto com este nome."', async ({
  page,
}) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  const clienteA = await criarClienteNoBanco(nomeDeTeste('Cliente Associado A'))
  const clienteB = await criarClienteNoBanco(nomeDeTeste('Cliente Associado B'))
  const nomeProjetoP = nomeDeTeste('Projeto Principal P')
  const nomeProjetoQ = nomeDeTeste('Projeto Existente Q')

  const projetoP = await criarProjetoNoBanco(nomeProjetoP, [clienteA.id, clienteB.id])
  await criarProjetoNoBanco(nomeProjetoQ)

  await page.goto(`/projetos/${projetoP.id}/configuracao`)

  // Clientes já associados não são oferecidos no select
  const selectCliente = page.getByLabel('Cliente')
  await expect(selectCliente).toBeVisible()
  const options = await selectCliente.locator('option').allTextContents()
  expect(options).not.toContain(clienteA.nome)
  expect(options).not.toContain(clienteB.nome)

  // Remover cliente B exige confirmação
  const itemClienteB = page.locator('li', { hasText: clienteB.nome })
  await expect(itemClienteB).toBeVisible()

  const botaoRemover = itemClienteB.getByRole('button', { name: 'Remover' })
  await botaoRemover.click()

  const botaoConfirmar = itemClienteB.getByRole('button', { name: 'Confirmar remoção' })
  await expect(botaoConfirmar).toBeVisible()

  await botaoConfirmar.click()

  // Cliente B é removido e some de /clientes/<B>
  await expect(page.locator('li', { hasText: clienteB.nome })).toBeHidden()

  await page.goto(`/clientes/${clienteB.id}`)
  await expect(page.locator('li', { hasText: nomeProjetoP })).toBeHidden()

  // Renomear para nome já existente mostra erro
  await page.goto(`/projetos/${projetoP.id}/configuracao`)
  await page.getByLabel('Nome').fill(nomeProjetoQ)
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Já existe um projeto com este nome.' }),
  ).toBeVisible()
})

test('arquivar projeto exige confirmação e a lista mostra "Arquivado"; o projeto arquivado aparece com badge em /clientes/<A>', async ({
  page,
}) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  const clienteA = await criarClienteNoBanco(nomeDeTeste('Cliente Vinculado'))
  const nomeProjeto = nomeDeTeste('Projeto Arquivamento')
  const projeto = await criarProjetoNoBanco(nomeProjeto, [clienteA.id])

  await page.goto(`/projetos/${projeto.id}/configuracao`)
  await expect(page.getByRole('heading', { level: 1, name: 'Configuração inicial' })).toBeVisible()

  // Primeiro clique troca o rótulo e não submete
  const botaoArquivar = page.getByRole('button', { name: 'Arquivar projeto' })
  await botaoArquivar.click()

  const botaoConfirmar = page.getByRole('button', { name: 'Confirmar arquivamento' })
  await expect(botaoConfirmar).toBeVisible()

  // Segundo clique submete
  await botaoConfirmar.click()

  // Mostra badge Arquivado e botão vira Reativar projeto
  await expect(page.locator('[data-tom="neutro"]').filter({ hasText: 'Arquivado' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reativar projeto' })).toBeVisible()

  // Na lista global de projetos mostra o badge Arquivado
  await page.goto('/projetos')
  const linhaProjeto = page.locator('li', { hasText: nomeProjeto })
  await expect(linhaProjeto.locator('[data-tom="neutro"]')).toHaveText('Arquivado')

  // Em /clientes/<A> o projeto aparece com badge Arquivado
  await page.goto(`/clientes/${clienteA.id}`)
  const linhaNoCliente = page.locator('li', { hasText: nomeProjeto })
  await expect(linhaNoCliente.locator('[data-tom="neutro"]')).toHaveText('Arquivado')
})

test('testador escopado a A vê em /projetos a orientação com link para A, sem "Novo projeto"; POST forjado de criarProjetoAction com o cookie do testador não cria projeto (contarProjetos)', async ({
  browser,
  page,
}) => {
  const { email: adminEmail, senha: adminSenha } = obterAdmin()
  await fazerLogin(page, adminEmail, adminSenha)

  const clienteA = await criarClienteNoBanco(nomeDeTeste('Cliente Escopo A'))
  const emailTestador = `e2e+testador-${Date.now()}@local.test`
  const senhaTestador = 'senha-testador-123'
  await criarUsuarioNoBanco({
    email: emailTestador,
    nome: 'Testador Escopado A',
    senha: senhaTestador,
    papel: 'TESTADOR',
    clienteId: clienteA.id,
  })

  // Captura o payload e headers da action criarProjetoAction como admin
  await page.goto('/projetos/novo')
  let capturada: { url: string; headers: Record<string, string>; body: Buffer } | null = null

  await page.route('**/projetos/novo', async (rota) => {
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

  await page.getByLabel('Nome').fill('Projeto Interceptado E2E')
  await page.getByRole('button', { name: 'Criar projeto' }).click()
  await expect.poll(() => capturada !== null).toBe(true)
  await page.unroute('**/projetos/novo')

  // Novo contexto de navegação para o testador escopado
  const testadorContext = await browser.newContext()
  const testadorPage = await testadorContext.newPage()

  try {
    await fazerLogin(testadorPage, emailTestador, senhaTestador)

    await testadorPage.goto('/projetos')
    await expect(testadorPage.getByRole('heading', { level: 1, name: 'Projetos' })).toBeVisible()

    // Mostra orientação com links para clientes visíveis
    await expect(
      testadorPage.getByText('Os projetos ficam disponíveis no contexto de cada cliente.'),
    ).toBeVisible()
    await expect(
      testadorPage.getByText('Escolha um cliente para ver os projetos dele.'),
    ).toBeVisible()

    // Link para cliente A visível
    const linkClienteA = testadorPage.getByRole('link', { name: clienteA.nome })
    await expect(linkClienteA).toBeVisible()
    await expect(linkClienteA).toHaveAttribute('href', `/clientes/${clienteA.id}`)

    // Sem botão/link "Novo projeto"
    await expect(testadorPage.getByRole('link', { name: 'Novo projeto' })).toBeHidden()

    // POST forjado de criarProjetoAction com os cookies do testador
    const contagemAntes = await contarProjetos()
    const nomeProjetoForjado = nomeDeTeste('Projeto Forjado Não Autorizado')
    const bodyForjado = Buffer.from(
      capturada!.body.toString('latin1').replace('Projeto Interceptado E2E', nomeProjetoForjado),
      'latin1',
    )

    const respForjada = await testadorContext.request.post(capturada!.url, {
      headers: {
        'next-action': capturada!.headers['next-action']!,
        'content-type': capturada!.headers['content-type']!,
      },
      data: bodyForjado,
    })

    const contagemDepois = await contarProjetos()
    expect(contagemDepois).toBe(contagemAntes)

    const textoResp = await respForjada.text()
    expect(textoResp).not.toContain(nomeProjetoForjado)
  } finally {
    await testadorContext.close()
  }
})
