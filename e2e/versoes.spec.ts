import { expect, test, type Page } from '@playwright/test'
import {
  configurarAmbientesNoBanco,
  contarEvidencias,
  criarClienteNoBanco,
  criarProjetoNoBanco,
  criarUsuarioNoBanco,
  limparImplantacaoDosRepositoriosNoBanco,
  liberarRepositoriosNoBanco,
  nomeDeTeste,
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

// SHA da versão V2 das fixtures: n + 'e' × 39, com n = 1 (portal) ou 3 (site).
function shaV2(repo: string): string {
  return `${repo.endsWith('/portal') ? 1 : 3}${'e'.repeat(39)}`
}

test.beforeEach(async ({}, testInfo) => {
  const repositorios = repositoriosDoProjetoE2E(testInfo.project.name)
  await liberarRepositoriosNoBanco(repositorios)
  await limparImplantacaoDosRepositoriosNoBanco(repositorios)
})

test('com dev/qa/production e worker: "Em cada ambiente" mostra v1.4.0 em QA de repoUm com "Falha no último deploy" e v1.3.0 em PROD; lista com 6 versões', async ({
  page,
}, testInfo) => {
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(testInfo.project.name)
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Versões'))
  await vincularNoBanco(projeto.id, repoUm)
  await vincularNoBanco(projeto.id, repoDois)
  await configurarAmbientesNoBanco(projeto.id)
  rodarWorkerUmaVez()

  await page.goto(`/projetos/${projeto.id}/versoes`)
  await expect(page.getByRole('heading', { level: 1, name: 'Versões' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

  const ambientes = page.getByRole('list', { name: 'Em cada ambiente' })
  const qaDoRepoUm = ambientes.getByRole('listitem').filter({ hasText: 'QA' }).filter({
    hasText: repoUm,
  })
  await expect(qaDoRepoUm).toContainText('v1.4.0')
  await expect(qaDoRepoUm).toContainText('GitHub Deployments')
  await expect(qaDoRepoUm.getByText('Falha no último deploy')).toBeVisible()
  const prodDoRepoDois = ambientes.getByRole('listitem').filter({ hasText: 'PROD' }).filter({
    hasText: repoDois,
  })
  await expect(prodDoRepoDois).toContainText('v1.3.0')

  await expect(page.getByRole('list', { name: 'Versões' }).getByRole('listitem')).toHaveCount(6)
})

test('DEV sem nome no GitHub: "Registrar deploy manual" de V2 em repoUm mostra DEV v1.4.0 "Manual · Admin E2E"', async ({
  page,
}, testInfo) => {
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(testInfo.project.name)
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Deploy Manual'))
  await vincularNoBanco(projeto.id, repoUm)
  await vincularNoBanco(projeto.id, repoDois)
  await configurarAmbientesNoBanco(projeto.id, { DEV: null, QA: 'qa', PROD: 'production' })
  rodarWorkerUmaVez()

  await page.goto(`/projetos/${projeto.id}/versoes`)
  const ambientes = page.getByRole('list', { name: 'Em cada ambiente' })
  const devDoRepoUm = ambientes.getByRole('listitem').filter({ hasText: 'DEV' }).filter({
    hasText: repoUm,
  })
  await expect(devDoRepoUm.getByText('Sem evidência')).toBeVisible()

  await page.getByLabel('Ambiente', { exact: true }).selectOption('DEV')
  await page.getByLabel('Repositório', { exact: true }).last().selectOption({ label: repoUm })
  await page.getByLabel('Commit (SHA completo)').fill(shaV2(repoUm))
  await page.getByRole('button', { name: 'Registrar deploy manual' }).click()

  await expect(page.getByText('Deploy manual registrado em DEV.')).toBeVisible()
  await expect(devDoRepoUm).toContainText('v1.4.0')
  await expect(devDoRepoUm).toContainText('Manual · Admin E2E')
})

test('testador escopado: "Sem permissão para esta área." em /versoes; POST forjado de registrar deploy → contarEvidencias(projeto) inalterado', async ({
  page,
  browser,
}, testInfo) => {
  const [repoUm] = repositoriosDoProjetoE2E(testInfo.project.name)
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const cliente = await criarClienteNoBanco(nomeDeTeste('Cliente Versões'))
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Forja Versões'), [cliente.id])
  await vincularNoBanco(projeto.id, repoUm)
  await configurarAmbientesNoBanco(projeto.id)

  // Captura a Server Action real (feita pelo admin) para reenviá-la forjada.
  await page.goto(`/projetos/${projeto.id}/versoes`)
  await page.getByLabel('Commit (SHA completo)').fill(shaV2(repoUm))
  const [requisicao] = await Promise.all([
    page.waitForRequest((r) => r.method() === 'POST' && 'next-action' in r.headers()),
    page.getByRole('button', { name: 'Registrar deploy manual' }).click(),
  ])
  await expect(page.getByText('Deploy manual registrado em DEV.')).toBeVisible()
  expect(await contarEvidencias(projeto.id)).toBe(1)
  const corpo = requisicao.postDataBuffer()
  expect(corpo).not.toBeNull()
  const envio = {
    headers: {
      'next-action': requisicao.headers()['next-action'] as string,
      'content-type': requisicao.headers()['content-type'] as string,
    },
    data: corpo as Buffer,
  }

  const emailTestador = `e2e+testador-versoes-${Date.now()}@local.test`
  const senhaTestador = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email: emailTestador,
    nome: 'Testador Versões',
    senha: senhaTestador,
    papel: 'TESTADOR',
    clienteId: cliente.id,
  })

  const contexto = await browser.newContext()
  try {
    const paginaTestador = await contexto.newPage()
    await fazerLogin(paginaTestador, emailTestador, senhaTestador)

    await paginaTestador.goto(`/projetos/${projeto.id}/versoes`)
    await expect(paginaTestador.getByText('Sem permissão para esta área.')).toBeVisible()

    const resposta = await contexto.request.post(requisicao.url(), envio)
    expect(resposta.status()).toBeLessThan(500)
    expect(await contarEvidencias(projeto.id)).toBe(1)
  } finally {
    await contexto.close()
  }

  // Controle positivo: a mesma requisição enviada pelo admin grava; a recusa acima é de autorização.
  await page.request.post(requisicao.url(), envio)
  await expect.poll(() => contarEvidencias(projeto.id)).toBe(2)
})
