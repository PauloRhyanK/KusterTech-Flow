import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  criarCenarioDaVisaoGeral,
  limparCenarioDaVisaoGeral,
  type CenarioE2E,
} from './support/banco'

const GRUPOS = [
  'homologacao',
  'autorizacao-prod',
  'divergencia',
  'alerta',
  'integracao',
  'configuracao',
] as const

function obterAdmin(): { email: string; senha: string } {
  const { E2E_ADMIN_EMAIL: email, E2E_ADMIN_SENHA: senha } = process.env
  if (!email || !senha) {
    throw new Error('E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  return { email, senha }
}

async function entrarComo(page: Page, email: string, senha: string): Promise<void> {
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
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
}

// Ids dos grupos de pendências na ordem em que aparecem na página.
async function gruposNaPagina(page: Page): Promise<string[]> {
  const ids = await page
    .locator('section[id^="grupo-"]')
    .evaluateAll((secoes) => secoes.map((s) => s.id.replace('grupo-', '')))
  return ids
}

let cenario: CenarioE2E

test.beforeEach(async ({}, testInfo) => {
  const projeto = testInfo.project.name
  await limparCenarioDaVisaoGeral(projeto)
  cenario = await criarCenarioDaVisaoGeral(projeto)
})

test('admin vê os grupos na ordem #grupo-homologacao, -autorizacao-prod, -divergencia, -alerta, -integracao, -configuracao, cada um com a pendência do cenário, e nenhum data-tom="sucesso"; captura 7-visao-geral-admin.png', async ({
  page,
}, testInfo) => {
  const c = cenario
  const { email, senha } = obterAdmin()
  await entrarComo(page, email, senha)

  await expect(page.getByRole('heading', { level: 1, name: 'Visão Geral' })).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 2, name: 'Pendências' })).toBeVisible()

  const ordem = await gruposNaPagina(page)
  expect(ordem.filter((g) => (GRUPOS as readonly string[]).includes(g))).toEqual([...GRUPOS])

  const linha = (grupo: string, texto: string) =>
    page.locator(`#grupo-${grupo} li`, { hasText: texto })
  await expect(linha('homologacao', c.clienteA.nome)).toContainText('Pendente de teste')
  await expect(linha('homologacao', c.clienteB.nome)).toContainText('Aguardando reteste')
  await expect(linha('autorizacao-prod', c.versaoAlvo.rotulo)).toContainText(
    `Autorizar ${c.versaoAlvo.rotulo} em PROD`,
  )
  await expect(linha('divergencia', 'E2E v1.3.9')).toContainText('Não reconhecida')
  await expect(linha('alerta', c.alerta.titulo)).toContainText('Crítica')
  await expect(linha('integracao', c.projetoNome)).toContainText('Indisponível')
  await expect(linha('configuracao', c.projetoQNome)).toContainText('Falta:')

  await expect(page.locator('[data-tom="sucesso"]')).toHaveCount(0)
  if (testInfo.project.name === 'mobile') {
    expect(await semRolagemHorizontal(page)).toBe(true)
  }
  await capturar(page, testInfo.project.name, '7-visao-geral-admin.png')
})

test('cada pendência leva ao registro único no contexto certo e voltar mostra a Visão Geral', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const c = cenario
  const { email, senha } = obterAdmin()
  await entrarComo(page, email, senha)

  const abrir = async (grupo: string, texto: string) => {
    await page.goto('/')
    await page.locator(`#grupo-${grupo} li`, { hasText: texto }).getByRole('link').first().click()
  }
  const voltar = async () => {
    await page.goBack()
    await expect(page.getByRole('heading', { level: 1, name: 'Visão Geral' })).toBeVisible()
  }

  await test.step('homologação de A leva à issue no contexto do cliente', async () => {
    await abrir('homologacao', c.clienteA.nome)
    await expect(page).toHaveURL(
      new RegExp(
        `/clientes/${c.clienteA.id}/projetos/${c.projetoId}/entregas/issues/${c.issue1.id}`,
      ),
    )
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Item 1 de')
    await expect(page.getByRole('navigation', { name: 'Trilha de navegação' })).toContainText(
      c.clienteA.nome,
    )
    await voltar()
  })

  await test.step('autorização leva às Publicações da versão', async () => {
    await abrir('autorizacao-prod', c.versaoAlvo.rotulo)
    await expect(page).toHaveURL(
      new RegExp(`/projetos/${c.projetoId}/publicacoes\\?versao=${c.versaoAlvo.id}`),
    )
    await expect(page.getByText(c.versaoAlvo.rotulo).first()).toBeVisible()
    await voltar()
  })

  await test.step('divergência leva à âncora da divergência no projeto', async () => {
    await abrir('divergencia', 'E2E v1.3.9')
    await expect(page).toHaveURL(
      new RegExp(`/projetos/${c.projetoId}/publicacoes#divergencia-${c.divergenciaId}`),
    )
    await expect(page.locator(`#divergencia-${c.divergenciaId}`)).toBeVisible()
    await voltar()
  })

  await test.step('alerta leva ao mesmo registro da fila de Infraestrutura (Jornada D, passos 1 e 2)', async () => {
    await abrir('alerta', c.alerta.titulo)
    await expect(page).toHaveURL(new RegExp(`/infraestrutura/alertas#alerta-${c.alerta.id}`))
    const registro = page.locator(`#alerta-${c.alerta.id}`)
    await expect(registro).toBeVisible()
    await expect(registro).toContainText(c.alerta.titulo)
    await voltar()
  })

  await test.step('integração leva às Repositórios da configuração', async () => {
    await abrir('integracao', c.projetoNome)
    await expect(page).toHaveURL(new RegExp(`/projetos/${c.projetoId}/configuracao#repositorios`))
    await expect(page.locator('#repositorios')).toContainText('Indisponível')
    await voltar()
  })

  await test.step('configuração leva ao Resumo com o checklist', async () => {
    await abrir('configuracao', c.projetoQNome)
    await expect(page).toHaveURL(new RegExp(`/projetos/${c.projetoQId}$`))
    await expect(
      page
        .getByRole('list', { name: 'Configuração do projeto' })
        .getByRole('listitem')
        .filter({ hasText: 'Clientes' }),
    ).toContainText('Nenhum cliente associado')
    await voltar()
  })
})

test('/?grupo=homologacao: clicar na pendência de A e voltar mantém ?grupo=homologacao e "Mostrar menos" quando houver mais de 5', async ({
  page,
}) => {
  const c = cenario
  const { email, senha } = obterAdmin()
  await entrarComo(page, email, senha)

  await page.goto('/?grupo=homologacao')
  const grupo = page.locator('#grupo-homologacao')
  const total = Number((await grupo.locator('h3 + span').innerText()).replace(/[^0-9]/g, ''))
  await grupo.locator('li', { hasText: c.clienteA.nome }).getByRole('link').first().click()
  await expect(page).toHaveURL(new RegExp(`/clientes/${c.clienteA.id}/`))

  await page.goBack()
  await expect(page).toHaveURL(/\/\?grupo=homologacao/)
  await expect(page.getByRole('heading', { level: 1, name: 'Visão Geral' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Mostrar menos' })).toHaveCount(total > 5 ? 1 : 0)
})

test('testador do cliente A: só #grupo-homologacao com 1 linha (cliente A, "Pendente de teste"); nenhum texto do cliente B, do alerta, de "E2E v1.4.0" ou do projeto Q; nenhum h2 "Infraestrutura"; /?grupo=alerta igual; /infraestrutura/alertas mostra "Sem permissão"; captura 7-visao-geral-testador.png', async ({
  page,
}, testInfo) => {
  const c = cenario
  await entrarComo(page, c.testador.email, c.testador.senha)

  const verificar = async () => {
    await expect(page.getByRole('heading', { level: 1, name: 'Visão Geral' })).toHaveCount(1)
    expect(await gruposNaPagina(page)).toEqual(['homologacao'])
    const linhas = page.locator('#grupo-homologacao li')
    await expect(linhas).toHaveCount(1)
    await expect(linhas.first()).toContainText(c.clienteA.nome)
    await expect(linhas.first()).toContainText('Pendente de teste')
    await expect(page.getByRole('heading', { level: 2, name: 'Infraestrutura' })).toHaveCount(0)
    const corpo = page.locator('main')
    for (const proibido of [c.clienteB.nome, c.alerta.titulo, 'E2E v1.4.0', c.projetoQNome]) {
      await expect(corpo).not.toContainText(proibido)
    }
  }

  await verificar()
  if (testInfo.project.name === 'mobile') {
    expect(await semRolagemHorizontal(page)).toBe(true)
  }
  await capturar(page, testInfo.project.name, '7-visao-geral-testador.png')

  await page.goto('/?grupo=alerta')
  await verificar()

  await page.goto('/infraestrutura/alertas')
  await expect(page.getByText(/Sem permissão/)).toBeVisible()
  await expect(page.getByText(c.alerta.titulo)).toHaveCount(0)
})

test('resumos: "Saúde dos recursos" mostra "Sem dados"; desktop com Projetos e Infraestrutura lado a lado (mesmo y), mobile empilhados abaixo das pendências e scrollWidth ≤ clientWidth', async ({
  page,
}, testInfo) => {
  const { email, senha } = obterAdmin()
  await entrarComo(page, email, senha)

  await expect(page.locator('[data-sem-dados]', { hasText: 'Saúde dos recursos' })).toContainText(
    'Sem dados',
  )

  const caixa = async (nome: string) => {
    const caixa = await page
      .getByRole('heading', { level: 2, name: nome, exact: true })
      .boundingBox()
    if (!caixa) throw new Error(`Título "${nome}" sem caixa de layout.`)
    return caixa
  }
  const pendencias = await caixa('Pendências')
  const projetos = await caixa('Projetos')
  const infraestrutura = await caixa('Infraestrutura')

  if (testInfo.project.name === 'mobile') {
    expect(projetos.y).toBeGreaterThan(pendencias.y)
    expect(infraestrutura.y).toBeGreaterThan(projetos.y + 1)
    expect(Math.abs(infraestrutura.x - projetos.x)).toBeLessThanOrEqual(1)
    expect(await semRolagemHorizontal(page)).toBe(true)
  } else {
    expect(Math.abs(infraestrutura.y - projetos.y)).toBeLessThanOrEqual(1)
    expect(infraestrutura.x).toBeGreaterThan(projetos.x + 100)
  }
})
