import { expect, test, type Page } from '@playwright/test'
import { MENSAGEM_TENTATIVAS_ESGOTADAS } from '@/modules/homologacao/model'
import {
  contarEventosNoBanco,
  contarTarefasGitHub,
  criarUsuarioNoBanco,
  definirTarefaNoBanco,
  obterSolicitacaoNoBanco,
  obterTarefaDaSolicitacao,
  prepararHomologacaoE2E,
  restaurarSolicitacaoNoBanco,
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
let solicitacaoDaN4: string

test.beforeEach(async ({ page }, testInfo) => {
  const admin = obterAdmin()
  h = await prepararHomologacaoE2E(testInfo.project.name, admin.id)
  solicitacaoDaN4 = await solicitarCorrecaoNoBanco(
    h,
    h.clienteAId,
    h.issues.n4,
    'O botão não salva.',
  )
  await fazerLogin(page, admin.email, admin.senha)
})

test('admin reabre a #4 do cliente A: vê "Reabertura no GitHub pendente"; após rodarWorkerUmaVez vê "Issue #4 reaberta no GitHub"; a #4 no contexto do cliente B não mostra o bloco de correção', async ({
  page,
}) => {
  await page.goto(urlDaIssue(h, h.clienteAId, h.issues.n4))
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Correção', exact: true })).toBeVisible()
  await expect(page.getByText('Aguardando triagem')).toBeVisible()

  await page.getByLabel('Reabrir a issue #4 no GitHub').check()
  await page.getByRole('button', { name: 'Reabrir #4 no GitHub' }).click()
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Triagem registrada. O worker faz a reabertura em até 30 s.' }),
  ).toBeVisible()
  await expect(page.getByText('Reabertura no GitHub pendente')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Decisão da triagem' })).toHaveCount(0)
  expect(await contarTarefasGitHub(h.repositorio)).toBe(1)

  rodarWorkerUmaVez()
  await page.reload()
  await expect(page.getByText('Issue #4 reaberta no GitHub', { exact: true }).first()).toBeVisible()
  expect((await obterSolicitacaoNoBanco(solicitacaoDaN4)).estado).toBe('REABERTA_NO_GITHUB')

  await page.goto(urlDaIssue(h, h.clienteBId, h.issues.n4))
  await expect(page.getByRole('heading', { name: /^Homologação de / })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Correção', exact: true })).toHaveCount(0)
})

test('admin responde sem tarefa como Compartilhável: "Respondida sem tarefa" e a resposta na timeline; contarTarefasGitHub inalterado', async ({
  page,
}) => {
  const tarefasAntes = await contarTarefasGitHub(h.repositorio)
  await page.goto(urlDaIssue(h, h.clienteAId, h.issues.n4))

  await page.getByLabel('Responder sem abrir tarefa').check()
  await page.getByLabel('Resposta').fill('O comportamento está conforme o combinado.')
  await expect(page.getByLabel('Compartilhável com o cliente')).toBeChecked()
  await page.getByRole('button', { name: 'Registrar resposta' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Resposta registrada.' })).toBeVisible()
  await expect(page.getByText('Respondida sem tarefa')).toBeVisible()
  await expect(page.getByText('O comportamento está conforme o combinado.')).toBeVisible()
  expect(await contarTarefasGitHub(h.repositorio)).toBe(tarefasAntes)
  expect((await obterSolicitacaoNoBanco(solicitacaoDaN4)).estado).toBe('RESPONDIDA_SEM_TAREFA')
})

test('tarefa forçada para FALHOU mostra "Falha no GitHub: O GitHub não concluiu a operação depois de 3 tentativas. …" e a triagem volta a ser oferecida', async ({
  page,
}) => {
  await page.goto(urlDaIssue(h, h.clienteAId, h.issues.n4))
  await page.getByRole('button', { name: 'Reabrir #4 no GitHub' }).click()
  await expect(page.getByText('Reabertura no GitHub pendente')).toBeVisible()

  const tarefa = await obterTarefaDaSolicitacao(solicitacaoDaN4)
  await definirTarefaNoBanco(tarefa!.id, {
    estado: 'FALHOU',
    falhaMotivo: MENSAGEM_TENTATIVAS_ESGOTADAS,
  })
  await page.reload()

  await expect(page.getByText(`Falha no GitHub: ${MENSAGEM_TENTATIVAS_ESGOTADAS}`)).toBeVisible()
  await expect(page.getByRole('group', { name: 'Decisão da triagem' })).toBeVisible()
})

test('testador do cliente A não vê "Decisão da triagem"; POST forjado da triagem (como em repositorios.spec.ts) não cria tarefa', async ({
  page,
  browser,
}) => {
  // Requisição real da Server Action de triagem, feita pelo admin, para reenviar forjada.
  await page.goto(urlDaIssue(h, h.clienteAId, h.issues.n4))
  const [requisicao] = await Promise.all([
    page.waitForRequest((r) => r.method() === 'POST' && 'next-action' in r.headers()),
    page.getByRole('button', { name: 'Reabrir #4 no GitHub' }).click(),
  ])
  await expect(page.getByText('Reabertura no GitHub pendente')).toBeVisible()
  const corpo = requisicao.postDataBuffer()
  expect(corpo).not.toBeNull()
  await restaurarSolicitacaoNoBanco(solicitacaoDaN4)
  expect(await contarTarefasGitHub(h.repositorio)).toBe(0)

  const email = `e2e+testador-${Date.now()}@local.test`
  const senha = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email,
    nome: 'E2E Testador Triagem',
    senha,
    papel: 'TESTADOR',
    clienteId: h.clienteAId,
  })
  const contexto = await browser.newContext()
  try {
    const paginaTestador = await contexto.newPage()
    await fazerLogin(paginaTestador, email, senha)
    await paginaTestador.goto(urlDaIssue(h, h.clienteAId, h.issues.n4))
    await expect(paginaTestador.getByText('Aguardando triagem')).toBeVisible()
    await expect(paginaTestador.getByRole('group', { name: 'Decisão da triagem' })).toHaveCount(0)

    const eventosAntes = await contarEventosNoBanco(h.clienteAId, h.issues.n4)
    const resposta = await contexto.request.post(requisicao.url(), {
      headers: {
        'next-action': requisicao.headers()['next-action'] as string,
        'content-type': requisicao.headers()['content-type'] as string,
      },
      data: corpo as Buffer,
    })
    expect(resposta.status()).toBeLessThan(500)
    expect(await contarTarefasGitHub(h.repositorio)).toBe(0)
    expect(await contarEventosNoBanco(h.clienteAId, h.issues.n4)).toBe(eventosAntes)
    expect(await obterSolicitacaoNoBanco(solicitacaoDaN4)).toMatchObject({
      estado: 'ABERTA',
      triadaEm: null,
    })

    // Controle positivo: a mesma requisição, enviada pelo admin, cria a tarefa.
    await page.request.post(requisicao.url(), {
      headers: {
        'next-action': requisicao.headers()['next-action'] as string,
        'content-type': requisicao.headers()['content-type'] as string,
      },
      data: corpo as Buffer,
    })
    expect(await contarTarefasGitHub(h.repositorio)).toBe(1)
  } finally {
    await contexto.close()
  }
})
