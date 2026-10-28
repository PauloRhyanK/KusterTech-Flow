import { expect, test, type Page } from '@playwright/test'
import {
  aprovarItemNoBanco,
  criarUsuarioNoBanco,
  fecharIssueNoBanco,
  obterEstadoDaHomologacaoNoBanco,
  prepararHomologacaoE2E,
  type HomologacaoE2E,
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

function urlDaMilestoneDoCliente(h: HomologacaoE2E, clienteId: string): string {
  return `/clientes/${clienteId}/projetos/${h.projetoId}/entregas/milestones/${h.milestoneId}?aba=homologacao`
}

function urlDaMilestoneGlobal(h: HomologacaoE2E): string {
  return `/projetos/${h.projetoId}/entregas/milestones/${h.milestoneId}?aba=homologacao`
}

async function criarAprovadorDoCliente(
  clienteId: string,
): Promise<{ email: string; senha: string }> {
  const email = `e2e+aprovador-milestone-${Date.now()}@local.test`
  const senha = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email,
    nome: 'E2E Aprovador Milestone',
    senha,
    papel: 'APROVADOR',
    clienteId,
  })
  return { email, senha }
}

let h: HomologacaoE2E

test.beforeEach(async ({ page }, testInfo) => {
  const admin = obterAdmin()
  h = await prepararHomologacaoE2E(testInfo.project.name, admin.id)
  // O cliente A já aprovou as duas issues; o B continua com os itens pendentes de teste.
  await aprovarItemNoBanco(h, h.clienteAId, h.issues.n2)
  await aprovarItemNoBanco(h, h.clienteAId, h.issues.n4)
  await fazerLogin(page, admin.email, admin.senha)
})

test('com a #2 aberta, a aba Homologação do cliente A mostra "1 issue do escopo ainda está aberta no GitHub." e nenhum botão "Aprovar milestone"', async ({
  page,
}) => {
  await page.goto(urlDaMilestoneDoCliente(h, h.clienteAId))

  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Aprovação da milestone' })).toBeVisible()
  await expect(page.getByText('1 issue do escopo ainda está aberta no GitHub.')).toBeVisible()
  await expect(page.getByText('Issues do escopo fechadas: 1 de 2')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Aprovar milestone' })).toHaveCount(0)
})

test('com #2 fechada no banco, aprovador do cliente A confere cliente, milestone e "Versões avaliadas", confirma e vê "Milestone aprovada para …"; a visão global mostra "2 clientes · 1 com milestone aprovada · 1 em andamento" e "Ver itens de <B>" expande os itens de B', async ({
  page,
  browser,
}) => {
  await fecharIssueNoBanco(h.issues.n2)
  const aprovador = await criarAprovadorDoCliente(h.clienteAId)
  const contexto = await browser.newContext()
  try {
    const paginaDoAprovador = await contexto.newPage()
    await fazerLogin(paginaDoAprovador, aprovador.email, aprovador.senha)
    await paginaDoAprovador.goto(urlDaMilestoneDoCliente(h, h.clienteAId))

    await expect(paginaDoAprovador.getByText(`Cliente: ${h.clienteANome}`)).toBeVisible()
    await expect(
      paginaDoAprovador.getByText(`Milestone: ${h.cenario.prefixo} Milestone`),
    ).toBeVisible()
    await expect(
      paginaDoAprovador.getByText(`Versões avaliadas: ${h.cenario.prefixo} v1 (${h.repositorio})`),
    ).toBeVisible()
    await expect(paginaDoAprovador.getByText('Issues do escopo fechadas: 2 de 2')).toBeVisible()
    await expect(paginaDoAprovador.getByText('Correções bloqueadoras: 0')).toBeVisible()

    await paginaDoAprovador.getByRole('button', { name: 'Aprovar milestone' }).click()
    await paginaDoAprovador
      .getByRole('button', { name: `Confirmar aprovação para ${h.clienteANome}` })
      .click()
    await expect(
      paginaDoAprovador
        .getByRole('status')
        .filter({ hasText: `Milestone aprovada para ${h.clienteANome}.` }),
    ).toBeVisible()
    await expect(paginaDoAprovador.getByText('Milestone aprovada', { exact: true })).toBeVisible()
    await expect(paginaDoAprovador.getByRole('button', { name: 'Aprovar milestone' })).toHaveCount(
      0,
    )
  } finally {
    await contexto.close()
  }
  expect((await obterEstadoDaHomologacaoNoBanco(h.clienteAId, h.milestoneId)).estado).toBe(
    'APROVADA',
  )

  await page.goto(urlDaMilestoneGlobal(h))
  await expect(page.getByRole('heading', { name: 'Homologação por cliente' })).toBeVisible()
  await expect(
    page.getByText('2 clientes · 1 com milestone aprovada · 1 em andamento'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Aprovar milestone' })).toHaveCount(0)
  const itensDeB = page.locator('details').filter({ hasText: `Ver itens de ${h.clienteBNome}` })
  await expect(itensDeB.getByText('Pendente de teste').first()).toBeHidden()
  await itensDeB.locator('summary').click()
  await expect(itensDeB.getByText('Pendente de teste')).toHaveCount(2)
  await expect(itensDeB.getByText(/^#2 /)).toBeVisible()
  await expect(
    page.getByRole('link', { name: `Abrir homologação de ${h.clienteBNome}` }),
  ).toHaveAttribute('href', urlDaMilestoneDoCliente(h, h.clienteBId))
})

test('aprovador do cliente A em /clientes/<B>/…/milestones/<m> vê "Sem permissão"; POST forjado para B não muda a homologação de B', async ({
  page,
  browser,
}) => {
  await fecharIssueNoBanco(h.issues.n2)

  // Captura a requisição real da Server Action de B e a aborta: o servidor não a recebe.
  let capturada: { url: string; headers: Record<string, string>; corpo: Buffer } | null = null
  await page.route('**/*', async (rota) => {
    const requisicao = rota.request()
    if (requisicao.method() === 'POST' && 'next-action' in requisicao.headers()) {
      capturada = {
        url: requisicao.url(),
        headers: requisicao.headers(),
        corpo: requisicao.postDataBuffer() as Buffer,
      }
      await rota.abort()
      return
    }
    await rota.continue()
  })
  await page.goto(urlDaMilestoneDoCliente(h, h.clienteBId))
  await page.getByRole('button', { name: 'Aprovar milestone' }).click()
  await page.getByRole('button', { name: `Confirmar aprovação para ${h.clienteBNome}` }).click()
  await expect.poll(() => capturada).not.toBeNull()
  await page.unroute('**/*')
  const requisicao = capturada!
  expect((await obterEstadoDaHomologacaoNoBanco(h.clienteBId, h.milestoneId)).estado).toBe(
    'EM_ANDAMENTO',
  )

  const aprovador = await criarAprovadorDoCliente(h.clienteAId)
  const contexto = await browser.newContext()
  try {
    const paginaDoAprovador = await contexto.newPage()
    await fazerLogin(paginaDoAprovador, aprovador.email, aprovador.senha)
    await paginaDoAprovador.goto(urlDaMilestoneDoCliente(h, h.clienteBId))
    await expect(paginaDoAprovador.getByText('Sem permissão')).toBeVisible()
    await expect(paginaDoAprovador.getByRole('button', { name: 'Aprovar milestone' })).toHaveCount(
      0,
    )

    const antes = await obterEstadoDaHomologacaoNoBanco(h.clienteBId, h.milestoneId)
    const resposta = await contexto.request.post(requisicao.url, {
      headers: {
        'next-action': requisicao.headers['next-action'] as string,
        'content-type': requisicao.headers['content-type'] as string,
      },
      data: requisicao.corpo,
    })
    expect(resposta.status()).toBeLessThan(500)
    expect(await obterEstadoDaHomologacaoNoBanco(h.clienteBId, h.milestoneId)).toEqual(antes)

    // Controle positivo: a mesma requisição, enviada pelo admin, aprova a milestone de B.
    await page.request.post(requisicao.url, {
      headers: {
        'next-action': requisicao.headers['next-action'] as string,
        'content-type': requisicao.headers['content-type'] as string,
      },
      data: requisicao.corpo,
    })
    expect((await obterEstadoDaHomologacaoNoBanco(h.clienteBId, h.milestoneId)).estado).toBe(
      'APROVADA',
    )
  } finally {
    await contexto.close()
  }
})

test('mobile: painel de aprovação e consolidação sem rolagem horizontal', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Só no projeto mobile.')
  const semRolagem = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )

  await page.goto(urlDaMilestoneDoCliente(h, h.clienteAId))
  await expect(page.getByRole('heading', { name: 'Aprovação da milestone' })).toBeVisible()
  expect(await semRolagem()).toBe(true)

  await page.goto(urlDaMilestoneGlobal(h))
  await expect(page.getByRole('heading', { name: 'Homologação por cliente' })).toBeVisible()
  await page.locator('summary').first().click()
  expect(await semRolagem()).toBe(true)
})
