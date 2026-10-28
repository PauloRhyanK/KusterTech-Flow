import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import {
  contarEventosDeWebhook,
  criarProjetoNoBanco,
  envelhecerIssueNoBanco,
  githubIdDoRepositorioNoBanco,
  liberarRepositoriosNoBanco,
  nomeDeTeste,
  obterIssueNoBanco,
  repositoriosDoProjetoE2E,
  vincularNoBanco,
} from './support/banco'
import { enviarWebhook } from './support/webhook'
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

async function capturar(page: Page, projeto: string, nomeArquivo: string): Promise<void> {
  const caminho = path.join('e2e', 'capturas', projeto, nomeArquivo)
  fs.mkdirSync(path.dirname(caminho), { recursive: true })
  await page.screenshot({ path: caminho, fullPage: true })
}

function corpoDeIssueFechada(repositorioGitHubId: number, nomeCompleto: string): string {
  return JSON.stringify({
    action: 'closed',
    issue: { number: 4 },
    repository: { id: repositorioGitHubId, full_name: nomeCompleto },
  })
}

// Restaura situação e cursores: o próximo ciclo relê a fixture e desfaz qualquer issue
// envelhecida por um teste interrompido.
test.beforeEach(async ({}, testInfo) => {
  await liberarRepositoriosNoBanco(repositoriosDoProjetoE2E(testInfo.project.name))
})

test('Jornada B passo 6: a issue fechada no GitHub chega por webhook antes do próximo ciclo', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000)
  const { email, senha } = obterAdmin()
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(testInfo.project.name)
  const nomeUm = repoUm.split('/')[1] as string
  const tituloDaFixture = `Item 4 de ${nomeUm}`
  const tituloAntigo = 'E2E título antigo'

  const projeto = await criarProjetoNoBanco(nomeDeTeste('E2E Webhook'), [])
  await vincularNoBanco(projeto.id, repoUm)
  await vincularNoBanco(projeto.id, repoDois)
  rodarWorkerUmaVez()

  await envelhecerIssueNoBanco(repoUm, 4, tituloAntigo)
  const issue = await obterIssueNoBanco(repoUm, 4)
  await fazerLogin(page, email, senha)
  const urlDaIssue = `/projetos/${projeto.id}/entregas/issues/${issue.id}`
  await page.goto(urlDaIssue)
  await expect(page.getByRole('heading', { level: 1, name: tituloAntigo })).toBeVisible()
  await expect(page.getByText('Aberta').first()).toBeVisible()
  await capturar(page, testInfo.project.name, 'b6-webhook-antes.png')

  // O ciclo periódico ainda não venceu: sem webhook, nada muda.
  rodarWorkerUmaVez()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: tituloAntigo })).toBeVisible()

  const deliveryId = `e2e-${randomUUID()}`
  const corpo = corpoDeIssueFechada(await githubIdDoRepositorioNoBanco(repoUm), repoUm)
  const primeira = await enviarWebhook(request, { evento: 'issues', deliveryId, corpo })
  expect(primeira.status()).toBe(202)

  rodarWorkerUmaVez()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: tituloDaFixture })).toBeVisible()
  await expect(page.getByText('Fechada').first()).toBeVisible()
  // A04: nenhum estado de qualidade ou entrega inferido do fechamento no GitHub.
  const situacao = page.getByText('Situação', { exact: true }).locator('..')
  await expect(situacao).toHaveText('SituaçãoFechada')
  const textoDaSituacao = (await situacao.textContent()) ?? ''
  for (const proibido of ['teste', 'QA', 'pronta', 'entregue']) {
    expect(textoDaSituacao).not.toContain(proibido)
  }
  await capturar(page, testInfo.project.name, 'b6-webhook-depois.png')

  const repetida = await enviarWebhook(request, { evento: 'issues', deliveryId, corpo })
  expect(repetida.status()).toBe(200)
  expect(await repetida.json()).toEqual({ resultado: 'duplicado' })
  expect(await contarEventosDeWebhook(deliveryId)).toBe(1)
})

test('Configuração mostra "Webhooks ativos" e "Último evento recebido em" depois da entrega', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000)
  const { email, senha } = obterAdmin()
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(testInfo.project.name)

  const projeto = await criarProjetoNoBanco(nomeDeTeste('E2E Webhook Configuração'), [])
  await vincularNoBanco(projeto.id, repoUm)
  await vincularNoBanco(projeto.id, repoDois)
  rodarWorkerUmaVez()

  const corpo = corpoDeIssueFechada(await githubIdDoRepositorioNoBanco(repoUm), repoUm)
  const resposta = await enviarWebhook(request, {
    evento: 'issues',
    deliveryId: `e2e-${randomUUID()}`,
    corpo,
  })
  expect(resposta.status()).toBe(202)

  await fazerLogin(page, email, senha)
  await page.goto(`/projetos/${projeto.id}/configuracao`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByText('Webhooks ativos')).toBeVisible()
  await expect(page.getByText(/Último evento recebido em/)).toBeVisible()
  await capturar(page, testInfo.project.name, 'b6-webhook-configuracao.png')

  if (testInfo.project.name === 'mobile') {
    const sem = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )
    expect(sem).toBe(true)
  }
})
