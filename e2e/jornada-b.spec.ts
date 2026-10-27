import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import {
  configurarAmbientesNoBanco,
  criarClienteNoBanco,
  criarProjetoNoBanco,
  criarUsuarioNoBanco,
  liberarRepositoriosNoBanco,
  limparImplantacaoDosRepositoriosNoBanco,
  limparVinculosDeIssuesNoBanco,
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

async function capturar(page: Page, projeto: string, nomeArquivo: string): Promise<void> {
  const caminho = path.join('e2e', 'capturas', projeto, nomeArquivo)
  fs.mkdirSync(path.dirname(caminho), { recursive: true })
  await page.screenshot({ path: caminho, fullPage: true })
}

async function semRolagemHorizontal(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  )
}

test.beforeEach(async ({}, testInfo) => {
  const repositorios = repositoriosDoProjetoE2E(testInfo.project.name)
  await liberarRepositoriosNoBanco(repositorios)
  await limparVinculosDeIssuesNoBanco(repositorios)
  await limparImplantacaoDosRepositoriosNoBanco(repositorios)
})

test('Jornada B de ponta a ponta: milestone, issues, correção, contexto de Acme com ida e volta e isolamento de Beta', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const { email, senha } = obterAdmin()
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(testInfo.project.name)
  const [nomeUm, nomeDois] = [repoUm, repoDois].map((r) => r.split('/')[1] as string)

  const acme = await criarClienteNoBanco(nomeDeTeste('Acme'))
  const beta = await criarClienteNoBanco(nomeDeTeste('Beta'))
  const nomeProjeto = nomeDeTeste('Projeto Jornada B')
  const projeto = await criarProjetoNoBanco(nomeProjeto, [acme.id, beta.id])
  await vincularNoBanco(projeto.id, repoUm)
  await vincularNoBanco(projeto.id, repoDois)
  rodarWorkerUmaVez()

  const capturaDe = (nome: string, pagina: Page = page) =>
    capturar(pagina, testInfo.project.name, nome)
  const emailTestadorBeta = `e2e+testador-beta-${Date.now()}@local.test`
  const senhaTestador = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email: emailTestadorBeta,
    nome: 'Testador Beta',
    senha: senhaTestador,
    papel: 'TESTADOR',
    clienteId: beta.id,
  })

  await fazerLogin(page, email, senha)
  let milestoneId = ''
  let issueTresId = ''
  const baseAcme = `/clientes/${acme.id}/projetos/${projeto.id}`

  // 1. Admin: projeto → Entregas vazia → nova milestone com prazo e cliente Acme
  await test.step('1. Admin abre Entregas vazia e cria "Entrega de novembro" para Acme', async () => {
    await page.goto('/projetos')
    // Nomes de teste são longos: clica no início do link, que a coluna de contexto não cobre.
    await page.getByRole('link', { name: nomeProjeto }).click({ position: { x: 4, y: 4 } })
    await expect(page).toHaveURL(`/projetos/${projeto.id}`)
    await page
      .getByRole('navigation', { name: 'Seções do projeto' })
      .getByRole('link', { name: 'Entregas' })
      .click()
    await expect(page).toHaveURL(`/projetos/${projeto.id}/entregas`)
    await expect(page.getByText('Nenhuma milestone criada.')).toBeVisible()
    await capturaDe('b1-admin-entregas-vazia.png')

    await page.getByText('Nova milestone', { exact: true }).click()
    await page.getByLabel('Título').fill('Entrega de novembro')
    await page.getByLabel('Prazo').fill('2026-11-30')
    await page.getByRole('checkbox', { name: acme.nome }).check()
    await page.getByRole('button', { name: 'Criar milestone' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Entrega de novembro' })).toBeVisible()
    await expect(page.getByText('Nenhuma issue vinculada').first()).toBeVisible()
    milestoneId = page.url().match(/\/milestones\/([0-9a-fA-F-]+)/)?.[1] ?? ''
    expect(milestoneId).not.toBe('')
  })

  // 2. Adiciona #1 e #4 de repoUm e #1 de repoDois
  await test.step('2. Admin adiciona três issues de dois repositórios', async () => {
    await page.getByText('Adicionar issues', { exact: true }).click()
    await page.getByRole('checkbox', { name: `#1 Item 1 de ${nomeUm} (${repoUm})` }).check()
    await page.getByRole('checkbox', { name: `#4 Item 4 de ${nomeUm} (${repoUm})` }).check()
    await page.getByRole('checkbox', { name: `#1 Item 1 de ${nomeDois} (${repoDois})` }).check()
    await page.getByRole('button', { name: 'Adicionar à milestone' }).click()
    await expect(page.getByText('3 issues adicionadas.')).toBeVisible()
    await expect(page.getByText('1 de 3 issues fechadas · 33%').first()).toBeVisible()
    expect(await semRolagemHorizontal(page)).toBe(true)
    await capturaDe('b2-admin-milestone-issues.png')
  })

  // 3. Issues sem milestone → #3 de repoDois registra a correção de repoUm #1
  await test.step('3. Admin registra #3 de repoDois como correção de #1 de repoUm', async () => {
    await page
      .getByRole('navigation', { name: 'Trilha de navegação' })
      .getByRole('link', { name: 'Entregas', exact: true })
      .click()
    const semMilestone = page.getByRole('list', { name: 'Issues sem milestone' })
    await expect(semMilestone.getByRole('listitem')).toHaveCount(4)
    await semMilestone.getByRole('link', { name: new RegExp(`#3 Item 3 de ${nomeDois}`) }).click()
    issueTresId = (await obterIssueNoBanco(repoDois, 3)).id
    await expect(page).toHaveURL(`/projetos/${projeto.id}/entregas/issues/${issueTresId}`)

    await page.getByLabel('Repositório').selectOption({ label: repoUm })
    await page.getByLabel('Número').fill('1')
    await page.getByRole('button', { name: 'Registrar correção' }).click()
    await expect(
      page.getByText('Correção registrada. A issue entrou em 1 milestone da original.'),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Corrige', exact: true })).toBeVisible()
    await expect(page.getByText(`#1 Item 1 de ${nomeUm}`).first()).toBeVisible()
    await capturaDe('b3-admin-issue-correcao.png')
  })

  // 4. Entregas → milestone 1 de 4 → #4 fechada, GitHub ≠ QA → Homologação
  await test.step('4. Admin vê 1 de 4, #4 fechada sem evidência de versão e a aba Homologação', async () => {
    await page
      .getByRole('navigation', { name: 'Trilha de navegação' })
      .getByRole('link', { name: 'Entregas', exact: true })
      .click()
    const linha = page
      .getByRole('list', { name: 'Milestones' })
      .getByRole('listitem')
      .filter({ hasText: 'Entrega de novembro' })
    await expect(linha.getByText('1 de 4 issues fechadas · 25%')).toBeVisible()
    await linha.getByRole('link', { name: 'Entrega de novembro' }).click()

    await page
      .getByRole('list', { name: 'Issues da milestone' })
      .getByRole('link', { name: new RegExp(`#4 Item 4 de ${nomeUm}`) })
      .click()
    await expect(page.getByText('Fechada').first()).toBeVisible()
    await expect(page.getByText('Ambientes não configurados.')).toBeVisible()

    await page.goto(`/projetos/${projeto.id}/entregas/milestones/${milestoneId}?aba=homologacao`)
    await expect(page.getByText('Ambientes não configurados.')).toBeVisible()
    await capturaDe('b4-admin-milestone-homologacao.png')
  })

  // 5. A01: Clientes → Acme → projeto → Entregas → milestone → issue e volta pela trilha
  await test.step('5. A01: Acme navega até a issue e volta pela trilha mantendo o contexto', async () => {
    await page.goto('/clientes')
    await page.getByRole('link', { name: acme.nome }).click()
    // Nomes de teste são longos: clica no início do link, que a coluna de contexto não cobre.
    await page.getByRole('link', { name: nomeProjeto }).click({ position: { x: 4, y: 4 } })
    await page
      .getByRole('navigation', { name: 'Seções do projeto' })
      .getByRole('link', { name: 'Entregas' })
      .click()
    await expect(page).toHaveURL(`${baseAcme}/entregas`)
    const milestones = page.getByRole('list', { name: 'Milestones' })
    await expect(milestones.getByRole('listitem')).toHaveCount(1)
    await expect(milestones.getByRole('link', { name: 'Entrega de novembro' })).toBeVisible()
    expect(await semRolagemHorizontal(page)).toBe(true)
    await capturaDe('b5-acme-entregas.png')

    await milestones.getByRole('link', { name: 'Entrega de novembro' }).click()
    await expect(page).toHaveURL(`${baseAcme}/entregas/milestones/${milestoneId}`)
    await capturaDe('b6-acme-milestone.png')

    await page
      .getByRole('list', { name: 'Issues da milestone' })
      .getByRole('link', { name: new RegExp(`#3 Item 3 de ${nomeDois}`) })
      .click()
    await expect(page).toHaveURL(
      `${baseAcme}/entregas/issues/${issueTresId}?milestone=${milestoneId}`,
    )
    const trilha = page.getByRole('navigation', { name: 'Trilha de navegação' })
    await expect(trilha.getByRole('link')).toHaveCount(5)
    await expect(trilha.getByText('#3')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Pull requests' })).toHaveCount(0)
    expect(await semRolagemHorizontal(page)).toBe(true)
    await capturaDe('b7-acme-issue.png')

    const trilhaDaPagina = () => page.getByRole('navigation', { name: 'Trilha de navegação' })
    const noContextoDeAcme = () =>
      expect(new URL(page.url()).pathname.startsWith(`/clientes/${acme.id}`)).toBe(true)

    await trilhaDaPagina().getByRole('link', { name: 'Entrega de novembro', exact: true }).click()
    await expect(page).toHaveURL(`${baseAcme}/entregas/milestones/${milestoneId}`)
    noContextoDeAcme()

    await trilhaDaPagina().getByRole('link', { name: 'Entregas', exact: true }).click()
    await expect(page).toHaveURL(`${baseAcme}/entregas`)
    noContextoDeAcme()

    // Nas páginas com abas o projeto é a página atual (último item da trilha, sem link):
    // o nível do projeto é a aba Resumo, que também preserva o contexto do cliente.
    await page
      .getByRole('navigation', { name: 'Seções do projeto' })
      .getByRole('link', { name: 'Resumo' })
      .click()
    await expect(page).toHaveURL(baseAcme)
    noContextoDeAcme()

    await trilhaDaPagina().getByRole('link', { name: acme.nome, exact: true }).click()
    await expect(page).toHaveURL(`/clientes/${acme.id}`)
  })

  // 6. Ambientes configurados e worker: coluna QA da milestone e presença na issue (A04, UX-06, UX-07)
  await test.step('6. Com DEV, QA e PROD e o worker, QA mostra #2 "Presença confirmada" e #4 "Verificação necessária", em ambos os contextos e sem SHA para Acme', async () => {
    const issueDois = await obterIssueNoBanco(repoUm, 2)
    const issueQuatro = await obterIssueNoBanco(repoUm, 4)
    await vincularIssuesNoBanco(milestoneId, [issueDois.id])
    await configurarAmbientesNoBanco(projeto.id)
    rodarWorkerUmaVez()

    const linhaDe = (pagina: Page, titulo: string) =>
      pagina
        .getByRole('list', { name: 'Issues da milestone' })
        .getByRole('listitem')
        .filter({ hasText: titulo })
    const qaDaIssue = (pagina: Page) =>
      pagina
        .getByRole('list', { name: 'Presença por ambiente' })
        .getByRole('listitem')
        .filter({ hasText: /^QA/ })
    // SHAs das versões das fixtures de repoUm (n + 'c'|'d'|'e'|'f' × 39): nenhum aparece para o cliente.
    const prefixosDeSha = ['d', 'e', 'f'].map(
      (c) => `${repoUm.endsWith('/portal') ? 1 : 3}${c.repeat(7)}`,
    )

    // Visão global
    await page.goto(`/projetos/${projeto.id}/entregas/milestones/${milestoneId}`)
    await expect(linhaDe(page, `#2 Item 2 de ${nomeUm}`)).toContainText('QA:')
    await expect(linhaDe(page, `#2 Item 2 de ${nomeUm}`)).toContainText('Presença confirmada')
    await expect(linhaDe(page, `#4 Item 4 de ${nomeUm}`)).toContainText('Verificação necessária')
    await capturaDe('b6-admin-milestone-qa.png')

    await page.goto(`/projetos/${projeto.id}/entregas/issues/${issueQuatro.id}`)
    await expect(page.getByText('Fechada').first()).toBeVisible()
    await expect(qaDaIssue(page)).toContainText('Verificação necessária')
    await expect(qaDaIssue(page)).not.toContainText('Presença confirmada')
    await capturaDe('b6-admin-issue-presenca.png')

    // Contexto de Acme: mesmos estados, sem SHA
    await page.goto(`${baseAcme}/entregas/milestones/${milestoneId}`)
    await expect(linhaDe(page, `#2 Item 2 de ${nomeUm}`)).toContainText('Presença confirmada')
    await expect(linhaDe(page, `#4 Item 4 de ${nomeUm}`)).toContainText('Verificação necessária')
    await page.goto(`${baseAcme}/entregas/issues/${issueQuatro.id}?milestone=${milestoneId}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(qaDaIssue(page)).toContainText('Verificação necessária')
    await expect(qaDaIssue(page)).not.toContainText('Presença confirmada')
    const texto = (await page.getByRole('main').textContent()) ?? ''
    for (const prefixo of prefixosDeSha) {
      expect(texto).not.toContain(prefixo)
    }
    expect(await semRolagemHorizontal(page)).toBe(true)
    await capturaDe('b6-cliente-issue-presenca.png')
  })

  // 7. Beta não tem milestone nem enxerga a issue de Acme
  await test.step('7. Beta não vê a milestone de Acme nem a issue #3', async () => {
    await page.goto(`/clientes/${beta.id}/projetos/${projeto.id}/entregas`)
    await expect(page.getByText('Nenhuma milestone associada a este cliente.')).toBeVisible()
    await page.goto(`/clientes/${beta.id}/projetos/${projeto.id}/entregas/issues/${issueTresId}`)
    await expect(page.getByText('Registro não encontrado')).toBeVisible()
  })

  // 8. Testador escopado a Beta não lê Acme nem a visão global
  const testador = { contexto: null as BrowserContext | null }
  try {
    await test.step('8. Testador de Beta recebe "Sem permissão para esta área." em Acme e na visão global', async () => {
      testador.contexto = await browser.newContext()
      const paginaTestador = await testador.contexto.newPage()
      await fazerLogin(paginaTestador, emailTestadorBeta, senhaTestador)

      await paginaTestador.goto(`${baseAcme}/entregas`)
      await expect(
        paginaTestador.getByRole('status').filter({ hasText: 'Sem permissão para esta área.' }),
      ).toBeVisible()
      expect(await semRolagemHorizontal(paginaTestador)).toBe(true)
      await capturaDe('b8-testador-beta-sem-permissao.png', paginaTestador)

      await paginaTestador.goto(`/projetos/${projeto.id}/entregas/milestones/${milestoneId}`)
      await expect(
        paginaTestador.getByRole('status').filter({ hasText: 'Sem permissão para esta área.' }),
      ).toBeVisible()
      await expect(paginaTestador.getByText('Entrega de novembro')).toHaveCount(0)
    })
  } finally {
    if (testador.contexto) {
      await testador.contexto.close()
    }
  }
})
