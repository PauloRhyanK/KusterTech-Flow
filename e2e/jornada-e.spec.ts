import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  contarExecucoes,
  arquivarProjetoNoBanco,
  criarClienteNoBanco,
  criarProjetoNoBanco,
  criarUsuarioNoBanco,
  definirLeituraWarren,
  limparExecucoesDosRepositoriosNoBanco,
  liberarRepositoriosNoBanco,
  nomeDeTeste,
  obterExecucaoNoBanco,
  repositorioDeAgentesE2E,
  runDeExemploE2E,
  vincularNoBanco,
} from './support/banco'
import { rodarWorkerUmaVez } from './support/worker'

const MOTIVO_DE_24H =
  'Sem sinal desta execução há mais de 24 h; o Warren não informa se ela terminou.'
const MOTIVO_DE_CONCLUIDA =
  'O Warren abriu a PR desta execução. Isso não indica PR aprovada, CI verde nem issue fechada.'
const AVISO_DE_CONCLUIDA =
  'Execução concluída não significa PR aprovada, CI verde nem issue fechada.'

function obterAdmin(): { email: string; senha: string } {
  const { E2E_ADMIN_EMAIL: email, E2E_ADMIN_SENHA: senha } = process.env
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

async function semRolagemHorizontal(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
}

async function filtrar(
  page: Page,
  filtros: { projeto?: string; situacao?: string; origem?: string },
): Promise<void> {
  if (filtros.projeto)
    await page.getByLabel('Projeto', { exact: true }).selectOption({ label: filtros.projeto })
  if (filtros.situacao)
    await page.getByLabel('Situação', { exact: true }).selectOption({ label: filtros.situacao })
  if (filtros.origem)
    await page.getByLabel('Origem', { exact: true }).selectOption({ label: filtros.origem })
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await page.waitForLoadState('networkidle')
}

const projetosDoTeste: string[] = []

async function prepararProjeto(projectName: string): Promise<{ id: string; nome: string }> {
  const repositorio = repositorioDeAgentesE2E(projectName)
  const nome = nomeDeTeste('Jornada E')
  const projeto = await criarProjetoNoBanco(nome)
  projetosDoTeste.push(projeto.id)
  await vincularNoBanco(projeto.id, repositorio)
  rodarWorkerUmaVez()
  return { id: projeto.id, nome }
}

test.beforeEach(async ({}, testInfo) => {
  const repositorio = repositorioDeAgentesE2E(testInfo.project.name)
  await liberarRepositoriosNoBanco([repositorio])
  await limparExecucoesDosRepositoriosNoBanco([repositorio])
})

// Estado compartilhado: o projeto de teste não pode continuar ativo (a Visão Geral o contaria
// como configuração pendente) nem prender o repositório de fixture.
test.afterEach(async ({}, testInfo) => {
  for (const id of projetosDoTeste.splice(0)) await arquivarProjetoNoBanco(id)
  await liberarRepositoriosNoBanco([repositorioDeAgentesE2E(testInfo.project.name)])
})

test('admin acompanha o desenvolvimento: filtra, vê a intervenção, expande a seed e abre a execução concluída com a issue aberta', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const nomeDoProjeto = testInfo.project.name
  const mobile = nomeDoProjeto === 'mobile'
  const projeto = await prepararProjeto(nomeDoProjeto)
  const run1 = runDeExemploE2E(nomeDoProjeto, 1)
  const run3 = runDeExemploE2E(nomeDoProjeto, 3)

  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  // 1. Menu → Central de Desenvolvimento.
  if (mobile) {
    await page.getByRole('button', { name: 'Abrir navegação' }).click()
    await page.getByRole('dialog').getByRole('link', { name: 'Central de Desenvolvimento' }).click()
  } else {
    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('link', { name: 'Central de Desenvolvimento' })
      .click()
  }
  await expect(
    page.getByRole('heading', { level: 1, name: 'Central de Desenvolvimento' }),
  ).toBeVisible()
  await capturar(page, nomeDoProjeto, 'jornada-e-1-fila.png')

  // 2. Projeto do teste, situação "Em aberto": PR #3 primeiro, run 3, PR #5 e issue #1.
  await filtrar(page, { projeto: projeto.nome, situacao: 'Em aberto' })
  const fila = page.getByRole('list', { name: 'Fila de desenvolvimento' })
  const itens = fila.getByRole('listitem')
  await expect(itens).toHaveCount(4)
  await expect(itens.first()).toContainText('PR #3')
  await expect(itens.first()).toContainText('Checks com falha no GitHub.')
  await expect(itens.filter({ hasText: 'EXEM-a003' })).toContainText('Sem dados')
  await expect(itens.filter({ hasText: 'EXEM-a003' })).toContainText(MOTIVO_DE_24H)
  await expect(itens.filter({ hasText: 'PR #5' })).toHaveCount(1)
  await expect(itens.filter({ hasText: 'Issue #1' })).toHaveCount(1)

  // 3. "Requer intervenção" tem só a PR #3; Warren + Todos mostra as 3 execuções.
  await filtrar(page, { situacao: 'Requer intervenção' })
  await expect(fila.getByRole('listitem')).toHaveCount(1)
  await expect(fila.getByRole('listitem').first()).toContainText('PR #3')

  await filtrar(page, { situacao: 'Todos', origem: 'Warren' })
  await expect(fila.getByRole('listitem')).toHaveCount(3)
  await expect(fila.getByRole('listitem').filter({ hasText: 'Concluída' })).toHaveCount(2)
  await capturar(page, nomeDoProjeto, 'jornada-e-2-intervencao.png')
  if (mobile) expect(await semRolagemHorizontal(page)).toBe(true)

  // 4. Por projeto e issue: expande EXEM-a001; EXEM-a004 mostra a dependência.
  await page.getByRole('link', { name: 'Por projeto e issue' }).click()
  await expect(page).toHaveURL(/visao=execucoes/)
  await filtrar(page, { projeto: projeto.nome })
  const agrupada = page.getByRole('region', { name: 'Execuções por projeto e issue' })
  await expect(agrupada.getByRole('heading', { level: 2, name: projeto.nome })).toBeVisible()
  await expect(agrupada.getByText('Aguarda EXEM-a003 (em andamento).')).toBeVisible()
  await expect(page.getByText('Sem dados').first()).toBeVisible()
  await agrupada.locator('summary', { hasText: 'EXEM-a001' }).click()
  const execucoesDaSeed = agrupada.getByRole('list', { name: 'Execuções de EXEM-a001' })
  await expect(execucoesDaSeed).toContainText(run1)
  await expect(execucoesDaSeed).toContainText('Concluída')
  await capturar(page, nomeDoProjeto, 'jornada-e-3-agrupada.png')
  if (mobile) expect(await semRolagemHorizontal(page)).toBe(true)

  // 5. Execução concluída: PR aberta com falha, issue aberta e seed em andamento.
  await execucoesDaSeed.getByRole('link', { name: 'Abrir execução' }).click()
  await expect(page.getByRole('heading', { level: 1, name: run1 })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  const estadoAtual = page.getByRole('region', { name: 'Estado atual' })
  await expect(estadoAtual).toContainText('Concluída')
  await expect(estadoAtual).toContainText(AVISO_DE_CONCLUIDA)
  const pr = page.getByRole('region', { name: 'Pull request' })
  await expect(pr).toContainText('Aberto')
  await expect(pr).toContainText('Falha')
  await expect(page.getByRole('region', { name: 'Issue no GitHub' })).toContainText('Aberta')
  await expect(page.getByRole('region', { name: 'Seed' })).toContainText('Em andamento')
  // O motivo e o aviso obrigatórios da invariante 9 negam "aprovada"; fora dele, nenhum texto afirma entrega.
  const texto = (await page.locator('main').innerText())
    .replace(MOTIVO_DE_CONCLUIDA, '')
    .replace(AVISO_DE_CONCLUIDA, '')
    .toLowerCase()
  expect(texto).not.toMatch(/\d+\s?%/)
  expect(texto).not.toContain('aprovad')
  expect(texto).not.toContain('entregue')
  // O corpo do PR nunca é renderizado: nem o prompt, nem o run falso, nem o HTML.
  expect(texto).not.toContain('run_falso999')
  expect(await page.locator('main script').count()).toBe(0)
  await capturar(page, nomeDoProjeto, 'jornada-e-4-execucao.png')
  if (mobile) expect(await semRolagemHorizontal(page)).toBe(true)

  // 6. Link da issue #1 → a issue continua aberta na página da issue.
  await page
    .getByRole('region', { name: 'Issue no GitHub' })
    .getByRole('link', { name: /#1 ·/ })
    .click()
  await expect(page).toHaveURL(new RegExp(`/projetos/${projeto.id}/entregas/issues/`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByText('Aberta', { exact: true }).first()).toBeVisible()
  await capturar(page, nomeDoProjeto, 'jornada-e-5-issue.png')

  expect((await obterExecucaoNoBanco(run1)).estado).toBe('CONCLUIDA')
  expect((await obterExecucaoNoBanco(run3)).estado).toBe('SEM_DADOS')
})

test('leitura do Warren com falha mostra "Não foi possível ler os dados do Warren em 1 repositório(s)." e mantém as execuções', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const nomeDoProjeto = testInfo.project.name
  const projeto = await prepararProjeto(nomeDoProjeto)
  const antes = await contarExecucoes()

  await definirLeituraWarren(repositorioDeAgentesE2E(nomeDoProjeto), {
    warrenFalhaEm: new Date(Date.now() + 60_000),
    warrenFalhaMotivo: 'Falha temporária ao ler os dados do Warren.',
  })

  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
  await page.goto('/desenvolvimento?situacao=todos&origem=warren')
  await filtrar(page, { projeto: projeto.nome })

  await expect(
    page.getByText('Não foi possível ler os dados do Warren em 1 repositório(s).'),
  ).toBeVisible()
  await expect(page.getByText(/Mostrando as execuções lidas em/)).toBeVisible()
  await expect(
    page.getByRole('list', { name: 'Fila de desenvolvimento' }).getByRole('listitem'),
  ).toHaveCount(3)
  expect(await contarExecucoes()).toBe(antes)
})

test('aprovador global e testador escopado veem "Sem permissão" em /desenvolvimento e na execução; contarExecucoes inalterado', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const nomeDoProjeto = testInfo.project.name
  await prepararProjeto(nomeDoProjeto)
  const execucao = await obterExecucaoNoBanco(runDeExemploE2E(nomeDoProjeto, 1))
  const antes = await contarExecucoes()

  const sufixo = Math.random().toString(36).slice(2, 8)
  const senha = `Senha-${sufixo}-Segura1`
  const emailAprovador = `aprovador-e-${nomeDoProjeto}-${sufixo}@exemplo.test`
  const emailTestador = `testador-e-${nomeDoProjeto}-${sufixo}@exemplo.test`
  const cliente = await criarClienteNoBanco(nomeDeTeste('Cliente Jornada E'))
  await criarUsuarioNoBanco({
    email: emailAprovador,
    nome: 'Aprovador Jornada E',
    senha,
    papel: 'APROVADOR',
  })
  await criarUsuarioNoBanco({
    email: emailTestador,
    nome: 'Testador Jornada E',
    senha,
    papel: 'TESTADOR',
    clienteId: cliente.id,
  })

  // O admin vê a página: controle positivo da recusa abaixo.
  const { email, senha: senhaAdmin } = obterAdmin()
  await fazerLogin(page, email, senhaAdmin)
  await page.goto(`/desenvolvimento/execucoes/${execucao.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    runDeExemploE2E(nomeDoProjeto, 1),
  )

  for (const emailDoUsuario of [emailAprovador, emailTestador]) {
    const contexto = await browser.newContext()
    try {
      const pagina = await contexto.newPage()
      await fazerLogin(pagina, emailDoUsuario, senha)
      for (const url of ['/desenvolvimento', `/desenvolvimento/execucoes/${execucao.id}`]) {
        await pagina.goto(url)
        await expect(pagina.getByText('Sem permissão para esta área.')).toBeVisible()
        await expect(pagina.getByRole('list', { name: 'Fila de desenvolvimento' })).toHaveCount(0)
        await expect(pagina.getByText('Linha do tempo')).toHaveCount(0)
      }
    } finally {
      await contexto.close()
    }
  }

  expect(await contarExecucoes()).toBe(antes)
})
