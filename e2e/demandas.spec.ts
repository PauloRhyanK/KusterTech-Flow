import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import {
  criarFonteDaFabricaNoBanco,
  criarFonteDeDemandasNoBanco,
  criarProjetoNoBanco,
  exibirProjetoComoNoBanco,
  limparDemandasNoBanco,
  nomeDeTeste,
  publicadaSemConferirNoBanco,
  revogarFontesDaFabricaNoBanco,
  vincularNoBanco,
} from './support/banco'
import { arquivoDaFabrica, eventoDaFabrica } from './support/fabrica'

// Uma demanda com tela do começo ao fim, com a Fábrica simulada pela API (spec §10).

const PASTA_DAS_CAPTURAS = 'docs/superpowers/specs/desenhos/2026-11-19-demandas/capturas'
const DESENHO = readFileSync('e2e/fixtures/desenho-exemplo.html')
const REPO_ALFA = 'kustertech-exemplo/portal'
const REPO_BETA = 'kustertech-exemplo/api'
const TITULO = 'Tela de funil de vendas'

type Json = Record<string, unknown>

interface Cenario {
  alfaId: string
  tokenDaFabrica: string
  tokenDaSessao: string
}

function obterAdmin(): { email: string; senha: string } {
  const { E2E_ADMIN_EMAIL: email, E2E_ADMIN_SENHA: senha } = process.env
  if (!email || !senha) {
    throw new Error('Credenciais do administrador de E2E não configuradas pelo setup.')
  }
  return { email, senha }
}

async function entrar(page: Page): Promise<void> {
  const { email, senha } = obterAdmin()
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function capturar(page: Page, projeto: string, nome: string): Promise<void> {
  const caminho = join(PASTA_DAS_CAPTURAS, projeto, `${nome}.png`)
  mkdirSync(dirname(caminho), { recursive: true })
  await page.screenshot({ path: caminho, fullPage: true })
}

// Projeto Alfa (portal) e Projeto Beta (api), uma fonte da Fábrica e uma fonte de demandas.
async function prepararCenario(): Promise<Cenario> {
  const alfa = await criarProjetoNoBanco(nomeDeTeste('Projeto Alfa'))
  const beta = await criarProjetoNoBanco(nomeDeTeste('Projeto Beta'))
  await vincularNoBanco(alfa.id, REPO_ALFA)
  await vincularNoBanco(beta.id, REPO_BETA)
  await exibirProjetoComoNoBanco(alfa.id, 'Projeto Alfa')
  await exibirProjetoComoNoBanco(beta.id, 'Projeto Beta')
  return {
    alfaId: alfa.id,
    tokenDaFabrica: await criarFonteDaFabricaNoBanco(nomeDeTeste('Fábrica das demandas')),
    tokenDaSessao: await criarFonteDeDemandasNoBanco(nomeDeTeste('Sessão do projeto')),
  }
}

async function abrirPelaSessao(
  request: APIRequestContext,
  c: Cenario,
  corpo: Json,
): Promise<{ status: number; json: Json }> {
  const r = await request.post('/api/demandas', {
    headers: { Authorization: `Bearer ${c.tokenDaSessao}` },
    data: corpo,
  })
  return { status: r.status(), json: (await r.json()) as Json }
}

async function consultarPelaSessao(
  request: APIRequestContext,
  c: Cenario,
  id: string,
): Promise<Json> {
  const r = await request.get(`/api/demandas/${id}`, {
    headers: { Authorization: `Bearer ${c.tokenDaSessao}` },
  })
  expect(r.status()).toBe(200)
  return (await r.json()) as Json
}

async function buscarPelaFabrica(request: APIRequestContext, c: Cenario): Promise<Json[]> {
  const r = await request.get('/api/fabrica/demandas?desde=0', {
    headers: { Authorization: `Bearer ${c.tokenDaFabrica}` },
  })
  expect(r.status()).toBe(200)
  return ((await r.json()) as { demandas: Json[] }).demandas
}

async function evento(
  request: APIRequestContext,
  c: Cenario,
  id: string,
  tipo: string,
  dados: Json,
): Promise<void> {
  const r = await eventoDaFabrica(request, c.tokenDaFabrica, id, tipo, dados)
  expect(r, `${tipo}: ${JSON.stringify(r.json)}`).toMatchObject({ status: 201 })
}

function triagem(destino: string, extra: Json = {}): Json {
  return {
    tipo: 'funcao_nova',
    destino,
    tamanho: 'medio',
    mexeEm: '2 telas, 1 rota',
    risco: 'baixo',
    dados: 'so_leitura',
    impacto: {
      toca: ['tela de vendas'],
      podeQuebrar: ['relatório de vendas'],
      autorizacao: false,
      caminhoProtegido: false,
    },
    resposta: null,
    motivo: 'Função nova com tela, sem pressa.',
    ...extra,
  }
}

async function enviarDesenho(request: APIRequestContext, c: Cenario, id: string): Promise<void> {
  const arquivo = await arquivoDaFabrica(
    request,
    c.tokenDaFabrica,
    id,
    { tipo: 'desenho', nome: 'funil-de-vendas.html' },
    DESENHO,
    'text/html',
  )
  expect(arquivo.status).toBe(201)
  await evento(request, c, id, 'desenho_pronto', { arquivoId: arquivo.id })
}

// A demanda principal aberta pela sessão do projeto, até esperar a aprovação do desenho.
async function ateEsperarODesenho(request: APIRequestContext, c: Cenario): Promise<string> {
  const aberta = await abrirPelaSessao(request, c, {
    repositorio: REPO_ALFA,
    titulo: TITULO,
    tipo: 'funcao_nova',
    nivel: 'aprovar_desenho',
    temTela: true,
  })
  expect(aberta.status).toBe(201)
  const id = String(aberta.json.id)
  await evento(request, c, id, 'triagem', triagem('fila_de_agentes'))
  await evento(request, c, id, 'plano_criado', {
    plano: '.fabrica/planos/funil-de-vendas.json',
    prUrl: null,
  })
  await enviarDesenho(request, c, id)
  return id
}

async function aprovarPelaTela(page: Page, id: string): Promise<void> {
  await page.goto(`/demandas/${id}`)
  const faixa = page.getByRole('region', { name: 'Espera você' })
  await faixa.getByRole('button', { name: 'Aprovar' }).click()
  await expect(page.getByRole('region', { name: 'Espera você' })).toHaveCount(0)
}

// As outras demandas do desenho 1: uma esperando você, uma travada, uma em andamento, uma na fila
// e uma orientada hoje.
async function semearAsOutras(request: APIRequestContext, c: Cenario): Promise<void> {
  const abrir = async (corpo: Json) => {
    const r = await abrirPelaSessao(request, c, corpo)
    expect(r.status).toBe(201)
    return String(r.json.id)
  }
  const painel = await abrir({
    repositorio: REPO_BETA,
    titulo: 'Painel com metas por equipe',
    tipo: 'ideia',
    nivel: 'planejar_comigo',
    temTela: true,
  })
  await evento(request, c, painel, 'triagem', triagem('fila_de_agentes', { tipo: 'ideia' }))

  const exportacao = await abrir({
    repositorio: REPO_BETA,
    titulo: 'Exportação trava com 5 mil linhas',
    tipo: 'defeito',
    nivel: 'vai_sozinho',
    temTela: false,
  })
  await evento(request, c, exportacao, 'triagem', triagem('urgente', { tipo: 'defeito' }))
  await evento(request, c, exportacao, 'plano_criado', {
    plano: '.fabrica/planos/exportacao-grande.json',
    prUrl: null,
  })
  await evento(request, c, exportacao, 'travada', {
    motivo: 'Travada no desenvolvimento',
    url: null,
  })

  const leads = await abrir({
    repositorio: REPO_ALFA,
    titulo: 'Importação de leads por planilha',
    tipo: 'funcao_nova',
    nivel: 'vai_sozinho',
    temTela: false,
  })
  await evento(request, c, leads, 'triagem', triagem('lote_da_noite'))
  await evento(request, c, leads, 'plano_criado', {
    plano: '.fabrica/planos/importacao-de-leads.json',
    prUrl: null,
  })

  // Repetir com a mesma chave (timeout da sessão) devolve a mesma demanda, nunca duas.
  const contatos = {
    repositorio: REPO_ALFA,
    titulo: 'Exportar contatos em CSV',
    tipo: 'ajuste',
    temTela: false,
    chave: randomUUID(),
  }
  const primeira = await abrirPelaSessao(request, c, contatos)
  const repetida = await abrirPelaSessao(request, c, contatos)
  expect(primeira.status).toBe(201)
  expect(repetida.status).toBe(200)
  expect(repetida.json.id).toBe(primeira.json.id)

  const duvida = await abrir({
    repositorio: REPO_ALFA,
    titulo: 'Onde troco o logo do relatório',
    temTela: false,
  })
  await evento(
    request,
    c,
    duvida,
    'triagem',
    triagem('orientada', {
      tipo: 'ajuste',
      resposta: 'Em Configurações, na seção Relatórios, envie o novo logo.',
    }),
  )
}

async function capturasDoDesenho(browser: Browser): Promise<{ desktop: Buffer; celular: Buffer }> {
  const tirar = async (width: number, height: number) => {
    const contexto = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width, height },
    })
    const pagina = await contexto.newPage()
    await pagina.setContent(DESENHO.toString('utf8'))
    const png = await pagina.screenshot()
    await contexto.close()
    return png
  }
  return { desktop: await tirar(1280, 800), celular: await tirar(390, 844) }
}

let c: Cenario

test.beforeEach(async () => {
  await limparDemandasNoBanco()
  await revogarFontesDaFabricaNoBanco()
  c = await prepararCenario()
})

test.afterAll(async () => {
  // Nada fica esperando no Início das specs seguintes.
  await limparDemandasNoBanco()
})

test('nova demanda pela tela → aparece em "A caminho" com "Triagem"; captura nova e lista', async ({
  page,
  request,
}, testInfo) => {
  await entrar(page)
  await buscarPelaFabrica(request, c)

  await page.goto('/demandas')
  await page.getByRole('link', { name: 'Nova demanda' }).click()
  await expect(page).toHaveURL(/\/demandas\/nova$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Nova demanda' })).toBeVisible()
  // Projeto com um repositório só: o campo "Repositório" não aparece.
  await page.getByLabel('Projeto').selectOption({ label: 'Projeto Alfa' })
  await expect(page.getByLabel('Repositório')).toHaveCount(0)
  await capturar(page, testInfo.project.name, 'nova')

  await page.getByLabel('O que você quer').fill('Exportar contatos em CSV')
  await page.getByLabel('Detalhes (opcional)').fill('Um botão na lista de contatos.')
  await page.getByText('Vai sozinho', { exact: true }).click()
  await page.getByText('Não', { exact: true }).click()
  await page.getByRole('button', { name: 'Criar demanda' }).click()
  await expect(page).toHaveURL(/\/demandas\/[0-9a-f-]{36}$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Exportar contatos em CSV' }),
  ).toBeVisible()

  await page.goto('/demandas')
  const aCaminho = page.getByRole('region', { name: 'A caminho' })
  const linha = aCaminho.getByRole('link').filter({ hasText: 'Exportar contatos em CSV' })
  await expect(linha).toBeVisible()
  await expect(linha.getByText('Triagem', { exact: true })).toBeVisible()
  await expect(linha.getByText('Projeto Alfa')).toBeVisible()
  // A parte de entrada, criada com a demanda, e o trilho de quatro pontos na triagem.
  await expect(linha.getByRole('list', { name: 'Partes' })).toContainText('portal · planejando')
  await expect(linha.getByRole('img', { name: /^Até o ar: pedida em andamento/ })).toBeVisible()
})

test('Fábrica simulada: GET traz a demanda; triagem, plano_criado, arquivo desenho-exemplo.html e desenho_pronto → "Espera você" com "Aprovar desenho"', async ({
  page,
  request,
}, testInfo) => {
  const aberta = await abrirPelaSessao(request, c, {
    repositorio: REPO_ALFA,
    titulo: TITULO,
    tipo: 'funcao_nova',
    nivel: 'aprovar_desenho',
    temTela: true,
  })
  expect(aberta.status).toBe(201)
  const id = String(aberta.json.id)

  const buscadas = await buscarPelaFabrica(request, c)
  expect(buscadas.find((d) => d.id === id)).toMatchObject({
    titulo: TITULO,
    repositorio: REPO_ALFA,
    nivel: 'aprovar_desenho',
    temTela: true,
    origem: 'sessao',
    etapaAtual: { chave: 'recebida', marco: 'recebida' },
  })

  await evento(request, c, id, 'triagem', triagem('fila_de_agentes'))
  await evento(request, c, id, 'plano_criado', {
    plano: '.fabrica/planos/funil-de-vendas.json',
    prUrl: null,
  })
  await enviarDesenho(request, c, id)

  expect(await consultarPelaSessao(request, c, id)).toMatchObject({
    etapa: { chave: 'desenho', nome: 'Desenho aprovado' },
    destino: 'fila_de_agentes',
    espera: { tipo: 'aprovar_desenho' },
    desenho: { versao: 1, aprovada: false, url: `/demandas/${id}/desenho` },
  })

  await semearAsOutras(request, c)
  await entrar(page)
  await page.goto('/demandas')
  const espera = page.getByRole('region', { name: 'Espera você' })
  const linha = espera.getByRole('link').filter({ hasText: TITULO })
  await expect(linha.getByText('Aprovar desenho', { exact: true })).toBeVisible()
  for (const grupo of ['Espera você', 'A caminho']) {
    await expect(page.getByRole('heading', { level: 2, name: grupo, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('region', { name: 'Espera você' }).getByRole('link')).toHaveCount(3)
  const numeros = page.getByRole('region', { name: 'Demandas até o ar' })
  await expect(numeros.getByRole('link', { name: /Espera você/ })).toContainText(/^3/)
  const aCaminho = page.getByRole('region', { name: 'A caminho' })
  await expect(aCaminho.getByText('Desenvolvendo').first()).toBeVisible()
  await expect(aCaminho.getByText('Triagem').first()).toBeVisible()
  // As orientadas não ficam na lista: um link discreto leva ao filtro delas.
  await expect(page.getByRole('heading', { level: 2, name: 'Orientadas hoje' })).toHaveCount(0)
  await capturar(page, testInfo.project.name, 'lista')

  await page.getByRole('link', { name: /orientadas? hoje/ }).click()
  await expect(page).toHaveURL(/\/demandas\?destino=orientada$/)
  await expect(
    page
      .getByRole('region', { name: 'Orientadas hoje' })
      .getByText('Onde troco o logo do relatório'),
  ).toBeVisible()
  await capturar(page, testInfo.project.name, 'lista-orientadas')
})

test('página da demanda: quadros de impacto, desenho no iframe sem o script ter rodado (o título interno não mudou), "Pedir ajuste" com texto → GET traz ajuste_pedido; versão 2 → "Aprovar"; captura aprovar-desenho', async ({
  page,
  request,
}, testInfo) => {
  const id = await ateEsperarODesenho(request, c)
  await entrar(page)
  await page.goto(`/demandas/${id}`)

  await expect(page.getByRole('heading', { level: 1, name: TITULO })).toBeVisible()
  for (const [rotulo, valor] of [
    ['Tamanho', 'Médio'],
    ['Mexe em', '2 telas, 1 rota'],
    ['Risco', 'Baixo'],
    ['Dados', 'Só leitura'],
  ] as const) {
    await expect(page.getByText(rotulo, { exact: true })).toBeVisible()
    await expect(page.getByText(valor, { exact: true })).toBeVisible()
  }

  const iframe = page.locator('iframe[title="Desenho · funil-de-vendas.html"]')
  await expect(iframe).toHaveAttribute('sandbox', '')
  const quadro = page.frameLocator('iframe[title="Desenho · funil-de-vendas.html"]')
  await expect(quadro.getByRole('heading', { name: 'Funil de vendas' })).toBeVisible()
  await expect(quadro.getByText('O script rodou')).toHaveCount(0)
  const frame = page.frames().find((f) => f.url().includes('/arquivos/'))
  expect(await frame?.title()).toBe('Desenho de exemplo')

  const faixa = page.getByRole('region', { name: 'Espera você' })
  await expect(faixa.getByText('O desenho está pronto para você aprovar')).toBeVisible()
  await faixa.getByRole('button', { name: 'Pedir ajuste' }).click()
  await faixa.getByLabel('O que ajustar').fill('menos texto no topo')
  await faixa.getByRole('button', { name: 'Enviar ajuste' }).click()
  await expect(page.getByRole('region', { name: 'Espera você' })).toHaveCount(0)

  const buscada = (await buscarPelaFabrica(request, c)).find((d) => d.id === id)
  expect(buscada?.ajustes).toEqual([
    expect.objectContaining({ versao: 1, texto: 'menos texto no topo' }),
  ])
  expect(buscada?.eventos).toEqual(
    expect.arrayContaining([expect.objectContaining({ tipo: 'ajuste_pedido' })]),
  )

  await enviarDesenho(request, c, id)
  await page.reload()
  const nova = page.getByRole('region', { name: 'Espera você' })
  await expect(nova.getByText(/versão 2 · ajuste pedido .*: "menos texto no topo"/)).toBeVisible()
  await expect(nova.getByRole('button', { name: 'Aprovar' })).toBeVisible()
  await capturar(page, testInfo.project.name, 'aprovar-desenho')

  await nova.getByRole('button', { name: 'Aprovar' }).click()
  await expect(page.getByRole('region', { name: 'Espera você' })).toHaveCount(0)
  expect(await consultarPelaSessao(request, c, id)).toMatchObject({
    etapa: { chave: 'desenvolvida' },
    espera: null,
    desenho: { versao: 2, aprovada: true },
  })
})

test('tela cheia: /demandas/<id>/desenho mostra o desenho e "← Voltar à demanda"', async ({
  page,
  request,
}) => {
  const id = await ateEsperarODesenho(request, c)
  await entrar(page)
  await page.goto(`/demandas/${id}`)
  await page.getByRole('link', { name: /Abrir em tela cheia/ }).click()
  await expect(page).toHaveURL(new RegExp(`/demandas/${id}/desenho$`))

  const quadro = page.frameLocator('iframe[title="Desenho · funil-de-vendas.html"]')
  await expect(quadro.getByRole('heading', { name: 'Funil de vendas' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Aprovar' })).toBeVisible()
  await page.getByRole('link', { name: /Voltar à demanda/ }).click()
  await expect(page).toHaveURL(new RegExp(`/demandas/${id}$`))
})

test('Fábrica simulada: etapa_concluida desenvolvida, duas capturas (desktop e celular), teste passou, entregue → espera o no ar; publicada sem conferir → "Conferi no ar" fecha com "✓ No ar", desenho aprovado e capturas lado a lado; captura entregue', async ({
  page,
  request,
  browser,
}, testInfo) => {
  const id = await ateEsperarODesenho(request, c)
  await entrar(page)
  await aprovarPelaTela(page, id)

  await evento(request, c, id, 'etapa_concluida', { marco: 'desenvolvida' })
  const png = await capturasDoDesenho(browser)
  const desktop = await arquivoDaFabrica(
    request,
    c.tokenDaFabrica,
    id,
    { tipo: 'captura', nome: 'desktop.png', tela: 'desktop' },
    png.desktop,
    'image/png',
  )
  const celular = await arquivoDaFabrica(
    request,
    c.tokenDaFabrica,
    id,
    { tipo: 'captura', nome: 'celular.png', tela: 'celular' },
    png.celular,
    'image/png',
  )
  expect([desktop.status, celular.status]).toEqual([201, 201])
  await evento(request, c, id, 'teste', {
    resultado: 'passou',
    resumo: 'Fluxo do funil percorrido no desktop e no celular.',
    capturas: [desktop.id, celular.id],
  })
  await evento(request, c, id, 'entregue', {
    prs: ['https://github.com/kustertech-exemplo/portal/pull/318'],
  })

  // "Entregue" não encerra mais: a demanda espera a parte chegar ao ar (etapa "No ar").
  expect(await consultarPelaSessao(request, c, id)).toMatchObject({
    etapa: { chave: 'no_ar' },
    encerrada: null,
    espera: null,
  })

  // O portal não tem `urlDaVersao`: a publicação termina sem conferir o site e o Paulo confere.
  const commit = '5e1f0c2a9b8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f'
  await publicadaSemConferirNoBanco(id, commit)
  await page.goto(`/demandas/${id}`)
  await expect(
    page.getByRole('list', { name: 'Até o ar' }).getByRole('listitem').last(),
  ).toHaveAttribute('aria-current', 'step')
  const falta = page.getByRole('region', { name: /^Falta: a parte do portal/ })
  await expect(falta).toContainText('Publicada sem conferir o site.')
  await falta.getByRole('button', { name: 'Conferi no ar' }).click()
  await expect.poll(async () => (await consultarPelaSessao(request, c, id)).encerrada).toBe('no_ar')

  await page.reload()
  await expect(page.getByText(`✓ No ar · ${commit.slice(0, 7)}`)).toBeVisible()
  await expect(page.getByRole('region', { name: /^Falta:/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Desenho aprovado' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Entregue · desktop e celular' })).toBeVisible()
  await expect(page.locator('iframe[title="Desenho · funil-de-vendas.html"]')).toBeVisible()
  await expect(page.getByAltText('Captura no desktop')).toBeVisible()
  await expect(page.getByAltText('Captura no celular')).toBeVisible()
  await capturar(page, testInfo.project.name, 'entregue')
})

// Com o Decidir ativo, o desenho a aprovar entra na pilha: o Início conta o item no resumo do
// Decidir (sem a linha própria) e a conta cai depois de aprovar.
async function itensNoDecidir(page: Page): Promise<number> {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible()
  await expect(page.getByText(`Aprovar o desenho de ${TITULO}`)).toHaveCount(0)
  const resumo = page.getByText(/^\d+ (itens esperam|item espera) sua resposta$/)
  if ((await resumo.count()) === 0) return 0
  return Number((await resumo.textContent())!.split(' ')[0])
}

test('Início conta o desenho a aprovar no resumo do Decidir e a conta cai depois de aprovar', async ({
  page,
  request,
}) => {
  const id = await ateEsperarODesenho(request, c)
  await buscarPelaFabrica(request, c)
  await entrar(page)
  const antes = await itensNoDecidir(page)
  expect(antes).toBeGreaterThan(0)

  await aprovarPelaTela(page, id)
  expect(await itensNoDecidir(page)).toBe(antes - 1)
})

test('configuração do projeto: seção Demandas com o modelo de etapas e o nível padrão; captura configuracao', async ({
  page,
}, testInfo) => {
  await entrar(page)
  await page.goto(`/projetos/${c.alfaId}/configuracao`)
  await expect(page.getByRole('heading', { level: 2, name: 'Demandas' })).toBeVisible()
  await expect(page.getByLabel('Modelo de etapas')).toBeVisible()
  await expect(
    page.getByText('Recebida › Planejada › Desenho › Desenvolvida › Testada › Entregue'),
  ).toBeVisible()
  await expect(page.getByLabel('Nível padrão das demandas')).toHaveValue('aprovar_desenho')
  await capturar(page, testInfo.project.name, 'configuracao')
})
