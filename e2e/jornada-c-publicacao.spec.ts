import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  aprovarHomologacaoNoBanco,
  configurarAmbientesDePublicacaoNoBanco,
  contarAutorizacoesProd,
  contarEvidenciasProd,
  contarVerificacoesProd,
  criarClienteNoBanco,
  criarMilestoneNoBanco,
  criarProjetoNoBanco,
  criarUsuarioNoBanco,
  deixarHomologacaoPendenteNoBanco,
  limparPublicacaoE2E,
  nomeDeTeste,
  obterDivergenciasNoBanco,
  obterIssueNoBanco,
  obterVersaoNoBanco,
  registrarDeployProdNoBanco,
  repositoriosDoProjetoE2E,
  vincularIssuesNoBanco,
  vincularNoBanco,
} from './support/banco'
import { rodarWorkerUmaVez } from './support/worker'

function obterAdmin(): { id: string; email: string; senha: string } {
  const { E2E_ADMIN_ID: id, E2E_ADMIN_EMAIL: email, E2E_ADMIN_SENHA: senha } = process.env
  if (!id || !email || !senha) {
    throw new Error('Credenciais do administrador de E2E não configuradas pelo setup.')
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

async function capturar(page: Page, projeto: string, nomeArquivo: string): Promise<void> {
  const caminho = path.join('e2e', 'capturas', projeto, nomeArquivo)
  fs.mkdirSync(path.dirname(caminho), { recursive: true })
  await page.screenshot({ path: caminho, fullPage: true })
}

async function semRolagemHorizontal(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
}

interface DeploymentDeFixture {
  sha: string
  environment: string
  created_at: string
}

// `Bn`, `Mn` e `Dn` saem do arquivo de deployments da fixture, nunca da memória.
function deploymentsDaFixture(nomeCompleto: string): DeploymentDeFixture[] {
  const arquivo = `src/modules/github/fixtures/${nomeCompleto.replace('/', '__')}/deployments.json`
  return JSON.parse(fs.readFileSync(arquivo, 'utf8')) as DeploymentDeFixture[]
}

function commitDoAmbiente(nomeCompleto: string, ambiente: string): string {
  const d = deploymentsDaFixture(nomeCompleto)
    .filter((x) => x.environment === ambiente)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .at(-1)
  if (!d) throw new Error(`Fixture sem deployment em ${ambiente}.`)
  return d.sha
}

test.beforeEach(async ({}, testInfo) => {
  await limparPublicacaoE2E(repositoriosDoProjetoE2E(testInfo.project.name))
})

test('Jornada C, fim: candidata, autorização sem deploy, Em PROD, verificação, quatro estados na milestone e na issue, divergência e isolamento do cliente', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const projeto = testInfo.project.name
  const mobile = projeto === 'mobile'
  const admin = obterAdmin()
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(projeto)
  const mn = commitDoAmbiente(repoUm, 'qa-publicacao')
  const bn = commitDoAmbiente(repoUm, 'producao-publicacao')
  const dn = commitDoAmbiente(repoDois, 'producao-publicacao')
  const nomeDoRepo = repoUm.split('/')[1]

  const acme = await criarClienteNoBanco(nomeDeTeste('Acme'))
  const beta = await criarClienteNoBanco(nomeDeTeste('Beta'))
  const p = await criarProjetoNoBanco(nomeDeTeste('Projeto Jornada C Publicação'), [
    acme.id,
    beta.id,
  ])
  await vincularNoBanco(p.id, repoUm)
  await vincularNoBanco(p.id, repoDois)
  await configurarAmbientesDePublicacaoNoBanco(p.id)
  rodarWorkerUmaVez()

  const issue2 = await obterIssueNoBanco(repoUm, 2)
  const issue2Dois = await obterIssueNoBanco(repoDois, 2)
  const milestone = await criarMilestoneNoBanco(p.id, nomeDeTeste('Release Publicação'), [
    acme.id,
    beta.id,
  ])
  await vincularIssuesNoBanco(milestone.id, [issue2.id])
  const versaoAlvo = await obterVersaoNoBanco(repoUm, mn)
  const comum = { milestoneId: milestone.id, issueId: issue2.id, versaoId: versaoAlvo.id }
  await aprovarHomologacaoNoBanco({ ...comum, clienteId: acme.id, autorId: admin.id })
  await deixarHomologacaoPendenteNoBanco({ ...comum, clienteId: beta.id })
  rodarWorkerUmaVez()

  await fazerLogin(page, admin.email, admin.senha)
  const secao = (nome: string) => page.getByRole('region', { name: nome })
  // Os blocos "Em PROD" e "Candidata à publicação" são filhos diretos da seção do repositório.
  const bloco = (nome: string, titulo: string) =>
    secao(nome)
      .locator(':scope > div')
      .filter({ has: page.getByRole('heading', { name: titulo, exact: true }) })
  const verificarSemRolagem = async () => {
    if (mobile) expect(await semRolagemHorizontal(page)).toBe(true)
  }

  await test.step('1. Publicações: candidata Mn, composição identificada e quatro estados', async () => {
    await page.goto(`/projetos/${p.id}/publicacoes`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    const um = secao(repoUm)
    await expect(
      um.getByText(`Base: ${bn.slice(0, 7)} (versão em PROD pela evidência)`),
    ).toBeVisible()
    await expect(um.getByText('Composição identificada')).toBeVisible()
    await expect(um.getByText(`#2 Item 2 de ${nomeDoRepo}`)).toBeVisible()
    await expect(um.getByText('QA aprovado', { exact: true })).toBeVisible()
    await expect(
      um.getByText(`#2: homologação de ${beta.nome} ainda pendente (não bloqueia a autorização).`),
    ).toBeVisible()
    await expect(um.getByText('QA aprovado em 1 de 2')).toBeVisible()
    const candidata = bloco(repoUm, 'Candidata à publicação')
    await expect(candidata.getByText('Não autorizada para PROD', { exact: true })).toBeVisible()
    await expect(
      candidata.getByText('Sem evidência de deploy em PROD', { exact: true }),
    ).toBeVisible()
    await expect(candidata.getByText('Não verificada em produção', { exact: true })).toBeVisible()
    await verificarSemRolagem()
    await capturar(page, projeto, 'jornada-c-publicacao-1-candidata.png')
  })

  await test.step('2. Autoriza com a caixa de contexto, sem disparar deploy', async () => {
    const um = secao(repoUm)
    const evidenciasAntes = await contarEvidenciasProd(repoUm)
    expect(evidenciasAntes).toBe(1)
    await um.getByLabel('Conferi o projeto, o repositório, a versão e a composição acima.').check()
    await um.getByRole('button', { name: 'Autorizar publicação em PROD' }).click()
    await expect(
      um.getByText('Publicação autorizada. A autorização não dispara o deploy.'),
    ).toBeVisible()
    const candidata = bloco(repoUm, 'Candidata à publicação')
    await expect(candidata.getByText('Autorizada para PROD', { exact: true })).toBeVisible()
    await expect(
      candidata.getByText('Sem evidência de deploy em PROD', { exact: true }),
    ).toBeVisible()
    expect(await contarAutorizacoesProd(repoUm)).toBe(1)
    expect(await contarEvidenciasProd(repoUm)).toBe(1)
    await verificarSemRolagem()
    await capturar(page, projeto, 'jornada-c-publicacao-2-autorizada.png')
  })

  await test.step('3. O pipeline publica Mn: Em PROD, sem divergência e sem candidata', async () => {
    await registrarDeployProdNoBanco(p.id, repoUm, mn)
    rodarWorkerUmaVez()
    await page.goto(`/projetos/${p.id}/publicacoes`)
    const um = secao(repoUm)
    await expect(
      um.getByText(new RegExp(`${mn.slice(0, 7)} · .+ · Endpoint de evidência`)),
    ).toBeVisible()
    await expect(
      bloco(repoUm, 'Em PROD')
        .getByRole('definition')
        .filter({ hasText: /^Em PROD$/ }),
    ).toBeVisible()
    await expect(um.getByText('Nenhuma divergência de deploy.')).toBeVisible()
    await expect(um.getByText('Nenhuma versão em QA aguardando publicação.')).toBeVisible()
    expect(await obterDivergenciasNoBanco(repoUm)).toEqual([])
    await verificarSemRolagem()
    await capturar(page, projeto, 'jornada-c-publicacao-3-em-prod.png')
  })

  await test.step('4. Registra a verificação em produção', async () => {
    const um = secao(repoUm)
    await um
      .getByLabel('O que foi verificado em produção')
      .fill('Fluxo de login conferido em produção.')
    await um.getByRole('button', { name: 'Registrar verificação' }).click()
    await expect(um.getByText('Verificação registrada.')).toBeVisible()
    await expect(
      bloco(repoUm, 'Em PROD').getByText('Verificada manualmente em produção', { exact: true }),
    ).toBeVisible()
    expect(await contarVerificacoesProd(repoUm)).toBe(1)
    await verificarSemRolagem()
    await capturar(page, projeto, 'jornada-c-publicacao-4-verificada.png')
  })

  await test.step('5. Milestone e issue mostram os mesmos estados', async () => {
    await page.goto(`/projetos/${p.id}/entregas/milestones/${milestone.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByText('Autorizadas para PROD: 1 de 1')).toBeVisible()
    await expect(page.getByText('Em PROD: 1 de 1')).toBeVisible()
    await expect(page.getByText('Verificadas em produção: 1 de 1')).toBeVisible()
    await verificarSemRolagem()
    await capturar(page, projeto, 'jornada-c-publicacao-5-milestone.png')

    await page.goto(`/projetos/${p.id}/entregas/issues/${issue2.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    const publicacao = page.getByRole('region', { name: 'Publicação' })
    await expect(publicacao.getByText('QA aprovado em 1 de 2')).toBeVisible()
    await expect(publicacao.getByText('Autorizada para PROD', { exact: true })).toBeVisible()
    await expect(publicacao.getByText('Em PROD', { exact: true })).toBeVisible()
    await expect(publicacao.getByText('Verificada manualmente em produção')).toBeVisible()
    await verificarSemRolagem()
    await capturar(page, projeto, 'jornada-c-publicacao-6-issue.png')
    await publicacao.getByRole('link', { name: 'Ver publicações' }).click()
    await expect(page).toHaveURL(new RegExp(`/projetos/${p.id}/publicacoes$`))
  })

  await test.step('6. Divergência em repoDois: registrada, sem "bloque" e reconhecível', async () => {
    await page.goto(`/projetos/${p.id}/publicacoes`)
    const dois = secao(repoDois)
    await expect(dois.getByText('Deploy em PROD sem autorização registrada')).toBeVisible()
    await expect(dois.getByText(new RegExp(`${dn.slice(0, 7)} · `)).first()).toBeVisible()
    expect(await page.locator('main').innerText()).not.toMatch(/bloque/i)

    await page.goto(`/projetos/${p.id}/entregas/issues/${issue2Dois.id}`)
    await expect(page.getByText('Em PROD sem autorização registrada')).toBeVisible()
    expect(await page.locator('main').innerText()).not.toMatch(/bloque/i)

    await page.goto(`/projetos/${p.id}/publicacoes`)
    await dois.getByRole('button', { name: 'Reconhecer divergência' }).click()
    await dois.getByRole('button', { name: 'Confirmar reconhecimento' }).click()
    await expect(dois.getByText(/Reconhecida por Admin E2E/)).toBeVisible()
    expect(await contarAutorizacoesProd(repoDois)).toBe(0)
    await verificarSemRolagem()
    await capturar(page, projeto, 'jornada-c-publicacao-7-divergencia.png')
  })

  await test.step('7. O testador escopado de Acme não vê publicação', async () => {
    const email = `e2e+testador-jcp-${Date.now()}@local.test`
    const senha = `senha-${Math.random().toString(36).slice(2, 12)}-e2e`
    await criarUsuarioNoBanco({
      email,
      nome: 'E2E Testador Publicação',
      senha,
      papel: 'TESTADOR',
      clienteId: acme.id,
    })
    const contexto = await browser.newContext()
    try {
      const pagina = await contexto.newPage()
      await fazerLogin(pagina, email, senha)
      await pagina.goto(`/clientes/${acme.id}/projetos/${p.id}/entregas/milestones/${milestone.id}`)
      await expect(pagina.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(pagina.getByText('Autorizadas para PROD')).toHaveCount(0)
      await pagina.goto(`/projetos/${p.id}/publicacoes`)
      await expect(pagina.getByText('Sem permissão para esta área.').first()).toBeVisible()
    } finally {
      await contexto.close()
    }
  })
})
