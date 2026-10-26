import { expect, test, type Page } from '@playwright/test'
import {
  criarClienteNoBanco,
  criarProjetoNoBanco,
  criarUsuarioNoBanco,
  definirSituacaoDoRepositorio,
  liberarRepositoriosNoBanco,
  nomeDeTeste,
  obterIssueNoBanco,
  repositoriosDoProjetoE2E,
  vincularNoBanco,
} from './support/banco'
import { rodarWorkerUmaVez } from './support/worker'

function obterAdmin(): { email: string; senha: string } {
  const email = process.env.E2E_ADMIN_EMAIL
  const senha = process.env.E2E_ADMIN_SENHA
  if (!email || !senha) {
    throw new Error('E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  return { email, senha }
}

async function fazerLogin(page: Page, email: string, senha: string): Promise<void> {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function prepararProjeto(nome: string, projectName: string) {
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(projectName)
  const projeto = await criarProjetoNoBanco(nomeDeTeste(nome))
  await vincularNoBanco(projeto.id, repoUm)
  await vincularNoBanco(projeto.id, repoDois)
  rodarWorkerUmaVez()
  return { projeto, repoUm, repoDois }
}

test.beforeEach(async ({}, testInfo) => {
  await liberarRepositoriosNoBanco(repositoriosDoProjetoE2E(testInfo.project.name))
})

test('Entregas lista as issues abertas dos dois repositórios, filtra por fechadas e por repositório, busca #2', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { projeto, repoUm, repoDois } = await prepararProjeto(
    'Projeto Entregas',
    testInfo.project.name,
  )
  const [nomeUm, nomeDois] = [repoUm, repoDois].map((r) => r.split('/')[1] as string)

  await page.goto(`/projetos/${projeto.id}/entregas`)
  await expect(page.getByText('Milestones chegam no Incremento 3.')).toBeVisible()

  const lista = page.getByRole('list', { name: 'Issues sem milestone' })
  await expect(lista.getByRole('listitem')).toHaveCount(6)
  await expect(lista.getByText(`#1 Item 1 de ${nomeUm}`)).toBeVisible()
  await expect(lista.getByText(`#3 Item 3 de ${nomeDois}`)).toBeVisible()
  await expect(lista.getByText('Fechada')).toHaveCount(0)

  await page.getByLabel('Situação').selectOption({ label: 'Fechadas' })
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect(lista.getByRole('listitem')).toHaveCount(4)
  await expect(lista.getByText('Fechada')).toHaveCount(4)

  await page.getByLabel('Situação').selectOption({ label: 'Todas' })
  await page.getByLabel('Repositório', { exact: true }).selectOption({ label: repoUm })
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect(lista.getByRole('listitem')).toHaveCount(5)

  await page.getByLabel('Buscar').fill('#2')
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect(lista.getByRole('listitem')).toHaveCount(1)
  await expect(lista.getByText(`#2 Item 2 de ${nomeUm}`)).toBeVisible()
  await expect(lista.getByText('1 PR')).toBeVisible()
})

test('issue #2 mostra o PR mergeado com checks Sucesso e "Sem evidência de versão ou ambiente"; desktop em duas colunas, mobile em uma sem rolagem horizontal', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { projeto, repoUm } = await prepararProjeto('Projeto Issue', testInfo.project.name)
  const issue = await obterIssueNoBanco(repoUm, 2)

  await page.goto(`/projetos/${projeto.id}/entregas/issues/${issue.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Item 2')
  await expect(page.getByText('Mergeado')).toBeVisible()
  await expect(page.getByText('Sucesso')).toBeVisible()
  await expect(page.getByText('Sem evidência de versão ou ambiente.')).toBeVisible()

  const corpo = await page.getByText('Descrição fictícia do item 2.').boundingBox()
  const lateral = await page.getByRole('heading', { name: 'Pull requests' }).boundingBox()
  expect(corpo).not.toBeNull()
  expect(lateral).not.toBeNull()
  if (testInfo.project.name === 'mobile') {
    expect(lateral!.y).toBeGreaterThan(corpo!.y + corpo!.height - 1)
    const transborda = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(transborda).toBe(false)
  } else {
    expect(lateral!.x).toBeGreaterThanOrEqual(corpo!.x + corpo!.width - 1)
  }
})

test('situação forçada para 31 min atrás mostra "Os dados do GitHub podem estar desatualizados" e mantém a lista', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { projeto, repoUm, repoDois } = await prepararProjeto(
    'Projeto Desatualizado',
    testInfo.project.name,
  )
  const trintaEUmMinutosAtras = new Date(Date.now() - 31 * 60_000)
  for (const repo of [repoUm, repoDois]) {
    await definirSituacaoDoRepositorio(repo, { sincronizadoEm: trintaEUmMinutosAtras })
  }

  await page.goto(`/projetos/${projeto.id}/entregas`)
  await expect(page.getByText('Os dados do GitHub podem estar desatualizados.')).toBeVisible()
  await expect(
    page.getByText(/Última sincronização: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\./),
  ).toBeVisible()
  await expect(
    page.getByRole('list', { name: 'Issues sem milestone' }).getByRole('listitem'),
  ).toHaveCount(6)
})

test('testador escopado em /projetos/<p>/entregas e na issue vê "Sem permissão"', async ({
  page,
  browser,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const cliente = await criarClienteNoBanco(nomeDeTeste('Cliente Entregas'))
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Entregas Escopo'), [cliente.id])
  const [repoUm] = repositoriosDoProjetoE2E(testInfo.project.name)
  await vincularNoBanco(projeto.id, repoUm)
  rodarWorkerUmaVez()
  const issue = await obterIssueNoBanco(repoUm, 2)

  const emailTestador = `e2e+testador-entregas-${Date.now()}@local.test`
  const senhaTestador = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email: emailTestador,
    nome: 'Testador Entregas',
    senha: senhaTestador,
    papel: 'TESTADOR',
    clienteId: cliente.id,
  })

  const contexto = await browser.newContext()
  try {
    const paginaTestador = await contexto.newPage()
    await fazerLogin(paginaTestador, emailTestador, senhaTestador)

    for (const rota of [
      `/projetos/${projeto.id}/entregas`,
      `/projetos/${projeto.id}/entregas/issues/${issue.id}`,
    ]) {
      await paginaTestador.goto(rota)
      await expect(paginaTestador.getByText('Sem permissão para esta área.')).toBeVisible()
      await expect(paginaTestador.getByText('Item 2')).toHaveCount(0)
    }
  } finally {
    await contexto.close()
  }
})
