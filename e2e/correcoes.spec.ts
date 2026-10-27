import { expect, test, type Page } from '@playwright/test'
import {
  criarClienteNoBanco,
  criarMilestoneNoBanco,
  criarProjetoNoBanco,
  criarUsuarioNoBanco,
  liberarRepositoriosNoBanco,
  limparVinculosDeIssuesNoBanco,
  nomeDeTeste,
  obterIssueNoBanco,
  obterMilestoneIssueNoBanco,
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

// Milestone M do cliente A com #1 e #4 de repoUm e #1 de repoDois (1 de 3 fechadas).
async function prepararCenario(projectName: string) {
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(projectName)
  const clienteA = await criarClienteNoBanco(nomeDeTeste('Cliente A'))
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Correções'), [clienteA.id])
  await vincularNoBanco(projeto.id, repoUm)
  await vincularNoBanco(projeto.id, repoDois)
  rodarWorkerUmaVez()
  const milestone = await criarMilestoneNoBanco(projeto.id, 'Entrega M', [clienteA.id])
  const um1 = (await obterIssueNoBanco(repoUm, 1)).id
  const um4 = (await obterIssueNoBanco(repoUm, 4)).id
  const dois1 = (await obterIssueNoBanco(repoDois, 1)).id
  await vincularIssuesNoBanco(milestone.id, [um1, um4, dois1])
  const dois3 = (await obterIssueNoBanco(repoDois, 3)).id
  return { repoUm, repoDois, clienteA, projeto, milestone, um1, dois3 }
}

test.beforeEach(async ({}, testInfo) => {
  const repositorios = repositoriosDoProjetoE2E(testInfo.project.name)
  await liberarRepositoriosNoBanco(repositorios)
  await limparVinculosDeIssuesNoBanco(repositorios)
})

test('na issue #3 de repoDois, "Esta issue corrige" repoUm #1 → "Correção registrada. A issue entrou em 1 milestone da original."; M mostra #3 com "Correção herdada" e "1 de 4 issues fechadas · 25%"', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { repoUm, projeto, milestone, dois3 } = await prepararCenario(testInfo.project.name)

  await page.goto(`/projetos/${projeto.id}/entregas/issues/${dois3}`)
  await expect(
    page.getByRole('heading', { level: 2, name: 'Correções relacionadas' }),
  ).toBeVisible()
  await expect(page.getByText('Nenhuma correção relacionada.')).toBeVisible()
  await page.getByLabel('Repositório').selectOption({ label: repoUm })
  await page.getByLabel('Número').fill('1')
  await page.getByRole('button', { name: 'Registrar correção' }).click()
  await expect(
    page.getByText('Correção registrada. A issue entrou em 1 milestone da original.'),
  ).toBeVisible()

  await page.goto(`/projetos/${projeto.id}/entregas/milestones/${milestone.id}`)
  const lista = page.getByRole('list', { name: 'Issues da milestone' })
  await expect(lista.getByRole('listitem')).toHaveCount(4)
  await expect(lista.getByText('Correção herdada')).toHaveCount(1)
  await expect(page.getByText('1 de 4 issues fechadas · 25%').first()).toBeVisible()
})

test('marcar fora do escopo sem justificativa mostra "A justificativa é obrigatória." e nada muda no banco; com "Pertence à próxima entrega." a linha mostra "Fora do escopo" e o progresso volta a "1 de 3 issues fechadas · 33%"; "Voltar ao escopo" pede confirmação e volta a 25%', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { repoUm, projeto, milestone, dois3 } = await prepararCenario(testInfo.project.name)

  await page.goto(`/projetos/${projeto.id}/entregas/issues/${dois3}`)
  await page.getByLabel('Repositório').selectOption({ label: repoUm })
  await page.getByLabel('Número').fill('1')
  await page.getByRole('button', { name: 'Registrar correção' }).click()
  await expect(page.getByText(/Correção registrada\./)).toBeVisible()

  await page.goto(`/projetos/${projeto.id}/entregas/issues/${dois3}`)
  await page.getByLabel('Justificativa').fill('   ')
  await page.getByRole('button', { name: 'Marcar fora do escopo de Entrega M' }).click()
  await expect(page.getByText('A justificativa é obrigatória.')).toBeVisible()
  expect(await obterMilestoneIssueNoBanco(milestone.id, dois3)).toMatchObject({
    origem: 'HERANCA_CORRECAO',
    foraDoEscopo: false,
    justificativaForaDoEscopo: null,
  })

  await page.getByLabel('Justificativa').fill('Pertence à próxima entrega.')
  await page.getByRole('button', { name: 'Marcar fora do escopo de Entrega M' }).click()
  // A linha vira "fora do escopo" e o formulário dá lugar ao "Voltar ao escopo".
  await expect(page.getByText('Fora do escopo — Pertence à próxima entrega.')).toBeVisible()

  await page.goto(`/projetos/${projeto.id}/entregas/milestones/${milestone.id}`)
  const lista = page.getByRole('list', { name: 'Issues da milestone' })
  await expect(lista.getByText('Fora do escopo')).toBeVisible()
  await expect(page.getByText('1 de 3 issues fechadas · 33%').first()).toBeVisible()

  await page.goto(`/projetos/${projeto.id}/entregas/issues/${dois3}`)
  await expect(page.getByText('Fora do escopo — Pertence à próxima entrega.')).toBeVisible()
  await page.getByRole('button', { name: 'Voltar ao escopo' }).click()
  await page.getByRole('button', { name: 'Confirmar volta ao escopo' }).click()
  await expect(page.getByLabel('Justificativa')).toBeVisible({ timeout: 20_000 })

  await page.goto(`/projetos/${projeto.id}/entregas/milestones/${milestone.id}`)
  await expect(page.getByText('1 de 4 issues fechadas · 25%').first()).toBeVisible()
  expect(await obterMilestoneIssueNoBanco(milestone.id, dois3)).toMatchObject({
    foraDoEscopo: false,
    justificativaForaDoEscopo: null,
  })
})

test('contexto de A, aberta pela milestone: trilha Clientes › A › P › Entregas › M › #1 com todos os links em /clientes/<A>/…; lateral sem "Pull requests" e sem "Abrir no GitHub"; "Corrigida por" leva à #3 no contexto de A', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { repoUm, projeto, clienteA, milestone, um1, dois3 } = await prepararCenario(
    testInfo.project.name,
  )
  await page.goto(`/projetos/${projeto.id}/entregas/issues/${dois3}`)
  await page.getByLabel('Repositório').selectOption({ label: repoUm })
  await page.getByLabel('Número').fill('1')
  await page.getByRole('button', { name: 'Registrar correção' }).click()
  await expect(page.getByText(/Correção registrada\./)).toBeVisible()

  const nomeUm = repoUm.split('/')[1] as string
  const base = `/clientes/${clienteA.id}/projetos/${projeto.id}`
  await page.goto(`${base}/entregas/milestones/${milestone.id}`)
  await page
    .getByRole('list', { name: 'Issues da milestone' })
    .getByRole('link', { name: new RegExp(`#1 Item 1 de ${nomeUm}`) })
    .click()
  await expect(page).toHaveURL(new RegExp(`${base}/entregas/issues/${um1}\\?milestone=`))

  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  const trilha = page.getByRole('navigation', { name: 'Trilha de navegação' })
  await expect(trilha.getByRole('link')).toHaveCount(5)
  for (const link of await trilha.getByRole('link').all()) {
    expect(await link.getAttribute('href')).toMatch(/^\/clientes(\/|$)/)
  }
  await expect(trilha.getByRole('link', { name: 'Entregas' })).toHaveAttribute(
    'href',
    `${base}/entregas`,
  )
  await expect(trilha.getByRole('link', { name: 'Entrega M' })).toHaveAttribute(
    'href',
    `${base}/entregas/milestones/${milestone.id}`,
  )
  await expect(trilha.getByText('#1')).toBeVisible()

  await expect(page.getByRole('heading', { name: 'Pull requests' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Abrir no GitHub' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Milestones' })).toBeVisible()

  await page.getByRole('link', { name: /#3 Item 3 de/ }).click()
  await expect(page).toHaveURL(`${base}/entregas/issues/${dois3}`)
})

test('issue sem milestone de A no contexto de A → "Registro não encontrado"; testador de A vê a issue de M no contexto de A sem formulários de escopo nem de correção', async ({
  page,
  browser,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  const { projeto, clienteA, um1, dois3 } = await prepararCenario(testInfo.project.name)
  // #3 de repoDois não está em nenhuma milestone; vira correção herdada só depois do registro.
  const base = `/clientes/${clienteA.id}/projetos/${projeto.id}`
  await page.goto(`${base}/entregas/issues/${dois3}`)
  await expect(page.getByText('Registro não encontrado')).toBeVisible()

  const emailTestador = `e2e+testador-correcoes-${Date.now()}@local.test`
  const senhaTestador = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email: emailTestador,
    nome: 'Testador Correções',
    senha: senhaTestador,
    papel: 'TESTADOR',
    clienteId: clienteA.id,
  })

  const contexto = await browser.newContext()
  try {
    const paginaTestador = await contexto.newPage()
    await fazerLogin(paginaTestador, emailTestador, senhaTestador)
    await paginaTestador.goto(`${base}/entregas/issues/${um1}`)
    await expect(paginaTestador.getByRole('heading', { level: 1 })).toHaveText(/Item 1/)
    await expect(paginaTestador.getByRole('heading', { name: 'Milestones' })).toBeVisible()
    await expect(paginaTestador.getByRole('link', { name: 'Entrega M' })).toBeVisible()
    await expect(paginaTestador.getByRole('main').locator('form')).toHaveCount(0)
    await expect(paginaTestador.getByRole('button', { name: 'Registrar correção' })).toHaveCount(0)
    await expect(paginaTestador.getByRole('heading', { name: 'Pull requests' })).toHaveCount(0)
  } finally {
    await contexto.close()
  }
})
