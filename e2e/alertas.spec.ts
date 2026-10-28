import { expect, test, type Page } from '@playwright/test'
import {
  contarAlertas,
  criarAlertaNoBanco,
  criarClienteNoBanco,
  criarRecursoNoBanco,
  criarUsuarioNoBanco,
  nomeDeTeste,
  obterAlertaNoBanco,
  obterAlertaPorTituloNoBanco,
  obterFontePorNomeNoBanco,
  reativarAlertaNoBanco,
} from './support/banco'

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

async function entrarComoAdmin(page: Page): Promise<void> {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
}

test('admin registra alerta manual para um recurso, vê na fila e no recurso o mesmo link; reconhece e continua em Não resolvidos com o texto de reconhecimento; registra a resolução com confirmação e o alerta passa a Resolvidos', async ({
  page,
}) => {
  await entrarComoAdmin(page)
  const recurso = await criarRecursoNoBanco({ tipo: 'SERVIDOR', nome: nomeDeTeste('VPS Alertas') })
  const titulo = nomeDeTeste('Disco cheio')

  await page.goto('/infraestrutura/alertas')
  await expect(page.getByRole('heading', { level: 1, name: 'Alertas' })).toBeVisible()
  await page.getByLabel('Título').fill(titulo)
  await page.getByLabel('Severidade').selectOption('ALTA')
  await page.getByLabel('Recurso').selectOption({ label: recurso.nome })
  await page.getByRole('button', { name: 'Registrar alerta' }).click()
  await expect(page.getByText('Alerta registrado.')).toBeVisible()

  const fila = page.getByRole('list', { name: 'Fila de alertas' })
  const linkNaFila = fila.getByRole('link', { name: titulo })
  await expect(linkNaFila).toBeVisible()
  const href = await linkNaFila.getAttribute('href')
  expect(href).toMatch(/^\/infraestrutura\/alertas\/[0-9a-f-]{36}$/)
  await expect(fila.locator('li', { hasText: titulo })).toContainText('Recebido 1 vez')
  await expect(page.getByRole('link', { name: /^Alertas \(\d+ não resolvidos\)$/ })).toBeVisible()

  await page.goto(`/infraestrutura/recursos/${recurso.id}`)
  const noRecurso = page.getByRole('list', { name: 'Problemas prioritários do recurso' })
  await expect(noRecurso.getByRole('link', { name: titulo })).toHaveAttribute('href', href!)

  await noRecurso.getByRole('link', { name: titulo }).click()
  await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Registrar resolução' })).toBeVisible()
  await page.getByRole('button', { name: 'Reconhecer' }).click()
  await expect(page.getByText('Alerta reconhecido.')).toBeVisible()
  await expect(
    page.getByText('O alerta foi reconhecido, mas continua ativo na origem.'),
  ).toBeVisible()

  await page.goto('/infraestrutura/alertas')
  await expect(
    page.getByRole('list', { name: 'Fila de alertas' }).getByRole('link', { name: titulo }),
  ).toBeVisible()

  await page.goto(href!)
  await page.getByRole('button', { name: 'Registrar resolução' }).click()
  await page.getByRole('button', { name: 'Confirmar resolução' }).click()
  await expect(page.getByText(/^Resolução registrada por .+ em .+\.$/).first()).toBeVisible()
  const salvo = await obterAlertaPorTituloNoBanco(titulo)
  expect(salvo?.estado).toBe('RESOLVIDO_NA_ORIGEM')

  await page.goto('/infraestrutura/alertas')
  await expect(page.getByRole('link', { name: titulo })).toHaveCount(0)
  await page.goto('/infraestrutura/alertas?estado=resolvidos')
  await expect(page.getByRole('link', { name: titulo })).toBeVisible()
})

test('fonte de alertas: o token aparece uma vez; ao recarregar só o nome e "Nunca usada"; no banco tokenHash tem 64 caracteres e difere do token; revogar pede confirmação e mostra "Revogada"', async ({
  page,
}) => {
  await entrarComoAdmin(page)
  const nome = nomeDeTeste('Fonte')

  await page.goto('/infraestrutura/alertas')
  await page.getByLabel('Nome', { exact: true }).fill(nome)
  await page.getByRole('button', { name: 'Criar fonte' }).click()

  const codigo = page.locator('#fontes code')
  await expect(codigo).toBeVisible()
  const token = (await codigo.textContent()) ?? ''
  expect(token.startsWith('fa_')).toBe(true)
  await expect(page.getByText(/Copie agora; o token não será mostrado de novo\./)).toBeVisible()

  await page.reload()
  await expect(page.locator('#fontes code')).toHaveCount(0)
  const linha = page.getByRole('list', { name: 'Fontes de alertas' }).locator('li', {
    hasText: nome,
  })
  await expect(linha).toContainText('Nunca usada')
  await expect(page.getByText(token)).toHaveCount(0)

  const fonte = await obterFontePorNomeNoBanco(nome)
  expect(fonte).not.toBeNull()
  expect(fonte!.tokenHash).toHaveLength(64)
  expect(fonte!.tokenHash).not.toBe(token)

  await linha.getByRole('button', { name: 'Revogar' }).click()
  expect((await obterFontePorNomeNoBanco(nome))!.revogadaEm).toBeNull()
  await linha.getByRole('button', { name: 'Confirmar revogação' }).click()
  await expect(linha.getByText('Revogada')).toBeVisible()
  expect((await obterFontePorNomeNoBanco(nome))!.revogadaEm).not.toBeNull()
})

test('testador escopado em /infraestrutura/alertas e no alerta vê "Sem permissão para esta área."; POST forjado de reconhecer não muda o estado (obterAlertaNoBanco continua ATIVO)', async ({
  page,
  browser,
}) => {
  await entrarComoAdmin(page)
  const cliente = await criarClienteNoBanco(nomeDeTeste('Cliente Alertas'))
  const alerta = await criarAlertaNoBanco({
    titulo: nomeDeTeste('Alerta Protegido'),
    severidade: 'CRITICA',
  })

  // Captura a Server Action real de reconhecer (feita pelo admin) para reenviá-la forjada.
  await page.goto(`/infraestrutura/alertas/${alerta.id}`)
  const [requisicao] = await Promise.all([
    page.waitForRequest((r) => r.method() === 'POST' && 'next-action' in r.headers()),
    page.getByRole('button', { name: 'Reconhecer' }).click(),
  ])
  await expect(page.getByText('Alerta reconhecido.')).toBeVisible()
  const corpo = requisicao.postDataBuffer()
  expect(corpo).not.toBeNull()
  await reativarAlertaNoBanco(alerta.id)
  const alertasAntes = await contarAlertas()

  const emailTestador = `e2e+testador-alertas-${Date.now()}@local.test`
  const senhaTestador = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email: emailTestador,
    nome: 'Testador Alertas',
    senha: senhaTestador,
    papel: 'TESTADOR',
    clienteId: cliente.id,
  })

  const contexto = await browser.newContext()
  try {
    const paginaTestador = await contexto.newPage()
    await fazerLogin(paginaTestador, emailTestador, senhaTestador)

    for (const url of ['/infraestrutura/alertas', `/infraestrutura/alertas/${alerta.id}`]) {
      await paginaTestador.goto(url)
      await expect(paginaTestador.getByText('Sem permissão para esta área.')).toBeVisible()
    }
    await expect(paginaTestador.getByRole('button', { name: 'Reconhecer' })).toHaveCount(0)

    const cabecalhos = {
      'next-action': requisicao.headers()['next-action'] as string,
      'content-type': requisicao.headers()['content-type'] as string,
    }
    const resposta = await contexto.request.post(requisicao.url(), {
      headers: cabecalhos,
      data: corpo as Buffer,
    })
    expect(resposta.status()).toBeLessThan(500)
    expect((await obterAlertaNoBanco(alerta.id)).estado).toBe('ATIVO')
    expect(await contarAlertas()).toBe(alertasAntes)

    // Controle positivo: a mesma requisição, enviada pelo admin, reconhece; logo a recusa acima é de autorização.
    await page.request.post(requisicao.url(), { headers: cabecalhos, data: corpo as Buffer })
    expect((await obterAlertaNoBanco(alerta.id)).estado).toBe('RECONHECIDO')
  } finally {
    await contexto.close()
  }
})
