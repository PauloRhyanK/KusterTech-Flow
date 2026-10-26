import { expect, test, type Page } from '@playwright/test'
import {
  contarIssues,
  criarClienteNoBanco,
  criarProjetoNoBanco,
  criarUsuarioNoBanco,
  definirSituacaoDoRepositorio,
  liberarRepositoriosNoBanco,
  nomeDeTeste,
  obterRepositorioNoBanco,
  repositoriosDoProjetoE2E,
  vincularNoBanco,
} from './support/banco'
import { rodarWorkerUmaVez } from './support/worker'

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

function itemDoChecklist(page: Page, titulo: string) {
  return page
    .getByRole('list', { name: 'Configuração do projeto' })
    .locator('li', { hasText: titulo })
}

test.beforeEach(async ({}, testInfo) => {
  await liberarRepositoriosNoBanco(repositoriosDoProjetoE2E(testInfo.project.name))
})

test('admin vincula os dois repositórios do seu projeto Playwright, roda o worker e vê Conectada com a hora; checklist do Resumo mostra GitHub concluído', async ({
  page,
}, testInfo) => {
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(testInfo.project.name)
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Repositórios'))

  await page.goto(`/projetos/${projeto.id}`)
  await expect(itemDoChecklist(page, 'GitHub')).toContainText('Nenhum repositório vinculado')
  await itemDoChecklist(page, 'GitHub').getByRole('link', { name: 'Vincular repositórios' }).click()
  await expect(page).toHaveURL(new RegExp(`/projetos/${projeto.id}/configuracao#repositorios$`))

  const secao = page.locator('#repositorios')
  await expect(secao.getByText('Dados de teste (fixtures)')).toBeVisible()

  for (const repo of [repoUm, repoDois]) {
    await secao.getByLabel('Repositório', { exact: true }).selectOption({ label: repo })
    await secao.getByRole('button', { name: 'Vincular', exact: true }).click()
    await expect(secao.getByRole('link', { name: repo })).toBeVisible()
  }
  await expect(secao.getByText('Aguardando a primeira sincronização')).toHaveCount(2)

  rodarWorkerUmaVez()

  await page.reload()
  await expect(secao.getByText('Conectada')).toHaveCount(2)
  await expect(
    secao.getByText(/Última sincronização: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/),
  ).toHaveCount(2)

  await page.goto(`/projetos/${projeto.id}`)
  await expect(itemDoChecklist(page, 'GitHub')).toContainText('2 repositórios vinculados')
  await expect(itemDoChecklist(page, 'GitHub').getByText('Concluído')).toBeVisible()
})

test('situação forçada para falha mostra Indisponível e o checklist GitHub em falha, sem esconder os vinculados', async ({
  page,
}, testInfo) => {
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(testInfo.project.name)
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Falha'))
  await vincularNoBanco(projeto.id, repoUm)
  await vincularNoBanco(projeto.id, repoDois)
  rodarWorkerUmaVez()

  await definirSituacaoDoRepositorio(repoUm, {
    ultimaFalhaEm: new Date(),
    ultimaFalhaMotivo: 'Não foi possível falar com o GitHub.',
  })

  await page.goto(`/projetos/${projeto.id}/configuracao`)
  const secao = page.locator('#repositorios')
  await expect(secao.getByText('Indisponível')).toHaveCount(1)
  await expect(secao.getByText('Conectada')).toHaveCount(1)
  await expect(secao.getByText('Não foi possível falar com o GitHub.')).toBeVisible()
  await expect(secao.getByRole('link', { name: repoUm })).toBeVisible()
  await expect(secao.getByRole('link', { name: repoDois })).toBeVisible()

  await page.goto(`/projetos/${projeto.id}`)
  await expect(itemDoChecklist(page, 'GitHub')).toContainText(
    'Integração indisponível; os dados podem estar desatualizados.',
  )
  await expect(itemDoChecklist(page, 'GitHub').getByText('Com falha')).toBeVisible()
})

test('desvincular pede confirmação e preserva as issues (contarIssues inalterado)', async ({
  page,
}, testInfo) => {
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(testInfo.project.name)
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Desvincular'))
  await vincularNoBanco(projeto.id, repoUm)
  await vincularNoBanco(projeto.id, repoDois)
  rodarWorkerUmaVez()
  const issuesAntes = await contarIssues()
  expect(issuesAntes).toBeGreaterThan(0)

  await page.goto(`/projetos/${projeto.id}/configuracao`)
  const secao = page.locator('#repositorios')
  const linha = secao.locator('li', { hasText: repoUm })

  await linha.getByRole('button', { name: 'Desvincular' }).click()
  // Primeiro clique só arma a confirmação: nada muda ainda.
  await expect(linha.getByRole('button', { name: 'Confirmar desvinculação' })).toBeVisible()
  expect((await obterRepositorioNoBanco(repoUm)).projetoId).toBe(projeto.id)

  await linha.getByRole('button', { name: 'Confirmar desvinculação' }).click()
  await expect(secao.getByRole('link', { name: repoUm })).toHaveCount(0)
  await expect(secao.getByRole('option', { name: repoUm })).toHaveCount(1)

  expect((await obterRepositorioNoBanco(repoUm)).projetoId).toBeNull()
  expect(await contarIssues()).toBe(issuesAntes)
})

test('testador escopado forja o POST de vincular: nada muda no banco', async ({
  page,
  browser,
}, testInfo) => {
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(testInfo.project.name)
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  const cliente = await criarClienteNoBanco(nomeDeTeste('Cliente Forja'))
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Forja'), [cliente.id])

  // Captura a requisição real da Server Action de vincular (feita pelo admin) para reenviá-la forjada.
  await page.goto(`/projetos/${projeto.id}/configuracao`)
  const secao = page.locator('#repositorios')
  await secao.getByLabel('Repositório', { exact: true }).selectOption({ label: repoDois })
  const [requisicao] = await Promise.all([
    page.waitForRequest((r) => r.method() === 'POST' && 'next-action' in r.headers()),
    secao.getByRole('button', { name: 'Vincular', exact: true }).click(),
  ])
  await expect(secao.getByRole('link', { name: repoDois })).toBeVisible()
  const corpo = requisicao.postDataBuffer()
  expect(corpo).not.toBeNull()
  await liberarRepositoriosNoBanco([repoDois])
  expect((await obterRepositorioNoBanco(repoDois)).projetoId).toBeNull()

  const emailTestador = `e2e+testador-${Date.now()}@local.test`
  const senhaTestador = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email: emailTestador,
    nome: 'Testador Forja',
    senha: senhaTestador,
    papel: 'TESTADOR',
    clienteId: cliente.id,
  })

  const contexto = await browser.newContext()
  try {
    const paginaTestador = await contexto.newPage()
    await fazerLogin(paginaTestador, emailTestador, senhaTestador)

    await paginaTestador.goto(`/projetos/${projeto.id}/configuracao`)
    await expect(paginaTestador.getByText('Sem permissão para esta área.')).toBeVisible()

    const resposta = await contexto.request.post(requisicao.url(), {
      headers: {
        'next-action': requisicao.headers()['next-action'] as string,
        'content-type': requisicao.headers()['content-type'] as string,
      },
      data: corpo as Buffer,
    })
    expect(resposta.status()).toBeLessThan(500)

    expect((await obterRepositorioNoBanco(repoDois)).projetoId).toBeNull()
    expect((await obterRepositorioNoBanco(repoUm)).projetoId).toBeNull()

    // Controle positivo: a mesma requisição, enviada pelo admin, vincula; logo a recusa acima é de autorização.
    await page.request.post(requisicao.url(), {
      headers: {
        'next-action': requisicao.headers()['next-action'] as string,
        'content-type': requisicao.headers()['content-type'] as string,
      },
      data: corpo as Buffer,
    })
    expect((await obterRepositorioNoBanco(repoDois)).projetoId).toBe(projeto.id)
  } finally {
    await contexto.close()
  }
})
