import { expect, test, type Page } from '@playwright/test'
import {
  aprovarItemNoBanco,
  contarEventosNoBanco,
  criarUsuarioNoBanco,
  fecharIssueNoBanco,
  obterCorrecaoCriadaNoBanco,
  obterItemNoBanco,
  prepararHomologacaoE2E,
  registrarVersaoEmQaNoBanco,
  solicitarCorrecaoNoBanco,
  type HomologacaoE2E,
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

function urlDaIssue(h: HomologacaoE2E, clienteId: string, issueId: string): string {
  return `/clientes/${clienteId}/projetos/${h.projetoId}/entregas/issues/${issueId}?milestone=${h.milestoneId}`
}

let h: HomologacaoE2E
let rotuloV1: string
let rotuloV2: string

test.beforeEach(async ({ page }, testInfo) => {
  const admin = obterAdmin()
  h = await prepararHomologacaoE2E(testInfo.project.name, admin.id)
  rotuloV1 = `${h.cenario.prefixo} v1`
  rotuloV2 = `${h.cenario.prefixo} v2`
  await solicitarCorrecaoNoBanco(h, h.clienteAId, h.issues.n2, 'O botão não salva.')
  await aprovarItemNoBanco(h, h.clienteBId, h.issues.n2)
  await fazerLogin(page, admin.email, admin.senha)
})

test('admin cria a correção pela tela, worker conclui, correção fechada e v2 registrada em QA, worker roda: A vê "Aguardando reteste" e "Versão atual em QA: v2"; a rodada v1 está recolhida e abre ao clicar; B vê "Aprovada" na #2', async ({
  page,
}) => {
  await page.goto(urlDaIssue(h, h.clienteAId, h.issues.n2))
  await page.getByLabel('Criar issue de correção vinculada').check()
  await page.getByRole('button', { name: 'Criar issue no GitHub' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Triagem registrada. O worker cria a issue' }),
  ).toBeVisible()

  rodarWorkerUmaVez()
  const correcao = await obterCorrecaoCriadaNoBanco(h.issues.n2)
  expect(correcao).not.toBeNull()

  // Depois do último worker que reconcilia o repositório (regra do plano).
  await fecharIssueNoBanco(correcao!.id)
  await registrarVersaoEmQaNoBanco(h.cenario, 'v2', [correcao!.id, h.issues.n2])
  rodarWorkerUmaVez()

  await page.goto(urlDaIssue(h, h.clienteAId, h.issues.n2))
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByText('Aguardando reteste', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(`Versão atual em QA: ${rotuloV2}`)).toBeVisible()
  await expect(
    page.getByText(`Correção #${correcao!.numero} presente em QA na versão ${rotuloV2}`),
  ).toBeVisible()

  const rodadaAnterior = page.locator('details').filter({ hasText: `Versão ${rotuloV1} ·` })
  await expect(page.getByRole('heading', { name: 'Rodadas anteriores' })).toBeVisible()
  await expect(rodadaAnterior).toHaveCount(1)
  await expect(rodadaAnterior.getByText('Disponibilizada ao cliente')).toBeHidden()
  await expect(rodadaAnterior).not.toHaveAttribute('open', '')
  await rodadaAnterior.locator('summary').click()
  await expect(rodadaAnterior.getByText('Disponibilizada ao cliente')).toBeVisible()

  await page.goto(urlDaIssue(h, h.clienteBId, h.issues.n2))
  await expect(page.getByText('Aprovada', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Aguardando reteste')).toHaveCount(0)
  expect((await obterItemNoBanco(h.clienteBId, h.issues.n2)).estado).toBe('APROVADA')
})

test('sem evidência: admin responde sem tarefa e confirma o reteste na v1 com justificativa; aparece "Reteste confirmado manualmente na versão v1"', async ({
  page,
}) => {
  await page.goto(urlDaIssue(h, h.clienteAId, h.issues.n2))
  await page.getByLabel('Responder sem abrir tarefa').check()
  await page.getByLabel('Resposta').fill('Já corrigido na versão em QA.')
  await page.getByRole('button', { name: 'Registrar resposta' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Resposta registrada.' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Reteste', exact: true })).toBeVisible()
  await expect(
    page.getByText('Nenhuma correção com tarefa no GitHub. Se a correção já está em QA'),
  ).toBeVisible()

  await page.getByLabel('Versão em QA').selectOption(h.versaoV1Id)
  await page.getByLabel('Justificativa').fill('Conferi a correção na versão em QA.')
  await page.getByRole('button', { name: 'Confirmar reteste' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Reteste confirmado manualmente.' }),
  ).toBeVisible()

  await page.reload()
  await expect(
    page.getByText(
      `Reteste confirmado manualmente na versão ${rotuloV1}: Conferi a correção na versão em QA.`,
    ),
  ).toBeVisible()
  await expect(page.getByText('Aguardando reteste', { exact: true }).first()).toBeVisible()
  expect((await obterItemNoBanco(h.clienteAId, h.issues.n2)).estado).toBe('AGUARDANDO_RETESTE')
})

test('aprovador do cliente A não vê "Confirmar reteste"; POST forjado não muda obterItemNoBanco', async ({
  page,
  browser,
}) => {
  await page.goto(urlDaIssue(h, h.clienteAId, h.issues.n2))
  await page.getByLabel('Responder sem abrir tarefa').check()
  await page.getByLabel('Resposta').fill('Já corrigido na versão em QA.')
  await page.getByRole('button', { name: 'Registrar resposta' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Resposta registrada.' })).toBeVisible()

  // Captura a requisição real da Server Action e a aborta: o servidor não a recebe.
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
  await page.getByLabel('Justificativa').fill('Conferi a correção na versão em QA.')
  await page.getByRole('button', { name: 'Confirmar reteste' }).click()
  await expect.poll(() => capturada).not.toBeNull()
  await page.unroute('**/*')
  const requisicao = capturada!
  expect((await obterItemNoBanco(h.clienteAId, h.issues.n2)).estado).toBe('CORRECAO_SOLICITADA')

  const email = `e2e+aprovador-${Date.now()}@local.test`
  const senha = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email,
    nome: 'E2E Aprovador Reteste',
    senha,
    papel: 'APROVADOR',
    clienteId: h.clienteAId,
  })
  const contexto = await browser.newContext()
  try {
    const paginaAprovador = await contexto.newPage()
    await fazerLogin(paginaAprovador, email, senha)
    await paginaAprovador.goto(urlDaIssue(h, h.clienteAId, h.issues.n2))
    await expect(paginaAprovador.getByRole('heading', { name: /^Homologação de / })).toBeVisible()
    await expect(paginaAprovador.getByRole('button', { name: 'Confirmar reteste' })).toHaveCount(0)
    await expect(
      paginaAprovador.getByRole('heading', { name: 'Reteste', exact: true }),
    ).toHaveCount(0)

    const antes = await obterItemNoBanco(h.clienteAId, h.issues.n2)
    const eventosAntes = await contarEventosNoBanco(h.clienteAId, h.issues.n2)
    const resposta = await contexto.request.post(requisicao.url, {
      headers: {
        'next-action': requisicao.headers['next-action'] as string,
        'content-type': requisicao.headers['content-type'] as string,
      },
      data: requisicao.corpo,
    })
    expect(resposta.status()).toBeLessThan(500)
    expect(await obterItemNoBanco(h.clienteAId, h.issues.n2)).toEqual(antes)
    expect(await contarEventosNoBanco(h.clienteAId, h.issues.n2)).toBe(eventosAntes)

    // Controle positivo: a mesma requisição, enviada pelo admin, confirma o reteste.
    await page.request.post(requisicao.url, {
      headers: {
        'next-action': requisicao.headers['next-action'] as string,
        'content-type': requisicao.headers['content-type'] as string,
      },
      data: requisicao.corpo,
    })
    expect((await obterItemNoBanco(h.clienteAId, h.issues.n2)).estado).toBe('AGUARDANDO_RETESTE')
  } finally {
    await contexto.close()
  }
})
