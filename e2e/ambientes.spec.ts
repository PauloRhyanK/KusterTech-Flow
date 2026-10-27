import { expect, test, type Page } from '@playwright/test'
import {
  configurarAmbientesNoBanco,
  contarAmbientes,
  contarEvidencias,
  criarClienteNoBanco,
  criarProjetoNoBanco,
  criarUsuarioNoBanco,
  limparImplantacaoDosRepositoriosNoBanco,
  liberarRepositoriosNoBanco,
  nomeDeTeste,
  removerAmbientesNoBanco,
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

function regiao(page: Page, tipo: 'DEV' | 'QA' | 'PROD') {
  return page.getByRole('region', { name: tipo, exact: true })
}

async function salvarAmbiente(page: Page, tipo: 'DEV' | 'QA' | 'PROD', nome: string) {
  const secao = regiao(page, tipo)
  await secao.getByLabel('Nome do environment no GitHub').fill(nome)
  await secao.getByRole('button', { name: 'Salvar ambiente' }).click()
  await expect(secao.getByText(`Ambiente ${tipo} salvo.`)).toBeVisible()
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

test('admin preenche dev, qa e production, vincula os repositórios, roda o worker: "Deployments de <repoUm>: última leitura em" visível; Resumo com Ambientes Concluído "DEV, QA e PROD configurados"', async ({
  page,
}, testInfo) => {
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(testInfo.project.name)
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Ambientes'))
  await vincularNoBanco(projeto.id, repoUm)
  await vincularNoBanco(projeto.id, repoDois)
  rodarWorkerUmaVez()

  await page.goto(`/projetos/${projeto.id}/configuracao#ambientes`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(regiao(page, 'QA').getByText('Não configurado')).toBeVisible()
  await expect(
    page.getByText(
      'Nenhum ambiente usa GitHub Deployments; as evidências vêm do endpoint ou de registro manual.',
    ),
  ).toBeVisible()

  await salvarAmbiente(page, 'DEV', 'dev')
  await salvarAmbiente(page, 'QA', 'qa')
  await expect(regiao(page, 'QA').getByText('Configurado')).toBeVisible()
  await salvarAmbiente(page, 'PROD', 'production')

  rodarWorkerUmaVez()

  await page.reload()
  await expect(page.getByText(`Deployments de ${repoUm}: última leitura em`)).toBeVisible()
  await expect(page.getByText(`Deployments de ${repoDois}: última leitura em`)).toBeVisible()

  await page.goto(`/projetos/${projeto.id}`)
  const ambientes = page
    .getByRole('list', { name: 'Configuração do projeto' })
    .locator('li', { hasText: 'Ambientes' })
  await expect(ambientes).toContainText('DEV, QA e PROD configurados')
  await expect(ambientes.getByText('Concluído')).toBeVisible()
})

test('Gerar token na região QA mostra o token uma vez; recarregar não mostra; request.post("/api/evidencias/deploy") com ele e commitSha V2 de repoUm → 201; após "Revogar token" e confirmar → 401 "Token de evidência inválido."', async ({
  page,
  request,
}, testInfo) => {
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(testInfo.project.name)
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Token'))
  await vincularNoBanco(projeto.id, repoUm)
  await vincularNoBanco(projeto.id, repoDois)

  await page.goto(`/projetos/${projeto.id}/configuracao`)
  const qa = regiao(page, 'QA')
  await expect(qa.getByText('Salve o ambiente para gerar um token de evidência.')).toBeVisible()
  await salvarAmbiente(page, 'QA', 'qa')
  await expect(qa.getByText('Nenhum token de evidência.')).toBeVisible()

  await qa.getByRole('button', { name: 'Gerar token' }).click()
  const campoDoToken = qa.getByTestId('token-de-evidencia')
  await expect(campoDoToken).toBeVisible()
  await expect(qa.getByText('Copie agora: este token não será mostrado de novo.')).toBeVisible()
  const token = (await campoDoToken.textContent()) ?? ''
  expect(token).toMatch(/^fle_[A-Za-z0-9_-]{43}$/)

  await page.reload()
  await expect(page.getByTestId('token-de-evidencia')).toHaveCount(0)
  await expect(regiao(page, 'QA').getByText(/Token criado em/)).toBeVisible()

  const enviar = (bearer: string) =>
    request.post('/api/evidencias/deploy', {
      headers: { authorization: `Bearer ${bearer}` },
      data: { repositorio: repoUm, commitSha: shaV2(repoUm), idExterno: `e2e-${Date.now()}` },
    })

  const aceito = await enviar(token)
  expect(aceito.status()).toBe(201)
  expect(await contarEvidencias(projeto.id)).toBe(1)

  // Gerar outro token invalida o anterior.
  const qaDepois = regiao(page, 'QA')
  await qaDepois.getByRole('button', { name: 'Gerar novo token' }).click()
  await qaDepois.getByRole('button', { name: 'Confirmar: o token atual deixa de valer' }).click()
  const novoCampo = qaDepois.getByTestId('token-de-evidencia')
  await expect(novoCampo).toBeVisible()
  const novoToken = (await novoCampo.textContent()) ?? ''
  expect(novoToken).not.toBe(token)
  const antigo = await enviar(token)
  expect(antigo.status()).toBe(401)
  expect(await antigo.json()).toEqual({ erro: 'Token de evidência inválido.' })
  expect((await enviar(novoToken)).status()).toBe(201)

  await qaDepois.getByRole('button', { name: 'Revogar token' }).click()
  await qaDepois.getByRole('button', { name: 'Confirmar revogação' }).click()
  await expect(qaDepois.getByText('Nenhum token de evidência.')).toBeVisible()

  const revogado = await enviar(novoToken)
  expect(revogado.status()).toBe(401)
  expect(await revogado.json()).toEqual({ erro: 'Token de evidência inválido.' })
  expect(await contarEvidencias(projeto.id)).toBe(2)
})

test('mesmo nome "qa" em DEV mostra "Outro ambiente deste projeto já usa este nome do GitHub." em role=alert', async ({
  page,
}, testInfo) => {
  const [repoUm] = repositoriosDoProjetoE2E(testInfo.project.name)
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Nome Repetido'))
  await vincularNoBanco(projeto.id, repoUm)
  await configurarAmbientesNoBanco(projeto.id)

  await page.goto(`/projetos/${projeto.id}/configuracao`)
  const dev = regiao(page, 'DEV')
  await dev.getByLabel('Nome do environment no GitHub').fill('QA')
  await dev.getByRole('button', { name: 'Salvar ambiente' }).click()

  await expect(
    dev
      .getByRole('alert')
      .filter({ hasText: 'Outro ambiente deste projeto já usa este nome do GitHub.' }),
  ).toBeVisible()
  expect(await contarAmbientes(projeto.id)).toBe(3)
})

test('testador escopado: /projetos/<p>/configuracao mostra "Sem permissão para esta área."; POST forjado de salvar ambiente (capturado do admin) → contarAmbientes(projeto) inalterado', async ({
  page,
  browser,
}) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const cliente = await criarClienteNoBanco(nomeDeTeste('Cliente Ambientes'))
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Forja Ambientes'), [cliente.id])

  // Captura a Server Action real de salvar ambiente (feita pelo admin) para reenviá-la forjada.
  await page.goto(`/projetos/${projeto.id}/configuracao`)
  const dev = regiao(page, 'DEV')
  await dev.getByLabel('Nome do environment no GitHub').fill('dev')
  const [requisicao] = await Promise.all([
    page.waitForRequest((r) => r.method() === 'POST' && 'next-action' in r.headers()),
    dev.getByRole('button', { name: 'Salvar ambiente' }).click(),
  ])
  await expect(dev.getByText('Ambiente DEV salvo.')).toBeVisible()
  const corpo = requisicao.postDataBuffer()
  expect(corpo).not.toBeNull()
  const envio = {
    headers: {
      'next-action': requisicao.headers()['next-action'] as string,
      'content-type': requisicao.headers()['content-type'] as string,
    },
    data: corpo as Buffer,
  }
  await removerAmbientesNoBanco(projeto.id)
  expect(await contarAmbientes(projeto.id)).toBe(0)

  const emailTestador = `e2e+testador-ambientes-${Date.now()}@local.test`
  const senhaTestador = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email: emailTestador,
    nome: 'Testador Ambientes',
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

    const resposta = await contexto.request.post(requisicao.url(), envio)
    expect(resposta.status()).toBeLessThan(500)
    expect(await contarAmbientes(projeto.id)).toBe(0)
  } finally {
    await contexto.close()
  }

  // Controle positivo: a mesma requisição enviada pelo admin grava; a recusa acima é de autorização.
  await page.request.post(requisicao.url(), envio)
  await expect.poll(() => contarAmbientes(projeto.id)).toBe(1)
})
