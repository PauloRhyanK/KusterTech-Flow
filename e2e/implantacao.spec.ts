import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  configurarAmbientesNoBanco,
  criarClienteNoBanco,
  criarMilestoneNoBanco,
  criarProjetoNoBanco,
  criarUsuarioNoBanco,
  desfazerConfirmacaoDePresencaNoBanco,
  estadoDePresencaNoBanco,
  limparImplantacaoDosRepositoriosNoBanco,
  liberarRepositoriosNoBanco,
  nomeDeTeste,
  obterIssueNoBanco,
  repositoriosDoProjetoE2E,
  vincularIssuesNoBanco,
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

test.beforeEach(async ({}, testInfo) => {
  const repositorios = repositoriosDoProjetoE2E(testInfo.project.name)
  await liberarRepositoriosNoBanco(repositorios)
  await limparImplantacaoDosRepositoriosNoBanco(repositorios)
})

// Projeto com repoUm, DEV/QA/PROD, uma milestone com #2 e #4 associada a um cliente `E2E ` e o
// worker rodado uma vez (deployments e presenças calculados).
async function prepararCenario(nome: string, projectName: string) {
  const [repoUm] = repositoriosDoProjetoE2E(projectName)
  const cliente = await criarClienteNoBanco(nomeDeTeste(`Cliente ${nome}`))
  const projeto = await criarProjetoNoBanco(nomeDeTeste(`Projeto ${nome}`), [cliente.id])
  await vincularNoBanco(projeto.id, repoUm)
  await configurarAmbientesNoBanco(projeto.id)
  const issue2 = await obterIssueNoBanco(repoUm, 2)
  const issue4 = await obterIssueNoBanco(repoUm, 4)
  const milestone = await criarMilestoneNoBanco(projeto.id, nomeDeTeste('Milestone'), [cliente.id])
  await vincularIssuesNoBanco(milestone.id, [issue2.id, issue4.id])
  rodarWorkerUmaVez()
  return { projeto, cliente, issue2, issue4, milestone }
}

function linhaDoAmbiente(page: Page, tipo: 'DEV' | 'QA' | 'PROD'): Locator {
  return page
    .getByRole('list', { name: 'Presença por ambiente' })
    .getByRole('listitem')
    .filter({ hasText: new RegExp(`^${tipo}`) })
}

test('issue #2: DEV e QA "Presença confirmada" com v1.4.0, PROD "Sem evidência"; issue #4 fechada: "Verificação necessária" em QA (A04); desktop em duas colunas, mobile em uma sem rolagem horizontal', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { projeto, issue2, issue4 } = await prepararCenario('Presença', testInfo.project.name)

  await page.goto(`/projetos/${projeto.id}/entregas/issues/${issue2.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  for (const tipo of ['DEV', 'QA'] as const) {
    const linha = linhaDoAmbiente(page, tipo)
    await expect(linha).toContainText('Presença confirmada')
    await expect(linha).toContainText('v1.4.0')
  }
  await expect(linhaDoAmbiente(page, 'PROD')).toContainText('Sem evidência')
  await expect(linhaDoAmbiente(page, 'PROD')).toContainText('v1.3.0')
  await expect(page.getByRole('link', { name: 'Ver versões do projeto' })).toBeVisible()

  const corpo = await page.getByText('Descrição fictícia do item 2.').boundingBox()
  const lateral = await page.getByRole('heading', { name: 'Versão e ambiente' }).boundingBox()
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

  await page.goto(`/projetos/${projeto.id}/entregas/issues/${issue4.id}`)
  await expect(page.getByText('Fechada').first()).toBeVisible()
  await expect(linhaDoAmbiente(page, 'QA')).toContainText('Verificação necessária')
  await expect(linhaDoAmbiente(page, 'QA')).not.toContainText('Presença confirmada')
  const texto = (await page.getByRole('main').textContent()) ?? ''
  expect(texto).not.toMatch(/pronta para teste|testar|entregue/i)
})

test('admin confirma #4 em QA: "Confirmação manual" e "Confirmada manualmente por Admin E2E em"; o botão some', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { projeto, issue4 } = await prepararCenario('Confirmar', testInfo.project.name)

  await page.goto(`/projetos/${projeto.id}/entregas/issues/${issue4.id}`)
  const qa = linhaDoAmbiente(page, 'QA')
  await qa.getByRole('button', { name: 'Confirmar presença manualmente' }).click()
  await qa.getByRole('button', { name: 'Confirmar presença em v1.4.0 (QA)' }).click()

  await expect(qa.getByText('Presença confirmada manualmente.', { exact: true })).toBeVisible()
  await expect(qa).toContainText('Confirmação manual')
  await expect(qa).toContainText('Confirmada manualmente por Admin E2E em')
  await expect(qa.getByRole('button')).toHaveCount(0)
  expect(await estadoDePresencaNoBanco(issue4.id, 'v1.4.0')).toBe('CONFIRMACAO_MANUAL')

  // O worker não desfaz a confirmação manual.
  rodarWorkerUmaVez()
  await page.reload()
  await expect(linhaDoAmbiente(page, 'QA')).toContainText('Confirmação manual')
})

test('lista de issues da milestone (global e contexto do cliente): #2 com QA "Presença confirmada", #4 com "Verificação necessária"', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { projeto, cliente, milestone } = await prepararCenario('Lista', testInfo.project.name)

  for (const base of [
    `/projetos/${projeto.id}`,
    `/clientes/${cliente.id}/projetos/${projeto.id}`,
  ]) {
    await page.goto(`${base}/entregas/milestones/${milestone.id}`)
    const lista = page.getByRole('list', { name: 'Issues da milestone' })
    const doItem2 = lista.getByRole('listitem').filter({ hasText: '#2 Item 2' })
    const doItem4 = lista.getByRole('listitem').filter({ hasText: '#4 Item 4' })
    await expect(doItem2).toContainText('QA:')
    await expect(doItem2).toContainText('Presença confirmada')
    await expect(doItem4).toContainText('QA:')
    await expect(doItem4).toContainText('Verificação necessária')
    await expect(lista.getByRole('listitem')).toHaveCount(2)
  }
})

test('testador escopado no contexto do cliente vê a coluna QA e a lateral sem SHA e sem botão; POST forjado de confirmar presença de #4 → linha continua VERIFICACAO_NECESSARIA', async ({
  page,
  browser,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { projeto, cliente, issue4, milestone } = await prepararCenario(
    'Forja',
    testInfo.project.name,
  )

  // Captura a Server Action real de confirmar presença (feita pelo admin) para reenviá-la forjada.
  await page.goto(`/projetos/${projeto.id}/entregas/issues/${issue4.id}`)
  const qaDoAdmin = linhaDoAmbiente(page, 'QA')
  await qaDoAdmin.getByRole('button', { name: 'Confirmar presença manualmente' }).click()
  const [requisicao] = await Promise.all([
    page.waitForRequest((r) => r.method() === 'POST' && 'next-action' in r.headers()),
    qaDoAdmin.getByRole('button', { name: 'Confirmar presença em v1.4.0 (QA)' }).click(),
  ])
  await expect(qaDoAdmin).toContainText('Confirmação manual')
  const corpo = requisicao.postDataBuffer()
  expect(corpo).not.toBeNull()
  const envio = {
    headers: {
      'next-action': requisicao.headers()['next-action'] as string,
      'content-type': requisicao.headers()['content-type'] as string,
    },
    data: corpo as Buffer,
  }
  await desfazerConfirmacaoDePresencaNoBanco(issue4.id)
  expect(await estadoDePresencaNoBanco(issue4.id, 'v1.4.0')).toBe('VERIFICACAO_NECESSARIA')

  const emailTestador = `e2e+testador-implantacao-${Date.now()}@local.test`
  const senhaTestador = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email: emailTestador,
    nome: 'Testador Implantação',
    senha: senhaTestador,
    papel: 'TESTADOR',
    clienteId: cliente.id,
  })

  const contexto = await browser.newContext()
  try {
    const paginaTestador = await contexto.newPage()
    await fazerLogin(paginaTestador, emailTestador, senhaTestador)

    const base = `/clientes/${cliente.id}/projetos/${projeto.id}/entregas`
    await paginaTestador.goto(`${base}/milestones/${milestone.id}`)
    const doItem4 = paginaTestador
      .getByRole('list', { name: 'Issues da milestone' })
      .getByRole('listitem')
      .filter({ hasText: '#4 Item 4' })
    await expect(doItem4).toContainText('Verificação necessária')

    await paginaTestador.goto(`${base}/issues/${issue4.id}`)
    const qa = linhaDoAmbiente(paginaTestador, 'QA')
    await expect(qa).toContainText('Verificação necessária')
    await expect(qa).toContainText('v1.4.0')
    await expect(paginaTestador.getByRole('button', { name: /Confirmar presença/ })).toHaveCount(0)
    await expect(paginaTestador.getByRole('link', { name: 'Ver versões do projeto' })).toHaveCount(
      0,
    )
    const texto = (await paginaTestador.getByRole('main').textContent()) ?? ''
    expect(texto).not.toMatch(/1eeeeee|GitHub Deployments|Endpoint/)

    const resposta = await contexto.request.post(requisicao.url(), envio)
    expect(resposta.status()).toBeLessThan(500)
    expect(await estadoDePresencaNoBanco(issue4.id, 'v1.4.0')).toBe('VERIFICACAO_NECESSARIA')
  } finally {
    await contexto.close()
  }

  // Controle positivo: a mesma requisição enviada pelo admin grava; a recusa acima é de autorização.
  await page.request.post(requisicao.url(), envio)
  await expect.poll(() => estadoDePresencaNoBanco(issue4.id, 'v1.4.0')).toBe('CONFIRMACAO_MANUAL')
})
