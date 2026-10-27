import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import {
  liberarRepositoriosNoBanco,
  nomeDeTeste,
  obterIssueNoBanco,
  repositoriosDoProjetoE2E,
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

async function capturar(page: Page, testInfo: TestInfo, nomeArquivo: string): Promise<void> {
  const caminho = path.join('e2e', 'capturas', testInfo.project.name, nomeArquivo)
  fs.mkdirSync(path.dirname(caminho), { recursive: true })
  await page.screenshot({ path: caminho, fullPage: true })
}

test('Jornada A de ponta a ponta: cadastro, associação, contexto e escopo', async ({
  page,
  browser,
}, testInfo) => {
  const { email: adminEmail, senha: adminSenha } = obterAdmin()
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(testInfo.project.name)
  await liberarRepositoriosNoBanco([repoUm, repoDois])
  await fazerLogin(page, adminEmail, adminSenha)

  const nomeProjeto = nomeDeTeste('Portal do Cliente')
  const nomeAcme = nomeDeTeste('Acme')
  const nomeBeta = nomeDeTeste('Beta')
  const nomeTestador = nomeDeTeste('Testador Acme')
  const emailTestador = `e2e+testador-${Date.now()}@local.test`
  const senhaTestador = 'SenhaForte123!'

  let projetoId = ''
  let clienteAcmeId = ''
  let clienteBetaId = ''

  // 1. Admin entra, cria o projeto "Portal do Cliente" sem clientes e cai em /projetos/<p>/configuracao
  await test.step('1. Admin cria o projeto "Portal do Cliente" sem clientes e cai na configuração', async () => {
    await page.goto('/projetos/novo')
    await expect(page.getByRole('heading', { level: 1, name: 'Novo projeto' })).toBeVisible()

    await page.getByLabel('Nome').fill(nomeProjeto)
    await page.getByLabel('Descrição').fill('Painel unificado para clientes e projetos.')
    await page.getByRole('button', { name: 'Criar projeto' }).click()

    await expect(page).toHaveURL(/\/projetos\/[0-9a-fA-F-]+\/configuracao$/)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Configuração inicial' }),
    ).toBeVisible()
    await expect(page.getByText(nomeProjeto).first()).toBeVisible()

    const match = page.url().match(/\/projetos\/([0-9a-fA-F-]+)\/configuracao/)
    if (!match || !match[1]) {
      throw new Error('ID do projeto não encontrado na URL de configuração.')
    }
    projetoId = match[1]

    await capturar(page, testInfo, '1-admin-cria-projeto-configuracao.png')
  })

  // 2. Cria os clientes "Acme" e "Beta" em /clientes/novo
  await test.step('2. Cria os clientes "Acme" e "Beta" em /clientes/novo', async () => {
    // Cria Acme
    await page.goto('/clientes/novo')
    await expect(page.getByRole('heading', { level: 1, name: 'Novo cliente' })).toBeVisible()
    await page.getByLabel('Nome').fill(nomeAcme)
    await page.getByLabel('Observações').fill('Cliente Acme para jornada ponta a ponta.')
    await page.getByRole('button', { name: 'Criar cliente' }).click()

    await expect(page).toHaveURL(/\/clientes\/[0-9a-fA-F-]+$/)
    await expect(page.getByRole('heading', { level: 1, name: nomeAcme })).toBeVisible()
    const matchAcme = page.url().match(/\/clientes\/([0-9a-fA-F-]+)$/)
    if (!matchAcme || !matchAcme[1]) {
      throw new Error('ID do cliente Acme não encontrado na URL.')
    }
    clienteAcmeId = matchAcme[1]

    // Cria Beta
    await page.goto('/clientes/novo')
    await expect(page.getByRole('heading', { level: 1, name: 'Novo cliente' })).toBeVisible()
    await page.getByLabel('Nome').fill(nomeBeta)
    await page.getByLabel('Observações').fill('Cliente Beta para jornada ponta a ponta.')
    await page.getByRole('button', { name: 'Criar cliente' }).click()

    await expect(page).toHaveURL(/\/clientes\/[0-9a-fA-F-]+$/)
    await expect(page.getByRole('heading', { level: 1, name: nomeBeta })).toBeVisible()
    const matchBeta = page.url().match(/\/clientes\/([0-9a-fA-F-]+)$/)
    if (!matchBeta || !matchBeta[1]) {
      throw new Error('ID do cliente Beta não encontrado na URL.')
    }
    clienteBetaId = matchBeta[1]

    // Confere ambos na lista de clientes
    await page.goto('/clientes')
    await expect(page.getByRole('heading', { level: 1, name: 'Clientes' })).toBeVisible()
    await expect(page.getByRole('link', { name: nomeAcme })).toBeVisible()
    await expect(page.getByRole('link', { name: nomeBeta })).toBeVisible()

    await capturar(page, testInfo, '2-admin-cria-clientes-acme-beta.png')
  })

  // 3. Associa os dois ao projeto pela configuração
  await test.step('3. Associa os dois ao projeto pela configuração', async () => {
    await page.goto(`/projetos/${projetoId}/configuracao`)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Configuração inicial' }),
    ).toBeVisible()

    // Associa Acme
    await page.getByLabel('Cliente').selectOption(clienteAcmeId)
    await page.getByRole('button', { name: 'Associar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Cliente associado.' })).toBeVisible()
    await expect(page.getByText(nomeAcme)).toBeVisible()

    // Associa Beta
    await page.getByLabel('Cliente').selectOption(clienteBetaId)
    await page.getByRole('button', { name: 'Associar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Cliente associado.' })).toBeVisible()
    await expect(page.getByText(nomeBeta)).toBeVisible()

    await capturar(page, testInfo, '3-admin-associa-clientes-ao-projeto.png')
  })

  // 4. Abre /projetos/<p> e /clientes/<Acme>/projetos/<p>
  await test.step('4. Visão global com 5 abas e contexto de Acme com 3 abas', async () => {
    // Visão global (/projetos/<p>)
    await page.goto(`/projetos/${projetoId}`)
    await expect(page.getByRole('heading', { level: 1, name: nomeProjeto })).toBeVisible()

    // Checklist com "Clientes" Concluído, GitHub pendente e os demais "Ainda não disponível"
    const listaChecklist = page.getByRole('list', { name: 'Configuração do projeto' })
    await expect(listaChecklist.getByText('Clientes', { exact: true })).toBeVisible()
    await expect(listaChecklist.getByText('Concluído')).toBeVisible()
    await expect(listaChecklist.getByText('GitHub', { exact: true })).toBeVisible()
    await expect(listaChecklist.getByText('Ambientes', { exact: true })).toBeVisible()
    await expect(listaChecklist.getByText('Milestones', { exact: true })).toBeVisible()
    await expect(listaChecklist.getByText('Ainda não disponível')).toHaveCount(2)

    // Cinco abas
    const navAbasGlobal = page.getByRole('navigation', { name: 'Seções do projeto' })
    await expect(navAbasGlobal.getByRole('link')).toHaveCount(5)
    await expect(navAbasGlobal.getByRole('link', { name: /^Resumo/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(navAbasGlobal.getByRole('link', { name: /Entregas/ })).toBeVisible()
    await expect(navAbasGlobal.getByRole('link', { name: /Homologação/ })).toBeVisible()
    await expect(navAbasGlobal.getByRole('link', { name: /Saúde e Erros/ })).toBeVisible()
    await expect(navAbasGlobal.getByRole('link', { name: /Recursos/ })).toBeVisible()

    await capturar(page, testInfo, '4-admin-visao-global-resumo.png')

    // Contexto de cliente Acme (/clientes/<Acme>/projetos/<p>)
    await page.goto(`/clientes/${clienteAcmeId}/projetos/${projetoId}`)
    await expect(page.getByRole('heading', { level: 1, name: nomeProjeto })).toBeVisible()

    // Trilha Clientes › Acme › Portal do Cliente
    const navTrilhasCliente = page.getByRole('navigation', { name: 'Trilha de navegação' })
    await expect(navTrilhasCliente.getByRole('link', { name: 'Clientes' })).toBeVisible()
    await expect(navTrilhasCliente.getByRole('link', { name: nomeAcme })).toBeVisible()
    await expect(navTrilhasCliente.getByText(nomeProjeto)).toBeVisible()

    // Três abas
    const navAbasCliente = page.getByRole('navigation', { name: 'Seções do projeto' })
    await expect(navAbasCliente.getByRole('link')).toHaveCount(3)
    await expect(navAbasCliente.getByRole('link', { name: /^Resumo/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(navAbasCliente.getByRole('link', { name: /Entregas/ })).toBeVisible()
    await expect(navAbasCliente.getByRole('link', { name: /Homologação/ })).toBeVisible()

    // "no contexto de" Acme
    await expect(
      page.getByText(`Você está vendo este projeto no contexto de ${nomeAcme}.`),
    ).toBeVisible()

    // Link "Ver na visão global" com /projetos/<p>
    const linkVerGlobal = page.getByRole('link', { name: 'Ver na visão global' })
    await expect(linkVerGlobal).toBeVisible()
    await expect(linkVerGlobal).toHaveAttribute('href', `/projetos/${projetoId}`)

    await capturar(page, testInfo, '4-admin-contexto-cliente-acme.png')
  })

  // 4b. Vincula os dois repositórios pela tela, roda o worker e confere Resumo, Entregas e issue
  let issueId = ''
  await test.step('4b. Admin vincula os repositórios do GitHub, o worker sincroniza e Entregas mostra as issues', async () => {
    await page.goto(`/projetos/${projetoId}/configuracao#repositorios`)
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
    await capturar(page, testInfo, '4-admin-repositorios.png')

    // Resumo: GitHub concluído; Ambientes e Milestones seguem "Ainda não disponível"
    await page.goto(`/projetos/${projetoId}`)
    const itemGitHub = page
      .getByRole('list', { name: 'Configuração do projeto' })
      .locator('li', { hasText: 'GitHub' })
    await expect(itemGitHub).toContainText('2 repositórios vinculados')
    await expect(itemGitHub.getByText('Concluído')).toBeVisible()

    // Entregas: issues dos dois repositórios, sem milestone
    await page.goto(`/projetos/${projetoId}/entregas`)
    const lista = page.getByRole('list', { name: 'Issues sem milestone' })
    await expect(lista.getByRole('listitem')).toHaveCount(6)
    await capturar(page, testInfo, '4-admin-entregas.png')

    // Issue #2 do primeiro repositório, com PR e checks
    const issue = await obterIssueNoBanco(repoUm, 2)
    issueId = issue.id
    await lista
      .getByRole('link', { name: new RegExp(`#2 Item 2 de ${repoUm.split('/')[1]}`) })
      .click()
    await expect(page).toHaveURL(`/projetos/${projetoId}/entregas/issues/${issueId}`)
    await expect(page.getByRole('heading', { level: 1, name: /Item 2/ })).toBeVisible()
    await expect(page.getByText('Sem evidência de versão ou ambiente.')).toBeVisible()
    await capturar(page, testInfo, '4-admin-issue.png')
  })

  const testador = {
    contexto: null as BrowserContext | null,
    pagina: null as Page | null,
  }

  try {
    // 5. Cria testador escopado a Acme pela tela /configuracoes/usuarios
    await test.step('5. Cria testador escopado a Acme e navega no contexto de Acme sem ver Beta nem ações administrativas', async () => {
      await page.goto('/configuracoes/usuarios')
      await expect(page.getByRole('heading', { level: 1, name: 'Usuários' })).toBeVisible()

      await page.getByLabel('E-mail').fill(emailTestador)
      await page.getByLabel('Nome').fill(nomeTestador)
      await page.getByLabel('Senha').fill(senhaTestador)
      await page.getByLabel('Papel').selectOption('TESTADOR')
      await page.getByLabel('Cliente').selectOption(clienteAcmeId)
      await page.getByRole('button', { name: 'Criar usuário' }).click()

      await expect(page.getByRole('status').filter({ hasText: 'Usuário criado.' })).toBeVisible()
      const linhaTestador = page.locator('li', { hasText: emailTestador })
      await expect(linhaTestador).toBeVisible()
      await expect(linhaTestador.getByText(`TESTADOR (${nomeAcme})`)).toBeVisible()

      // Entra com o testador em um browser.newContext()
      testador.contexto = await browser.newContext()
      testador.pagina = await testador.contexto.newPage()
      await fazerLogin(testador.pagina, emailTestador, senhaTestador)

      // Navega Clientes › Acme › Portal do Cliente › Resumo
      await testador.pagina.goto('/clientes')
      await expect(
        testador.pagina.getByRole('heading', { level: 1, name: 'Clientes' }),
      ).toBeVisible()
      await expect(testador.pagina.getByRole('link', { name: nomeAcme })).toBeVisible()
      await expect(testador.pagina.getByText(nomeBeta)).toHaveCount(0)

      await testador.pagina.getByRole('link', { name: nomeAcme }).click()
      await expect(testador.pagina).toHaveURL(new RegExp(`/clientes/${clienteAcmeId}$`))
      await expect(testador.pagina.getByRole('heading', { level: 1, name: nomeAcme })).toBeVisible()

      await testador.pagina.getByRole('link', { name: nomeProjeto }).click()
      await expect(testador.pagina).toHaveURL(`/clientes/${clienteAcmeId}/projetos/${projetoId}`)
      await expect(
        testador.pagina.getByRole('heading', { level: 1, name: nomeProjeto }),
      ).toBeVisible()

      // Sem "Configuração" nem "Ver na visão global"
      await expect(testador.pagina.getByRole('link', { name: 'Configuração' })).toHaveCount(0)
      await expect(testador.pagina.getByRole('link', { name: 'Ver na visão global' })).toHaveCount(
        0,
      )

      // Contexto de Acme visível
      await expect(
        testador.pagina.getByText(`Você está vendo este projeto no contexto de ${nomeAcme}.`),
      ).toBeVisible()

      await capturar(testador.pagina, testInfo, '5-testador-resumo-contexto-acme.png')

      // Issues são dado técnico da visão global: no contexto de Acme a aba Entregas continua sem elas
      await testador.pagina.goto(`/clientes/${clienteAcmeId}/projetos/${projetoId}/entregas`)
      await expect(
        testador.pagina.getByText('Milestones e entregas chegam no Incremento 3.'),
      ).toBeVisible()
      await expect(testador.pagina.getByText(/Item \d de /)).toHaveCount(0)
    })

    // 6. Com o testador: /clientes/<Beta> e /projetos
    await test.step('6. Testador tenta acessar Beta e vê orientação em /projetos', async () => {
      if (!testador.pagina) {
        throw new Error('Página do testador não inicializada.')
      }

      // /clientes/<Beta> → "Sem permissão para esta área."
      await testador.pagina.goto(`/clientes/${clienteBetaId}`)
      await expect(
        testador.pagina.getByRole('status').filter({ hasText: 'Sem permissão para esta área.' }),
      ).toBeVisible()

      await capturar(testador.pagina, testInfo, '6-testador-sem-permissao-beta.png')

      // /projetos → orientação "Os projetos ficam disponíveis no contexto de cada cliente." com link só para Acme
      await testador.pagina.goto('/projetos')
      await expect(
        testador.pagina.getByText('Os projetos ficam disponíveis no contexto de cada cliente.'),
      ).toBeVisible()

      // Link só para Acme, sem Beta
      await expect(testador.pagina.getByRole('link', { name: nomeAcme })).toBeVisible()
      await expect(testador.pagina.getByText(nomeBeta)).toHaveCount(0)

      await capturar(testador.pagina, testInfo, '6-testador-projetos-orientacao.png')

      // Entregas globais e a página da issue: sem permissão, sem vazar issues (A16, UX-18)
      for (const rota of [
        `/projetos/${projetoId}/entregas`,
        `/projetos/${projetoId}/entregas/issues/${issueId}`,
      ]) {
        await testador.pagina.goto(rota)
        await expect(
          testador.pagina.getByRole('status').filter({ hasText: 'Sem permissão para esta área.' }),
        ).toBeVisible()
        await expect(testador.pagina.getByText(/Item \d de /)).toHaveCount(0)
      }
    })
  } finally {
    if (testador.contexto) {
      await testador.contexto.close()
    }
  }
})
