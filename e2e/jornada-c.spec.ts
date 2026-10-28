import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  contarSolicitacoesAbertasNoBanco,
  criarUsuarioNoBanco,
  liberarRepositoriosNoBanco,
  limparImplantacaoDosRepositoriosNoBanco,
  obterItemDeHomologacaoNoBanco,
  prepararCenarioDeHomologacaoE2E,
  repositoriosDoProjetoE2E,
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

async function capturar(page: Page, projeto: string, nomeArquivo: string): Promise<void> {
  const caminho = path.join('e2e', 'capturas', projeto, nomeArquivo)
  fs.mkdirSync(path.dirname(caminho), { recursive: true })
  await page.screenshot({ path: caminho, fullPage: true })
}

async function semRolagemHorizontal(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
}

test.beforeEach(async ({}, testInfo) => {
  const repositorios = repositoriosDoProjetoE2E(testInfo.project.name)
  await liberarRepositoriosNoBanco(repositorios)
  await limparImplantacaoDosRepositoriosNoBanco(repositorios)
})

test('Jornada C até a solicitação de correção: entrada pelo worker, disponibilizar, aprovar, solicitar correção com retorno à fila e isolamento de Beta', async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const projeto = testInfo.project.name
  const mobile = projeto === 'mobile'
  const admin = obterAdmin()
  await fazerLogin(page, admin.email, admin.senha)

  // A fila nasce da tarefa do ciclo do worker, não de uma chamada direta ao módulo.
  const c = await prepararCenarioDeHomologacaoE2E(projeto, admin.id, { atualizarFila: false })
  expect(c.itensCriados).toBe(0)
  expect(await obterItemDeHomologacaoNoBanco(c.acme.id, c.milestone.id, c.repoUm, 2)).toBeNull()
  rodarWorkerUmaVez()
  const betaUm = await obterItemDeHomologacaoNoBanco(c.beta.id, c.milestone.id, c.repoUm, 1)
  const betaDois = await obterItemDeHomologacaoNoBanco(c.beta.id, c.milestone.id, c.repoUm, 2)
  expect(betaUm?.estado).toBe('AGUARDANDO_DISPONIBILIZACAO')
  expect(betaDois?.estado).toBe('AGUARDANDO_DISPONIBILIZACAO')

  const verificarSemRolagem = async (page: Page) => {
    if (mobile) expect(await semRolagemHorizontal(page)).toBe(true)
  }

  await test.step('1. Admin vê Acme e Beta na issue global repoUm #2', async () => {
    await page.goto(`/projetos/${c.projeto.id}/entregas/issues/${c.issueUm2.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Homologação por cliente' })).toBeVisible()
    const lista = page.getByRole('list', { name: 'Homologação por cliente' })
    await expect(lista.getByRole('listitem').filter({ hasText: c.acme.nome })).toBeVisible()
    await expect(lista.getByRole('listitem').filter({ hasText: c.beta.nome })).toBeVisible()
    await verificarSemRolagem(page)
    await capturar(page, projeto, 'c1-issue-global.png')
  })

  await test.step('2. Admin filtra a fila global por Acme e disponibiliza #1 e #2', async () => {
    await page.goto(`/projetos/${c.projeto.id}/homologacao`)
    const filtros = page.getByRole('navigation', { name: 'Filtros da fila' })
    await expect(filtros.getByRole('link', { name: 'Requer minha ação (4)' })).toBeVisible()
    await page.getByLabel('Cliente').selectOption(c.acme.id)
    await page.getByRole('button', { name: 'Filtrar' }).click()
    await expect(page).toHaveURL(new RegExp(`cliente=${c.acme.id}`))
    await expect(filtros.getByRole('link', { name: 'Requer minha ação (2)' })).toBeVisible()

    for (const [numero, issue] of [
      [1, c.issueUm1],
      [2, c.issueUm2],
    ] as const) {
      const item = await obterItemDeHomologacaoNoBanco(c.acme.id, c.milestone.id, c.repoUm, numero)
      await page
        .locator(`#item-${item!.id}`)
        .getByRole('link', { name: new RegExp(`^#${numero} `) })
        .click()
      await expect(
        page.getByRole('heading', { name: `Homologação de ${c.acme.nome}` }),
      ).toBeVisible()
      expect(page.url()).toContain(issue.id)
      await page.getByRole('button', { name: 'Disponibilizar ao cliente' }).click()
      await expect(
        page.getByText(
          `Disponibilizar a issue #${numero} para teste de ${c.acme.nome} na versão E2E qa-1?`,
        ),
      ).toBeVisible()
      if (numero === 2) await capturar(page, projeto, 'c2-disponibilizar.png')
      await page.getByRole('button', { name: 'Confirmar disponibilização' }).click()
      await expect(
        page.getByRole('status').filter({ hasText: `Issue disponibilizada para ${c.acme.nome}.` }),
      ).toBeVisible()
      await verificarSemRolagem(page)

      await page.getByRole('link', { name: 'Voltar à fila' }).first().click()
      await expect(page).toHaveURL(new RegExp(`/projetos/${c.projeto.id}/homologacao\\?`))
      const url = new URL(page.url())
      expect(url.searchParams.get('filtro')).toBe('requer-minha-acao')
      expect(url.searchParams.get('cliente')).toBe(c.acme.id)
      expect(url.hash).toBe(`#item-${item!.id}`)
      await expect(page.locator(`#item-${item!.id}`)).toBeInViewport()
    }
  })

  const filaDoCliente = `/clientes/${c.acme.id}/projetos/${c.projeto.id}/homologacao`

  const aprovador = await entrarComo(browser, 'APROVADOR', c.acme.id, 'aprovador-acme')
  const testador = await entrarComo(browser, 'TESTADOR', c.acme.id, 'testador-acme')
  const aprovadorBeta = await entrarComo(browser, 'APROVADOR', c.beta.id, 'aprovador-beta')
  try {
    await test.step('3. Aprovador de Acme aprova #1', async () => {
      const p = aprovador.page
      await p.goto(`/clientes/${c.acme.id}`)
      const pendentes = p.getByRole('list', { name: 'Homologações pendentes' })
      await expect(
        pendentes.getByRole('listitem').filter({ hasText: c.milestone.titulo }),
      ).toContainText('2 pendentes de teste')

      await p.goto(filaDoCliente)
      const item = await obterItemDeHomologacaoNoBanco(c.acme.id, c.milestone.id, c.repoUm, 1)
      await p.locator(`#item-${item!.id}`).getByRole('link', { name: /^#1 / }).click()
      await expect(p.getByRole('heading', { name: `Homologação de ${c.acme.nome}` })).toBeVisible()
      await p.getByRole('button', { name: 'Testado e aprovado' }).click()
      await p.getByRole('button', { name: 'Revisar aprovação' }).click()
      await p.getByRole('button', { name: 'Confirmar aprovação' }).click()
      await expect(
        p.getByRole('status').filter({ hasText: `Aprovação registrada para ${c.acme.nome}.` }),
      ).toBeVisible()
      const grupo = p.locator('details[open]').filter({ hasText: 'Versão atual em QA: E2E qa-1' })
      await expect(grupo).toContainText('Testado e aprovado')
      await verificarSemRolagem(p)
      await capturar(p, projeto, 'c3-aprovacao.png')
    })

    await test.step('4. Testador de Acme solicita correção de #2 e volta à fila', async () => {
      const p = testador.page
      await p.goto(filaDoCliente)
      const filtros = p.getByRole('navigation', { name: 'Filtros da fila' })
      await filtros.getByRole('link', { name: 'Todos (2)' }).click()
      await expect(p).toHaveURL(/filtro=todos/)
      const item = await obterItemDeHomologacaoNoBanco(c.acme.id, c.milestone.id, c.repoUm, 2)
      await p.locator(`#item-${item!.id}`).getByRole('link', { name: /^#2 / }).click()
      await expect(p.getByRole('heading', { name: `Homologação de ${c.acme.nome}` })).toBeVisible()

      const botao = p.getByRole('button', { name: 'Solicitar correção' })
      await botao.scrollIntoViewIfNeeded()
      await expect(botao).toBeInViewport()
      await botao.click()
      await p
        .getByLabel('O que precisa ser corrigido')
        .fill('O botão Salvar não responde no Safari.')
      await p.getByRole('button', { name: 'Revisar solicitação' }).click()
      await expect(
        p.getByText(
          `Você vai solicitar correção da issue #2 (${c.repoUm}) para ${c.acme.nome}, na milestone ${c.milestone.titulo}, versão E2E qa-1.`,
        ),
      ).toBeVisible()
      await p.getByRole('button', { name: 'Confirmar solicitação de correção' }).click()
      await expect(
        p.getByRole('status').filter({ hasText: `Correção solicitada para ${c.acme.nome}.` }),
      ).toBeVisible()

      const grupo = p.locator('details[open]').filter({ hasText: 'Versão atual em QA: E2E qa-1' })
      await expect(grupo).toContainText('O botão Salvar não responde no Safari.')
      await expect(p.getByText('Entrou na fila de homologação')).toHaveCount(0)
      await verificarSemRolagem(p)
      await capturar(p, projeto, 'c4-solicitar-correcao.png')

      await p.getByRole('link', { name: 'Voltar à fila' }).first().click()
      await expect(p).toHaveURL(new RegExp(`${filaDoCliente}\\?`))
      const url = new URL(p.url())
      expect(url.searchParams.get('filtro')).toBe('todos')
      expect(url.hash).toBe(`#item-${item!.id}`)
      const linha = p.locator(`#item-${item!.id}`)
      await expect(linha).toBeInViewport()
      await expect(p.getByRole('listitem').filter({ has: linha })).toContainText(
        'Correção solicitada',
      )
      await verificarSemRolagem(p)
      await capturar(p, projeto, 'c5-retorno-fila.png')
    })

    await test.step('5. Admin vê a milestone consolidada; Beta não foi tocada', async () => {
      await page.goto(
        `/projetos/${c.projeto.id}/entregas/milestones/${c.milestone.id}?aba=homologacao`,
      )
      const porCliente = page.getByRole('list', { name: 'Homologação por cliente' })
      await expect(porCliente.getByRole('listitem').filter({ hasText: c.acme.nome })).toContainText(
        '1 correção solicitada · 1 aprovada',
      )
      await expect(porCliente.getByRole('listitem').filter({ hasText: c.beta.nome })).toContainText(
        '2 aguardando disponibilização',
      )
      await verificarSemRolagem(page)
      await capturar(page, projeto, 'c6-milestone-consolidada.png')

      expect(await obterItemDeHomologacaoNoBanco(c.beta.id, c.milestone.id, c.repoUm, 1)).toEqual(
        betaUm,
      )
      expect(await obterItemDeHomologacaoNoBanco(c.beta.id, c.milestone.id, c.repoUm, 2)).toEqual(
        betaDois,
      )
      expect(await contarSolicitacoesAbertasNoBanco(c.milestone.id)).toBe(1)
    })

    await test.step('6. Aprovador de Beta não abre a homologação de Acme', async () => {
      const p = aprovadorBeta.page
      await p.goto(filaDoCliente)
      await expect(p.getByText('Sem permissão para esta área.')).toBeVisible()
      await verificarSemRolagem(p)
      await capturar(p, projeto, 'c7-beta-sem-permissao.png')
    })
  } finally {
    await aprovador.fechar()
    await testador.fechar()
    await aprovadorBeta.fechar()
  }
})
