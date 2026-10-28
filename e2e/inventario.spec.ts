import { expect, test, type Page } from '@playwright/test'
import {
  contarRecursos,
  criarClienteNoBanco,
  criarProjetoNoBanco,
  criarRecursoNoBanco,
  criarUsuarioNoBanco,
  liberarRepositoriosNoBanco,
  nomeDeTeste,
  obterRecursoNoBanco,
  removerRecursoNoBanco,
  repositoriosDoProjetoE2E,
  vincularNoBanco,
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

test.beforeEach(async ({}, testInfo) => {
  await liberarRepositoriosNoBanco(repositoriosDoProjetoE2E(testInfo.project.name))
})

test('admin cadastra servidor com Beszel e container hospedado nele pela tela, associa o container ao projeto e vê os links Beszel, GlitchTip e "GitHub · <repoUm>"', async ({
  page,
}, testInfo) => {
  const [repoUm] = repositoriosDoProjetoE2E(testInfo.project.name)
  await entrarComoAdmin(page)

  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Inventário'))
  await vincularNoBanco(projeto.id, repoUm)
  const nomeServidor = nomeDeTeste('Servidor')
  const nomeContainer = nomeDeTeste('Container')

  await page.goto('/infraestrutura')
  await expect(page.getByRole('heading', { level: 1, name: 'Infraestrutura' })).toBeVisible()
  await page.getByRole('link', { name: 'Cadastrar recurso' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Novo recurso' })).toBeVisible()
  await page.getByLabel('Nome', { exact: true }).fill(nomeServidor)
  await page.getByLabel('Endereço do Beszel').fill('https://beszel.exemplo.test/servidor')
  await page.getByRole('button', { name: 'Cadastrar recurso' }).click()
  await expect(page.getByRole('heading', { level: 1, name: nomeServidor })).toBeVisible()
  const servidor = await obterRecursoNoBanco(nomeServidor)
  expect(servidor).not.toBeNull()

  await page.goto('/infraestrutura/recursos/novo')
  await page.getByLabel('Tipo').selectOption('CONTAINER')
  await page.getByLabel('Nome', { exact: true }).fill(nomeContainer)
  await page.getByLabel('Hospedado em').selectOption({ label: nomeServidor })
  await page.getByLabel('Endereço do Beszel').fill('https://beszel.exemplo.test/container')
  await page.getByLabel('Endereço do GlitchTip').fill('https://glitchtip.exemplo.test/container')
  await page.getByRole('button', { name: 'Cadastrar recurso' }).click()
  await expect(page.getByRole('heading', { level: 1, name: nomeContainer })).toBeVisible()

  const lateral = page.getByRole('complementary')
  await expect(lateral.getByRole('link', { name: nomeServidor })).toHaveAttribute(
    'href',
    `/infraestrutura/recursos/${servidor!.id}`,
  )
  await expect(lateral.getByText('Nenhuma ferramenta configurada para este recurso.')).toHaveCount(
    0,
  )

  await lateral.getByLabel('Projeto', { exact: true }).selectOption({ label: projeto.nome })
  await lateral.getByRole('button', { name: 'Associar' }).click()
  const associados = lateral.getByRole('list', { name: 'Projetos associados' })
  await expect(associados.getByRole('link', { name: projeto.nome })).toBeVisible()

  for (const rotulo of ['Beszel', 'GlitchTip', `GitHub · ${repoUm}`]) {
    const link = lateral.getByRole('link', { name: rotulo })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  }

  await page.goto(`/infraestrutura/recursos/${servidor!.id}`)
  const hospedados = page.getByRole('list', { name: 'Recursos hospedados' })
  await expect(hospedados.getByRole('link', { name: nomeContainer })).toBeVisible()

  await page.goto('/infraestrutura')
  const inventario = page.getByRole('list', { name: 'Inventário de recursos' })
  const linha = inventario.locator('li', { hasText: nomeContainer })
  await expect(linha).toContainText(`Container · Hospedado em ${nomeServidor} · 1 projeto`)
  await expect(linha.locator('[data-tom="neutro"]')).toHaveText('Sem dados')
})

test('nome repetido com outra caixa e acento é recusado com "Já existe um recurso com este nome." e contarRecursos não muda', async ({
  page,
}) => {
  await entrarComoAdmin(page)
  const existente = await criarRecursoNoBanco({
    tipo: 'SERVIDOR',
    nome: nomeDeTeste('Servidor Café'),
  })
  const antes = await contarRecursos()
  const variante = existente.nome.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  expect(variante).not.toBe(existente.nome)

  await page.goto('/infraestrutura/recursos/novo')
  await page.getByLabel('Nome', { exact: true }).fill(variante)
  await page.getByRole('button', { name: 'Cadastrar recurso' }).click()

  await expect(page.getByText('Já existe um recurso com este nome.')).toBeVisible()
  await expect(page).toHaveURL(/\/infraestrutura\/recursos\/novo$/)
  expect(await contarRecursos()).toBe(antes)
})

test('servidor sem fonte mostra CPU, Memória e Disco como Sem dados e nenhum badge de sucesso; mobile sem rolagem horizontal', async ({
  page,
}) => {
  await entrarComoAdmin(page)
  const servidor = await criarRecursoNoBanco({
    tipo: 'SERVIDOR',
    nome: nomeDeTeste('Servidor Sem Fonte'),
  })

  await page.goto(`/infraestrutura/recursos/${servidor.id}`)
  await expect(page.getByRole('heading', { level: 1, name: servidor.nome })).toBeVisible()
  for (const rotulo of ['CPU', 'Memória', 'Disco']) {
    await expect(
      page
        .locator('dt', { hasText: new RegExp(`^${rotulo}$`) })
        .locator('xpath=following-sibling::dd'),
    ).toHaveText('Sem dados')
  }
  await expect(page.getByText('Nenhuma fonte de métricas configurada.')).toBeVisible()
  await expect(page.locator('[data-tom="sucesso"]')).toHaveCount(0)

  await page.goto('/infraestrutura')
  await expect(page.locator('[data-tom="sucesso"]')).toHaveCount(0)
  const semRolagem = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
  expect(semRolagem).toBe(true)
  await page.goto(`/infraestrutura/recursos/${servidor.id}`)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
})

test('testador escopado em /infraestrutura e no recurso vê "Sem permissão para esta área."; POST forjado de cadastrar (capturado do admin, como em repositorios.spec.ts) não cria recurso', async ({
  page,
  browser,
}) => {
  await entrarComoAdmin(page)
  const cliente = await criarClienteNoBanco(nomeDeTeste('Cliente Inventário'))
  const existente = await criarRecursoNoBanco({
    tipo: 'SERVIDOR',
    nome: nomeDeTeste('Servidor Protegido'),
  })

  // Captura a Server Action real de cadastrar (feita pelo admin) para reenviá-la forjada.
  const nomeForjado = nomeDeTeste('Recurso Forjado')
  await page.goto('/infraestrutura/recursos/novo')
  await page.getByLabel('Nome', { exact: true }).fill(nomeForjado)
  const [requisicao] = await Promise.all([
    page.waitForRequest((r) => r.method() === 'POST' && 'next-action' in r.headers()),
    page.getByRole('button', { name: 'Cadastrar recurso' }).click(),
  ])
  await expect(page.getByRole('heading', { level: 1, name: nomeForjado })).toBeVisible()
  const corpo = requisicao.postDataBuffer()
  expect(corpo).not.toBeNull()
  const criadoPeloAdmin = await obterRecursoNoBanco(nomeForjado)
  expect(criadoPeloAdmin).not.toBeNull()
  await removerRecursoNoBanco(criadoPeloAdmin!.id)
  const antes = await contarRecursos()

  const emailTestador = `e2e+testador-infra-${Date.now()}@local.test`
  const senhaTestador = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email: emailTestador,
    nome: 'Testador Infraestrutura',
    senha: senhaTestador,
    papel: 'TESTADOR',
    clienteId: cliente.id,
  })

  const contexto = await browser.newContext()
  try {
    const paginaTestador = await contexto.newPage()
    await fazerLogin(paginaTestador, emailTestador, senhaTestador)

    for (const url of [
      '/infraestrutura',
      `/infraestrutura/recursos/${existente.id}`,
      `/infraestrutura/recursos/${existente.id}/editar`,
      '/infraestrutura/recursos/novo',
    ]) {
      await paginaTestador.goto(url)
      await expect(paginaTestador.getByText('Sem permissão para esta área.')).toBeVisible()
    }
    await paginaTestador.goto('/infraestrutura')
    await expect(paginaTestador.getByRole('link', { name: 'Cadastrar recurso' })).toHaveCount(0)

    const resposta = await contexto.request.post(requisicao.url(), {
      headers: {
        'next-action': requisicao.headers()['next-action'] as string,
        'content-type': requisicao.headers()['content-type'] as string,
      },
      data: corpo as Buffer,
    })
    expect(resposta.status()).toBeLessThan(500)
    expect(await contarRecursos()).toBe(antes)
    expect(await obterRecursoNoBanco(nomeForjado)).toBeNull()

    // Controle positivo: a mesma requisição, enviada pelo admin, cadastra; logo a recusa acima é de autorização.
    await page.request.post(requisicao.url(), {
      headers: {
        'next-action': requisicao.headers()['next-action'] as string,
        'content-type': requisicao.headers()['content-type'] as string,
      },
      data: corpo as Buffer,
    })
    expect(await contarRecursos()).toBe(antes + 1)
  } finally {
    await contexto.close()
  }
})
