import { expect, test, type Page } from '@playwright/test'
import {
  contarMilestones,
  criarClienteNoBanco,
  criarMilestoneNoBanco,
  criarProjetoNoBanco,
  criarUsuarioNoBanco,
  desvincularIssuesNoBanco,
  liberarRepositoriosNoBanco,
  limparVinculosDeIssuesNoBanco,
  nomeDeTeste,
  obterMilestoneIssueNoBanco,
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

async function semRolagemHorizontal(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
}

// Clientes A e B associados ao projeto, repositórios vinculados e sincronizados.
async function prepararCenario(projectName: string) {
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(projectName)
  const clienteA = await criarClienteNoBanco(nomeDeTeste('Cliente A'))
  const clienteB = await criarClienteNoBanco(nomeDeTeste('Cliente B'))
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Milestones'), [
    clienteA.id,
    clienteB.id,
  ])
  await vincularNoBanco(projeto.id, repoUm)
  await vincularNoBanco(projeto.id, repoDois)
  rodarWorkerUmaVez()
  return { repoUm, repoDois, clienteA, clienteB, projeto }
}

async function issuesDe(repoUm: string, repoDois: string) {
  return {
    um1: (await obterIssueNoBanco(repoUm, 1)).id,
    um4: (await obterIssueNoBanco(repoUm, 4)).id,
    dois1: (await obterIssueNoBanco(repoDois, 1)).id,
  }
}

test.beforeEach(async ({}, testInfo) => {
  const repositorios = repositoriosDoProjetoE2E(testInfo.project.name)
  await liberarRepositoriosNoBanco(repositorios)
  await limparVinculosDeIssuesNoBanco(repositorios)
})

test('admin cria pela tela a milestone com prazo 2026-11-30 e cliente A, adiciona #1 e #4 de repoUm e #1 de repoDois: lista e detalhe mostram "1 de 3 issues fechadas · 33%" e progressbar 33; "Issues sem milestone" fica com 4; mobile sem rolagem horizontal', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { repoUm, repoDois, clienteA, projeto } = await prepararCenario(testInfo.project.name)
  const [nomeUm, nomeDois] = [repoUm, repoDois].map((r) => r.split('/')[1] as string)

  await page.goto(`/projetos/${projeto.id}/entregas?nova=1`)
  await page.getByLabel('Título').fill('Entrega 1')
  await page.getByLabel('Prazo').fill('2026-11-30')
  await page.getByRole('checkbox', { name: clienteA.nome }).check()
  await page.getByRole('button', { name: 'Criar milestone' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Entrega 1' })).toBeVisible()
  await expect(page.getByText('Nenhuma issue vinculada a esta milestone.')).toBeVisible()

  await page.getByText('Adicionar issues', { exact: true }).click()
  await page.getByRole('checkbox', { name: `#1 Item 1 de ${nomeUm} (${repoUm})` }).check()
  await page.getByRole('checkbox', { name: `#4 Item 4 de ${nomeUm} (${repoUm})` }).check()
  await page.getByRole('checkbox', { name: `#1 Item 1 de ${nomeDois} (${repoDois})` }).check()
  await page.getByRole('button', { name: 'Adicionar à milestone' }).click()
  await expect(page.getByText('3 issues adicionadas.')).toBeVisible()

  await expect(page.getByText('1 de 3 issues fechadas · 33%').first()).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33')
  await expect(page.getByRole('term').filter({ hasText: 'Prazo' })).toBeVisible()
  await expect(page.getByText('30/11/2026')).toBeVisible()
  await expect(
    page.getByRole('list', { name: 'Issues da milestone' }).getByRole('listitem'),
  ).toHaveCount(3)
  expect(await semRolagemHorizontal(page)).toBe(true)

  await page.goto(`/projetos/${projeto.id}/entregas`)
  const milestones = page.getByRole('list', { name: 'Milestones' })
  await expect(milestones.getByRole('link', { name: 'Entrega 1' })).toBeVisible()
  await expect(milestones.getByText(`Prazo 30/11/2026 · ${clienteA.nome}`)).toBeVisible()
  await expect(milestones.getByText('1 de 3 issues fechadas · 33%')).toBeVisible()
  await expect(milestones.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33')
  await expect(
    page.getByRole('list', { name: 'Issues sem milestone' }).getByRole('listitem'),
  ).toHaveCount(4)
  expect(await semRolagemHorizontal(page)).toBe(true)
})

test('aba Issues: Abertas → 2, Fechadas → 1, Todas + repositório repoDois → 1; remover #1 de repoUm pede confirmação e o progresso vai a "1 de 2 issues fechadas · 50%"', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { repoUm, repoDois, clienteA, projeto } = await prepararCenario(testInfo.project.name)
  const nomeUm = repoUm.split('/')[1] as string
  const milestone = await criarMilestoneNoBanco(projeto.id, 'Entrega 1', [clienteA.id])
  const { um1, um4, dois1 } = await issuesDe(repoUm, repoDois)
  await vincularIssuesNoBanco(milestone.id, [um1, um4, dois1])

  await page.goto(`/projetos/${projeto.id}/entregas/milestones/${milestone.id}`)
  const lista = page.getByRole('list', { name: 'Issues da milestone' })
  await expect(lista.getByRole('listitem')).toHaveCount(3)

  await page.getByLabel('Situação').selectOption({ label: 'Abertas' })
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect(lista.getByRole('listitem')).toHaveCount(2)
  // O progresso ignora os filtros.
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33')

  await page.getByLabel('Situação').selectOption({ label: 'Fechadas' })
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect(lista.getByRole('listitem')).toHaveCount(1)

  await page.getByLabel('Situação').selectOption({ label: 'Todas' })
  await page.getByLabel('Repositório', { exact: true }).selectOption({ label: repoDois })
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect(lista.getByRole('listitem')).toHaveCount(1)

  await page.goto(`/projetos/${projeto.id}/entregas/milestones/${milestone.id}`)
  const linha = lista.getByRole('listitem').filter({ hasText: `#1 Item 1 de ${nomeUm}` })
  await linha.getByRole('button', { name: 'Remover' }).click()
  await expect(lista.getByRole('listitem')).toHaveCount(3)
  await linha.getByRole('button', { name: 'Confirmar remoção' }).click()
  await expect(lista.getByRole('listitem')).toHaveCount(2)
  await expect(page.getByText('1 de 2 issues fechadas · 50%').first()).toBeVisible()
})

test('aba Homologação mostra "Ambientes não configurados." com "Configurar ambientes" na global e sem o link no contexto de A', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { clienteA, projeto } = await prepararCenario(testInfo.project.name)
  const milestone = await criarMilestoneNoBanco(projeto.id, 'Entrega 1', [clienteA.id])

  await page.goto(`/projetos/${projeto.id}/entregas/milestones/${milestone.id}?aba=homologacao`)
  await expect(page.getByText('Ambientes não configurados.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Configurar ambientes' })).toHaveAttribute(
    'href',
    `/projetos/${projeto.id}/configuracao#ambientes`,
  )
  await expect(page.getByRole('link', { name: 'Homologação' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

  await page.goto(
    `/clientes/${clienteA.id}/projetos/${projeto.id}/entregas/milestones/${milestone.id}?aba=homologacao`,
  )
  await expect(page.getByText('Ambientes não configurados.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Configurar ambientes' })).toHaveCount(0)
  await expect(
    page.getByText(`Você está vendo esta milestone no contexto de ${clienteA.nome}.`),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ver na visão global' })).toBeVisible()
})

test('contexto de A lista só a milestone de A, sem "Issues sem milestone"; contexto de B mostra "Nenhuma milestone associada a este cliente."', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { repoUm, repoDois, clienteA, clienteB, projeto } = await prepararCenario(
    testInfo.project.name,
  )
  const milestone = await criarMilestoneNoBanco(projeto.id, 'Entrega A', [clienteA.id])
  const { um1 } = await issuesDe(repoUm, repoDois)
  await vincularIssuesNoBanco(milestone.id, [um1])

  await page.goto(`/clientes/${clienteA.id}/projetos/${projeto.id}/entregas`)
  const lista = page.getByRole('list', { name: 'Milestones' })
  await expect(lista.getByRole('link', { name: 'Entrega A' })).toHaveAttribute(
    'href',
    `/clientes/${clienteA.id}/projetos/${projeto.id}/entregas/milestones/${milestone.id}`,
  )
  await expect(page.getByText('Issues sem milestone')).toHaveCount(0)
  await expect(page.getByText(/Item \d de /)).toHaveCount(0)

  await page.goto(`/clientes/${clienteB.id}/projetos/${projeto.id}/entregas`)
  await expect(page.getByText('Nenhuma milestone associada a este cliente.')).toBeVisible()
  await expect(page.getByText('Entrega A')).toHaveCount(0)
})

test('testador de A: milestone global → "Sem permissão para esta área."; milestone de A no contexto de B → "Sem permissão para esta área."; POST forjado de "Adicionar à milestone" (capturado do admin e desfeito por desvincularIssuesNoBanco) não grava; o mesmo POST do admin grava', async ({
  page,
  browser,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { repoUm, repoDois, clienteA, clienteB, projeto } = await prepararCenario(
    testInfo.project.name,
  )
  const nomeUm = repoUm.split('/')[1] as string
  const milestone = await criarMilestoneNoBanco(projeto.id, 'Entrega A', [clienteA.id])
  const { um1 } = await issuesDe(repoUm, repoDois)

  const emailTestador = `e2e+testador-milestones-${Date.now()}@local.test`
  const senhaTestador = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email: emailTestador,
    nome: 'Testador Milestones',
    senha: senhaTestador,
    papel: 'TESTADOR',
    clienteId: clienteA.id,
  })

  // Captura o POST legítimo do admin.
  await page.goto(`/projetos/${projeto.id}/entregas/milestones/${milestone.id}`)
  await page.getByText('Adicionar issues', { exact: true }).click()
  await page.getByRole('checkbox', { name: `#1 Item 1 de ${nomeUm} (${repoUm})` }).check()
  const envio = page.waitForRequest(
    (r) => r.method() === 'POST' && r.headers()['next-action'] !== undefined,
  )
  await page.getByRole('button', { name: 'Adicionar à milestone' }).click()
  const requisicao = await envio
  await expect(page.getByText('1 issue adicionada.')).toBeVisible()
  const dados = {
    url: requisicao.url(),
    headers: {
      'next-action': requisicao.headers()['next-action'] as string,
      'content-type': requisicao.headers()['content-type'] as string,
    },
    corpo: requisicao.postDataBuffer() as Buffer,
  }
  await desvincularIssuesNoBanco(milestone.id)

  const contexto = await browser.newContext()
  try {
    const paginaTestador = await contexto.newPage()
    await fazerLogin(paginaTestador, emailTestador, senhaTestador)

    await paginaTestador.goto(`/projetos/${projeto.id}/entregas/milestones/${milestone.id}`)
    await expect(paginaTestador.getByText('Sem permissão para esta área.')).toBeVisible()
    await expect(paginaTestador.getByText('Entrega A')).toHaveCount(0)

    await paginaTestador.goto(
      `/clientes/${clienteB.id}/projetos/${projeto.id}/entregas/milestones/${milestone.id}`,
    )
    await expect(paginaTestador.getByText('Sem permissão para esta área.')).toBeVisible()
    await expect(paginaTestador.getByText('Entrega A')).toHaveCount(0)

    // POST forjado do testador: nada é gravado.
    await paginaTestador.request.post(dados.url, { headers: dados.headers, data: dados.corpo })
    await expect
      .poll(async () => (await contarMilestoneIssue(milestone.id, um1)) ?? 'nenhuma')
      .toBe('nenhuma')
  } finally {
    await contexto.close()
  }

  // O mesmo POST do admin grava.
  await page.request.post(dados.url, { headers: dados.headers, data: dados.corpo })
  await expect
    .poll(async () => (await contarMilestoneIssue(milestone.id, um1)) ?? 'nenhuma')
    .toBe('MANUAL')
  expect(await contarMilestones(projeto.id)).toBe(1)
})

async function contarMilestoneIssue(milestoneId: string, issueId: string): Promise<string | null> {
  const linha = await obterMilestoneIssueNoBanco(milestoneId, issueId)
  return linha ? linha.origem : null
}
