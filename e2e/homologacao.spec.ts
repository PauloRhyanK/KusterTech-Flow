import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  contarEventosDeTimeline,
  criarUsuarioNoBanco,
  disponibilizarNoBanco,
  liberarRepositoriosNoBanco,
  limparImplantacaoDosRepositoriosNoBanco,
  obterItemDeHomologacaoNoBanco,
  prepararCenarioDeHomologacaoE2E,
  repositoriosDoProjetoE2E,
} from './support/banco'

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

// Cria um usuário escopado e abre uma sessão própria (contexto novo) para ele.
async function entrarComo(
  browser: Browser,
  papel: 'TESTADOR' | 'APROVADOR',
  clienteId: string,
  rotulo: string,
): Promise<{ page: Page; fechar: () => Promise<void> }> {
  const email = `e2e+${rotulo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@local.test`
  const senha = `senha-${Math.random().toString(36).slice(2, 12)}-e2e`
  await criarUsuarioNoBanco({ email, nome: `E2E ${rotulo}`, senha, papel, clienteId })
  const contexto = await browser.newContext()
  const page = await contexto.newPage()
  await fazerLogin(page, email, senha)
  return { page, fechar: () => contexto.close() }
}

function urlDaIssue(clienteId: string, projetoId: string, issueId: string, milestoneId: string) {
  return `/clientes/${clienteId}/projetos/${projetoId}/entregas/issues/${issueId}?milestone=${milestoneId}`
}

test.beforeEach(async ({}, testInfo) => {
  const repositorios = repositoriosDoProjetoE2E(testInfo.project.name)
  await liberarRepositoriosNoBanco(repositorios)
  await limparImplantacaoDosRepositoriosNoBanco(repositorios)
})

test('admin disponibiliza repoUm #2 para Acme; timeline mostra "Disponibilizada ao cliente" no grupo "Versão atual em QA: E2E qa-1"; item de Beta segue AGUARDANDO_DISPONIBILIZACAO no banco', async ({
  page,
}, testInfo) => {
  const admin = obterAdmin()
  await fazerLogin(page, admin.email, admin.senha)
  const c = await prepararCenarioDeHomologacaoE2E(testInfo.project.name, admin.id)
  expect(c.itensCriados).toBe(4)

  await page.goto(urlDaIssue(c.acme.id, c.projeto.id, c.issueUm2.id, c.milestone.id))
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: `Homologação de ${c.acme.nome}` })).toBeVisible()
  await expect(page.getByText('Aguardando disponibilização').first()).toBeVisible()

  await page.getByRole('button', { name: 'Disponibilizar ao cliente' }).click()
  await expect(
    page.getByText('Disponibilizar a issue #2 para teste de', { exact: false }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar disponibilização' }).click()

  await expect(
    page.getByRole('status').filter({ hasText: `Issue disponibilizada para ${c.acme.nome}.` }),
  ).toBeVisible()
  const grupo = page.locator('details[open]').filter({ hasText: 'Versão atual em QA: E2E qa-1' })
  await expect(grupo).toContainText('Disponibilizada ao cliente')
  await expect(grupo).toContainText('Entrou na fila de homologação')

  const acme = await obterItemDeHomologacaoNoBanco(c.acme.id, c.milestone.id, c.repoUm, 2)
  const beta = await obterItemDeHomologacaoNoBanco(c.beta.id, c.milestone.id, c.repoUm, 2)
  expect(acme?.estado).toBe('PENDENTE_DE_TESTE')
  expect(beta?.estado).toBe('AGUARDANDO_DISPONIBILIZACAO')
})

test('com #2 disponibilizada por disponibilizarNoBanco, aprovador de Acme aprova pelo painel de contexto e vê "Aprovação registrada para <Acme>."', async ({
  browser,
  page,
}, testInfo) => {
  const admin = obterAdmin()
  await fazerLogin(page, admin.email, admin.senha)
  const c = await prepararCenarioDeHomologacaoE2E(testInfo.project.name, admin.id)
  const item = await obterItemDeHomologacaoNoBanco(c.acme.id, c.milestone.id, c.repoUm, 2)
  await disponibilizarNoBanco(item!.id, admin.id)

  const aprovador = await entrarComo(browser, 'APROVADOR', c.acme.id, 'aprovador-acme')
  try {
    await aprovador.page.goto(urlDaIssue(c.acme.id, c.projeto.id, c.issueUm2.id, c.milestone.id))
    await aprovador.page.getByRole('button', { name: 'Testado e aprovado' }).click()
    await aprovador.page.getByLabel('Observação (opcional)').fill('Funcionou como esperado.')
    await aprovador.page.getByRole('button', { name: 'Revisar aprovação' }).click()
    await expect(
      aprovador.page.getByText(
        `Você vai registrar Testado e aprovado na issue #2 (${c.repoUm}) para ${c.acme.nome}, na milestone ${c.milestone.titulo}, versão E2E qa-1.`,
      ),
    ).toBeVisible()
    await aprovador.page.getByRole('button', { name: 'Confirmar aprovação' }).click()

    await expect(
      aprovador.page
        .getByRole('status')
        .filter({ hasText: `Aprovação registrada para ${c.acme.nome}.` }),
    ).toBeVisible()
    await expect(aprovador.page.getByText('Aprovada', { exact: true }).first()).toBeVisible()
    const depois = await obterItemDeHomologacaoNoBanco(c.acme.id, c.milestone.id, c.repoUm, 2)
    expect(depois?.estado).toBe('APROVADA')
  } finally {
    await aprovador.fechar()
  }
})

test('com #1 disponibilizada por disponibilizarNoBanco, testador de Acme não vê "Testado e aprovado"; POST de aprovação de #1 capturado do aprovador de Acme com page.route (abortado) e reenviado pelo testador e pelo aprovador de Beta não muda o item; reenviado pelo aprovador de Acme aprova (controle positivo)', async ({
  browser,
  page,
}, testInfo) => {
  const admin = obterAdmin()
  await fazerLogin(page, admin.email, admin.senha)
  const c = await prepararCenarioDeHomologacaoE2E(testInfo.project.name, admin.id)
  const item = await obterItemDeHomologacaoNoBanco(c.acme.id, c.milestone.id, c.repoUm, 1)
  await disponibilizarNoBanco(item!.id, admin.id)
  const url = urlDaIssue(c.acme.id, c.projeto.id, c.issueUm1.id, c.milestone.id)

  const testador = await entrarComo(browser, 'TESTADOR', c.acme.id, 'testador-acme')
  const aprovadorBeta = await entrarComo(browser, 'APROVADOR', c.beta.id, 'aprovador-beta')
  const aprovadorAcme = await entrarComo(browser, 'APROVADOR', c.acme.id, 'aprovador-acme')
  try {
    await testador.page.goto(url)
    await expect(
      testador.page.getByRole('heading', { name: `Homologação de ${c.acme.nome}` }),
    ).toBeVisible()
    await expect(testador.page.getByRole('button', { name: 'Solicitar correção' })).toBeVisible()
    await expect(testador.page.getByRole('button', { name: 'Testado e aprovado' })).toHaveCount(0)

    let capturada: { url: string; headers: Record<string, string>; body: Buffer } | null = null
    await aprovadorAcme.page.goto(url)
    await aprovadorAcme.page.route('**/entregas/issues/**', async (rota) => {
      const req = rota.request()
      if (req.method() === 'POST' && req.headers()['next-action']) {
        capturada = { url: req.url(), headers: req.headers(), body: req.postDataBuffer()! }
        return rota.abort()
      }
      return rota.continue()
    })
    await aprovadorAcme.page.getByRole('button', { name: 'Testado e aprovado' }).click()
    await aprovadorAcme.page.getByRole('button', { name: 'Revisar aprovação' }).click()
    await aprovadorAcme.page.getByRole('button', { name: 'Confirmar aprovação' }).click()
    await expect.poll(() => capturada !== null).toBe(true)
    await aprovadorAcme.page.unroute('**/entregas/issues/**')

    const requisicao = {
      headers: {
        'next-action': capturada!.headers['next-action']!,
        'content-type': capturada!.headers['content-type']!,
      },
      data: capturada!.body,
    }
    const antes = {
      item: await obterItemDeHomologacaoNoBanco(c.acme.id, c.milestone.id, c.repoUm, 1),
      eventos: await contarEventosDeTimeline(c.acme.id),
    }
    expect(antes.item?.estado).toBe('PENDENTE_DE_TESTE')

    for (const intruso of [testador, aprovadorBeta]) {
      const resposta = await intruso.page.context().request.post(capturada!.url, requisicao)
      const corpo = await resposta.text()
      expect(corpo).toContain('Sem permissão para esta ação de homologação.')
      expect(corpo).not.toContain('Aprovação registrada')
      expect(await obterItemDeHomologacaoNoBanco(c.acme.id, c.milestone.id, c.repoUm, 1)).toEqual(
        antes.item,
      )
      expect(await contarEventosDeTimeline(c.acme.id)).toBe(antes.eventos)
    }

    // Controle positivo: o mesmo POST, enviado de dentro da sessão do aprovador de Acme.
    const positiva = await aprovadorAcme.page.context().request.post(capturada!.url, requisicao)
    expect(positiva.ok()).toBe(true)
    expect(
      (await obterItemDeHomologacaoNoBanco(c.acme.id, c.milestone.id, c.repoUm, 1))?.estado,
    ).toBe('APROVADA')
    expect(await contarEventosDeTimeline(c.acme.id)).toBe(antes.eventos + 1)
  } finally {
    await testador.fechar()
    await aprovadorBeta.fechar()
    await aprovadorAcme.fechar()
  }
})

test('aprovador de Beta abre a issue em /clientes/<acme>/…: "Sem permissão para esta área."', async ({
  browser,
  page,
}, testInfo) => {
  const admin = obterAdmin()
  await fazerLogin(page, admin.email, admin.senha)
  const c = await prepararCenarioDeHomologacaoE2E(testInfo.project.name, admin.id)

  const aprovadorBeta = await entrarComo(browser, 'APROVADOR', c.beta.id, 'aprovador-beta')
  try {
    await aprovadorBeta.page.goto(
      urlDaIssue(c.acme.id, c.projeto.id, c.issueUm1.id, c.milestone.id),
    )
    await expect(aprovadorBeta.page.getByText('Sem permissão para esta área.')).toBeVisible()
    await expect(
      aprovadorBeta.page.getByRole('group', { name: 'Ações de homologação' }),
    ).toHaveCount(0)
  } finally {
    await aprovadorBeta.fechar()
  }
})

test('fila global abre em "Requer minha ação (4)" agrupada em E2E Release 1; Cliente=Acme mostra (2); abre #2, disponibiliza, "Voltar à fila" volta a /projetos/<p>/homologacao com filtro=requer-minha-acao e cliente=<acme>, e #item-<id> está no viewport', async ({
  page,
}, testInfo) => {
  const admin = obterAdmin()
  await fazerLogin(page, admin.email, admin.senha)
  const c = await prepararCenarioDeHomologacaoE2E(testInfo.project.name, admin.id)

  await page.goto(`/projetos/${c.projeto.id}/homologacao`)
  await expect(page.getByRole('heading', { name: 'Fila de homologação' })).toBeVisible()
  const filtros = page.getByRole('navigation', { name: 'Filtros da fila' })
  await expect(filtros.getByRole('link', { name: 'Requer minha ação (4)' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByRole('heading', { level: 3, name: c.milestone.titulo })).toBeVisible()
  await expect(
    page.getByRole('list', { name: `Fila da milestone ${c.milestone.titulo}` }),
  ).toBeVisible()

  await page.getByLabel('Cliente').selectOption(c.acme.id)
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect(filtros.getByRole('link', { name: 'Requer minha ação (2)' })).toBeVisible()

  const item = await obterItemDeHomologacaoNoBanco(c.acme.id, c.milestone.id, c.repoUm, 2)
  const ancora = page.locator(`#item-${item!.id}`)
  await ancora.getByRole('link', { name: /^#2 / }).click()
  await expect(page.getByRole('heading', { name: `Homologação de ${c.acme.nome}` })).toBeVisible()

  await page.getByRole('button', { name: 'Disponibilizar ao cliente' }).click()
  await page.getByRole('button', { name: 'Confirmar disponibilização' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: `Issue disponibilizada para ${c.acme.nome}.` }),
  ).toBeVisible()

  await page.getByRole('link', { name: 'Voltar à fila' }).first().click()
  await expect(page).toHaveURL(new RegExp(`/projetos/${c.projeto.id}/homologacao\\?`))
  const url = new URL(page.url())
  expect(url.searchParams.get('filtro')).toBe('requer-minha-acao')
  expect(url.searchParams.get('cliente')).toBe(c.acme.id)
  expect(url.hash).toBe(`#item-${item!.id}`)
  // Depois de disponibilizada, #2 de Acme continua em "Requer minha ação" (o admin pode agir).
  await expect(page.locator(`#item-${item!.id}`)).toBeInViewport()
})

test('retorno=https://mal.example não mostra "Voltar à fila"', async ({ page }, testInfo) => {
  const admin = obterAdmin()
  await fazerLogin(page, admin.email, admin.senha)
  const c = await prepararCenarioDeHomologacaoE2E(testInfo.project.name, admin.id)
  const url = urlDaIssue(c.acme.id, c.projeto.id, c.issueUm2.id, c.milestone.id)

  for (const ruim of ['https://mal.example', '//mal.example']) {
    await page.goto(`${url}&retorno=${encodeURIComponent(ruim)}`)
    await expect(page.getByRole('heading', { name: `Homologação de ${c.acme.nome}` })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Voltar à fila' })).toHaveCount(0)
  }

  const valido = `/projetos/${c.projeto.id}/homologacao?filtro=todos`
  await page.goto(`${url}&retorno=${encodeURIComponent(valido)}`)
  await expect(page.getByRole('link', { name: 'Voltar à fila' })).toHaveAttribute('href', valido)
})

test('mobile: fila e issue sem rolagem horizontal (scrollWidth ≤ innerWidth)', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Só no projeto mobile.')
  const admin = obterAdmin()
  await fazerLogin(page, admin.email, admin.senha)
  const c = await prepararCenarioDeHomologacaoE2E(testInfo.project.name, admin.id)

  const semRolagem = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

  await page.goto(`/projetos/${c.projeto.id}/homologacao`)
  await expect(page.getByRole('heading', { name: 'Fila de homologação' })).toBeVisible()
  expect(await semRolagem()).toBe(true)

  await page.goto(urlDaIssue(c.acme.id, c.projeto.id, c.issueUm2.id, c.milestone.id))
  await expect(page.getByRole('heading', { name: `Homologação de ${c.acme.nome}` })).toBeVisible()
  expect(await semRolagem()).toBe(true)
})

test('após disponibilizar #1 para Acme: aba Homologação global mostra Acme "1 pendente de teste · 1 aguardando disponibilização" e Beta "2 aguardando disponibilização"; Entregas mostra "Homologação: 2 clientes · …"; /clientes/<acme> lista E2E Release 1 em Homologações pendentes; Resumo do Projeto lista a pendência', async ({
  page,
}, testInfo) => {
  const admin = obterAdmin()
  await fazerLogin(page, admin.email, admin.senha)
  const c = await prepararCenarioDeHomologacaoE2E(testInfo.project.name, admin.id)
  const item = await obterItemDeHomologacaoNoBanco(c.acme.id, c.milestone.id, c.repoUm, 1)
  await disponibilizarNoBanco(item!.id, admin.id)

  await page.goto(`/projetos/${c.projeto.id}/entregas/milestones/${c.milestone.id}?aba=homologacao`)
  const porCliente = page.getByRole('list', { name: 'Homologação por cliente' })
  await expect(porCliente.getByRole('listitem').filter({ hasText: c.acme.nome })).toContainText(
    '1 pendente de teste · 1 aguardando disponibilização',
  )
  await expect(porCliente.getByRole('listitem').filter({ hasText: c.beta.nome })).toContainText(
    '2 aguardando disponibilização',
  )

  await page.goto(`/projetos/${c.projeto.id}/entregas`)
  await expect(
    page.getByText('Homologação: 2 clientes · 1 pendente de teste · 3 aguardando disponibilização'),
  ).toBeVisible()

  await page.goto(`/clientes/${c.acme.id}`)
  const pendentes = page.getByRole('list', { name: 'Homologações pendentes' })
  const linha = pendentes.getByRole('listitem').filter({ hasText: c.milestone.titulo })
  await expect(linha).toContainText('1 pendente de teste · 1 aguardando disponibilização')
  await expect(linha.getByRole('link', { name: c.milestone.titulo })).toHaveAttribute(
    'href',
    `/clientes/${c.acme.id}/projetos/${c.projeto.id}/homologacao?filtro=todos&milestone=${c.milestone.id}`,
  )

  await page.goto(`/projetos/${c.projeto.id}`)
  await expect(
    page.getByRole('heading', { level: 3, name: 'Homologações pendentes' }),
  ).toBeVisible()
  const noResumo = page
    .getByRole('list', { name: 'Homologações pendentes' })
    .getByRole('listitem')
    .filter({ hasText: c.acme.nome })
  await expect(noResumo).toContainText(c.milestone.titulo)
  await expect(noResumo).toContainText('1 pendente de teste · 1 aguardando disponibilização')
})
