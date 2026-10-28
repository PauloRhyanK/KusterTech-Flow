import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import {
  apagarAutorizacoesNoBanco,
  aprovarHomologacaoNoBanco,
  configurarAmbientesDePublicacaoNoBanco,
  contarAutorizacoesProd,
  contarEvidenciasProd,
  criarClienteNoBanco,
  criarMilestoneNoBanco,
  criarProjetoNoBanco,
  criarUsuarioNoBanco,
  deixarHomologacaoPendenteNoBanco,
  limparPublicacaoE2E,
  nomeDeTeste,
  obterIssueNoBanco,
  obterVersaoNoBanco,
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

interface DeploymentDeFixture {
  sha: string
  environment: string
}

// `Bn` (versão em PROD) e `Mn` (versão em QA) saem do arquivo de deployments da fixture.
function commitsDoCenario(nomeCompleto: string): { base: string; alvo: string } {
  const arquivo = `src/modules/github/fixtures/${nomeCompleto.replace('/', '__')}/deployments.json`
  const deployments = JSON.parse(readFileSync(arquivo, 'utf8')) as DeploymentDeFixture[]
  const sha = (ambiente: string) => {
    const d = deployments.find((x) => x.environment === ambiente)
    if (!d) throw new Error(`Fixture sem deployment em ${ambiente}.`)
    return d.sha
  }
  return { base: sha('producao-publicacao'), alvo: sha('qa-publicacao') }
}

interface Cenario {
  projetoId: string
  repoUm: string
  repoDois: string
  baseCurta: string
  acmeId: string
  betaNome: string
}

// Acme e Beta no projeto, ambientes de publicação, #2 do primeiro repositório numa milestone com
// Acme aprovada e Beta pendente na versão Mn, e o worker calculando a composição.
async function prepararCenario(projectName: string, adminId: string): Promise<Cenario> {
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(projectName)
  await limparPublicacaoE2E([repoUm, repoDois])
  const acme = await criarClienteNoBanco(nomeDeTeste('Acme'))
  const beta = await criarClienteNoBanco(nomeDeTeste('Beta'))
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Publicação'), [acme.id, beta.id])
  await vincularNoBanco(projeto.id, repoUm)
  await vincularNoBanco(projeto.id, repoDois)
  await configurarAmbientesDePublicacaoNoBanco(projeto.id)
  rodarWorkerUmaVez()

  const { base, alvo } = commitsDoCenario(repoUm)
  const versaoAlvo = await obterVersaoNoBanco(repoUm, alvo)
  const issue2 = await obterIssueNoBanco(repoUm, 2)
  const milestone = await criarMilestoneNoBanco(projeto.id, nomeDeTeste('Release 1'), [
    acme.id,
    beta.id,
  ])
  await vincularIssuesNoBanco(milestone.id, [issue2.id])
  const comum = { milestoneId: milestone.id, issueId: issue2.id, versaoId: versaoAlvo.id }
  await aprovarHomologacaoNoBanco({ ...comum, clienteId: acme.id, autorId: adminId })
  await deixarHomologacaoPendenteNoBanco({ ...comum, clienteId: beta.id })
  rodarWorkerUmaVez()

  return {
    projetoId: projeto.id,
    repoUm,
    repoDois,
    baseCurta: base.slice(0, 7),
    acmeId: acme.id,
    betaNome: beta.nome,
  }
}

function secao(page: Page, nomeCompleto: string) {
  return page.getByRole('region', { name: nomeCompleto })
}

test('seção de repoUm: base pela evidência, composição identificada, #2 com QA aprovado e aviso de Beta; autoriza sem disparar deploy', async ({
  page,
}, testInfo) => {
  const admin = obterAdmin()
  const c = await prepararCenario(testInfo.project.name, admin.id)
  await fazerLogin(page, admin.email, admin.senha)

  await page.goto(`/projetos/${c.projetoId}/publicacoes`)

  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Publicações', exact: true })).toBeVisible()
  await expect(
    page.getByText('Autorizar PROD não publica nada: o deploy continua com o pipeline do projeto.'),
  ).toBeVisible()
  const um = secao(page, c.repoUm)
  await expect(um.getByText(`Base: ${c.baseCurta} (versão em PROD pela evidência)`)).toBeVisible()
  await expect(um.getByText('Composição identificada')).toBeVisible()
  await expect(um.getByText(`#2 Item 2 de ${c.repoUm.split('/')[1]}`)).toBeVisible()
  await expect(um.getByText('QA aprovado', { exact: true })).toBeVisible()
  await expect(
    um.getByText(`#2: homologação de ${c.betaNome} ainda pendente (não bloqueia a autorização).`),
  ).toBeVisible()
  await expect(um.getByText('QA aprovado em 1 de 2')).toBeVisible()
  await expect(um.getByText('Autorizada para PROD', { exact: true })).toHaveCount(0)

  const evidenciasAntes = await contarEvidenciasProd(c.repoUm)
  await um.getByLabel('Conferi o projeto, o repositório, a versão e a composição acima.').check()
  await um.getByRole('button', { name: 'Autorizar publicação em PROD' }).click()

  await expect(
    um.getByText('Publicação autorizada. A autorização não dispara o deploy.'),
  ).toBeVisible()
  await expect(um.getByText('Autorizada para PROD', { exact: true })).toBeVisible()
  await expect(um.getByText('Sem evidência de deploy em PROD', { exact: true })).toBeVisible()
  await expect(um.getByRole('button', { name: 'Autorizar publicação em PROD' })).toHaveCount(0)
  expect(await contarAutorizacoesProd(c.repoUm)).toBe(1)
  expect(await contarEvidenciasProd(c.repoUm)).toBe(evidenciasAntes)
  expect(evidenciasAntes).toBe(1)
})

test('projeto sem ambientes mostra "O ambiente PROD não está configurado." com link para a configuração', async ({
  page,
}, testInfo) => {
  const admin = obterAdmin()
  const [repoUm] = repositoriosDoProjetoE2E(testInfo.project.name)
  await limparPublicacaoE2E(repositoriosDoProjetoE2E(testInfo.project.name))
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Sem Ambientes'))
  await vincularNoBanco(projeto.id, repoUm)
  await fazerLogin(page, admin.email, admin.senha)

  await page.goto(`/projetos/${projeto.id}/publicacoes`)

  await expect(page.getByText('O ambiente PROD não está configurado.')).toBeVisible()
  await expect(page.getByText('Configure os ambientes em Configuração › Ambientes.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Configurar ambientes' })).toHaveAttribute(
    'href',
    `/projetos/${projeto.id}/configuracao#ambientes`,
  )
})

test('testador escopado de Acme vê "Sem permissão para esta área."; POST de autorizar do admin reenviado pelo testador e por um aprovador global não grava; pelo admin grava', async ({
  page,
  browser,
}, testInfo) => {
  const admin = obterAdmin()
  const c = await prepararCenario(testInfo.project.name, admin.id)
  await fazerLogin(page, admin.email, admin.senha)

  // Requisição real da Server Action de autorizar, feita pelo admin, para reenviar forjada.
  await page.goto(`/projetos/${c.projetoId}/publicacoes`)
  const um = secao(page, c.repoUm)
  await um.getByLabel('Conferi o projeto, o repositório, a versão e a composição acima.').check()
  const [requisicao] = await Promise.all([
    page.waitForRequest((r) => r.method() === 'POST' && 'next-action' in r.headers()),
    um.getByRole('button', { name: 'Autorizar publicação em PROD' }).click(),
  ])
  await expect(
    um.getByText('Publicação autorizada. A autorização não dispara o deploy.'),
  ).toBeVisible()
  const corpo = requisicao.postDataBuffer()
  expect(corpo).not.toBeNull()
  await apagarAutorizacoesNoBanco(c.repoUm)
  expect(await contarAutorizacoesProd(c.repoUm)).toBe(0)

  const reenviar = async (contexto: { request: Page['request'] }) =>
    contexto.request.post(requisicao.url(), {
      headers: {
        'next-action': requisicao.headers()['next-action'] as string,
        'content-type': requisicao.headers()['content-type'] as string,
      },
      data: corpo as Buffer,
    })

  const papeis = [
    { papel: 'TESTADOR', clienteId: c.acmeId, nome: 'Testador' },
    { papel: 'APROVADOR', clienteId: null, nome: 'Aprovador' },
  ] as const
  for (const p of papeis) {
    const email = `e2e+${p.nome.toLowerCase()}-pub-${Date.now()}@local.test`
    const senha = 'SenhaForte123!'
    await criarUsuarioNoBanco({
      email,
      nome: `E2E ${p.nome} Publicação`,
      senha,
      papel: p.papel,
      clienteId: p.clienteId,
    })
    const contexto = await browser.newContext()
    try {
      const pagina = await contexto.newPage()
      await fazerLogin(pagina, email, senha)
      if (p.papel === 'TESTADOR') {
        await pagina.goto(`/projetos/${c.projetoId}/publicacoes`)
        await expect(pagina.getByText('Sem permissão para esta área.').first()).toBeVisible()
      }
      const resposta = await reenviar(contexto)
      expect(resposta.status()).toBeLessThan(500)
      expect(await contarAutorizacoesProd(c.repoUm)).toBe(0)
    } finally {
      await contexto.close()
    }
  }

  // Controle positivo: a mesma requisição, enviada pelo admin, autoriza.
  await reenviar(page)
  expect(await contarAutorizacoesProd(c.repoUm)).toBe(1)
})
