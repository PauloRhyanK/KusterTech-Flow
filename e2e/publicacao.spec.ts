import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import {
  arquivarProjetosComRepositorioNoBanco,
  commitsDePublicacaoE2E,
  configurarPublicacaoNoBanco,
  criarFonteDePublicacaoNoBanco,
  criarProjetoNoBanco,
  limparPublicacaoNoBanco,
  nomeDeTeste,
  repositorioDeAgentesE2E,
  repositorioDePublicacaoE2E,
  repositoriosDoProjetoE2E,
  revogarFontesDaFabricaNoBanco,
  semearPedidoDePublicacaoNoBanco,
  vincularNoBanco,
} from './support/banco'
import { enviarRetratoDaFabrica, retratoDeTeste, type ConsertoDoRetrato } from './support/fabrica'
import { rodarWorkerUmaVez } from './support/worker'

// Fonte de GitHub fictícia (Task 3): desktop publica o portal, mobile o site.

function obterAdmin(): { email: string; senha: string } {
  const { E2E_ADMIN_EMAIL: email, E2E_ADMIN_SENHA: senha } = process.env
  if (!email || !senha) {
    throw new Error('E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  return { email, senha }
}

async function entrarComoAdmin(page: Page): Promise<void> {
  const { email, senha } = obterAdmin()
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

type Json = Record<string, unknown>

async function pedir(
  request: APIRequestContext,
  token: string,
  corpo: Json,
): Promise<{ status: number; json: Json }> {
  const r = await request.post('/api/publicacoes', {
    headers: { Authorization: `Bearer ${token}` },
    data: corpo,
  })
  return { status: r.status(), json: (await r.json()) as Json }
}

async function consultar(request: APIRequestContext, token: string, id: unknown): Promise<Json> {
  const r = await request.get(`/api/publicacoes/${String(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(r.status()).toBe(200)
  return (await r.json()) as Json
}

async function criarFonteDaFabrica(page: Page): Promise<string> {
  await page.goto('/configuracoes/fabrica')
  await page.getByLabel('Nome').fill(nomeDeTeste('Máquina da publicação'))
  await page.getByRole('button', { name: 'Criar token' }).click()
  await expect(page.getByText('Token criado.')).toBeVisible()
  return (await page.locator('code').first().textContent())?.trim() ?? ''
}

function linhaDoProjeto(page: Page, nome: string) {
  return page
    .getByRole('region', { name: 'Fila por projeto' })
    .getByRole('listitem')
    .filter({ hasText: nome })
}

// A hora local (São Paulo) de 2 min atrás: o lote da captura vence agora e mostra uma duração
// realista. Perto da meia-noite, '00:00'.
function horaDoLoteRecemVencida(): string {
  const hora = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(Date.now() - 2 * 60_000))
  return hora > '00:02' && hora < '23:58' ? hora : '00:00'
}

interface Cenario {
  projeto: { id: string; nome: string }
  repositorio: string
  repositorioId: string
  token: string
  c: ReturnType<typeof commitsDePublicacaoE2E>
}

async function prepararCenario(
  projectName: string,
  base: string,
  opcoes: Parameters<typeof configurarPublicacaoNoBanco>[2] = {},
): Promise<Cenario> {
  const projeto = await criarProjetoNoBanco(nomeDeTeste(base))
  const repositorio = repositorioDePublicacaoE2E(projectName)
  const { repositorioId } = await configurarPublicacaoNoBanco(projeto.id, repositorio, opcoes)
  const token = await criarFonteDePublicacaoNoBanco(nomeDeTeste('Sessão do projeto'))
  return { projeto, repositorio, repositorioId, token, c: commitsDePublicacaoE2E(projectName) }
}

// Pedido de QUEBRA → dois ciclos (disparo, acompanhamento) → falhou e o conserto abre.
async function falharEAbrirConserto(request: APIRequestContext, cen: Cenario): Promise<Json> {
  const pedido = await pedir(request, cen.token, {
    repositorio: cen.repositorio,
    commit: cen.c.QUEBRA,
    modo: 'imediato',
    descricao: 'Máscara de telefone',
  })
  expect(pedido.status).toBe(201)
  rodarWorkerUmaVez()
  rodarWorkerUmaVez()
  expect(await consultar(request, cen.token, pedido.json.id)).toMatchObject({ estado: 'falhou' })
  return pedido.json
}

test.beforeEach(async () => {
  await limparPublicacaoNoBanco()
  await arquivarProjetosComRepositorioNoBanco()
  await revogarFontesDaFabricaNoBanco()
})

test.afterAll(async () => {
  await limparPublicacaoNoBanco()
  await arquivarProjetosComRepositorioNoBanco()
  await revogarFontesDaFabricaNoBanco()
})

test('pedido aceito: POST de BASE e worker → linha do projeto com "No ar" BASE; POST de NOVO → publicado', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000)
  const cen = await prepararCenario(testInfo.project.name, 'Publicação aceita')

  const base = await pedir(request, cen.token, {
    repositorio: cen.repositorio,
    commit: cen.c.BASE,
    descricao: 'Primeira publicação',
  })
  expect(base.status).toBe(201)
  expect(base.json).toMatchObject({ estado: 'na_fila', posicao: 1 })

  rodarWorkerUmaVez()
  expect(await consultar(request, cen.token, base.json.id)).toMatchObject({
    estado: 'publicando',
    commit: cen.c.BASE,
  })
  rodarWorkerUmaVez()
  expect(await consultar(request, cen.token, base.json.id)).toMatchObject({ estado: 'publicado' })

  await entrarComoAdmin(page)
  await page.goto('/publicacao')
  await expect(page.getByRole('heading', { level: 1, name: 'Publicação' })).toBeVisible()
  await expect(linhaDoProjeto(page, cen.projeto.nome)).toContainText(cen.c.BASE.slice(0, 7))

  const novo = await pedir(request, cen.token, {
    repositorio: cen.repositorio,
    commit: cen.c.NOVO,
    descricao: 'Segunda publicação',
  })
  expect(novo.status).toBe(201)
  rodarWorkerUmaVez()
  rodarWorkerUmaVez()
  expect(await consultar(request, cen.token, novo.json.id)).toMatchObject({
    estado: 'publicado',
    commit: cen.c.NOVO,
  })

  // O mesmo commit de novo: já está no ar, dispensado sem passar pelo worker.
  const repetido = await pedir(request, cen.token, {
    repositorio: cen.repositorio,
    commit: cen.c.NOVO,
  })
  expect(repetido.status).toBe(200)
  expect(repetido.json).toMatchObject({ estado: 'dispensado', motivo: 'já está no ar' })
})

test('pedido de base antiga: POST de ANTIGO depois de NOVO → worker → pílula "Recusado: base antiga" e GET responde recusado', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000)
  const cen = await prepararCenario(testInfo.project.name, 'Publicação base antiga')

  const novo = await pedir(request, cen.token, { repositorio: cen.repositorio, commit: cen.c.NOVO })
  expect(novo.status).toBe(201)
  rodarWorkerUmaVez()
  rodarWorkerUmaVez()
  expect(await consultar(request, cen.token, novo.json.id)).toMatchObject({ estado: 'publicado' })

  // 201 é "entrou na fila": a recusa por base antiga é decidida pelo worker, no ciclo seguinte.
  const antigo = await pedir(request, cen.token, {
    repositorio: cen.repositorio,
    commit: cen.c.ANTIGO,
    descricao: 'Branch antigo',
  })
  expect(antigo.status).toBe(201)
  expect(antigo.json).toMatchObject({ estado: 'na_fila' })
  rodarWorkerUmaVez()
  expect(await consultar(request, cen.token, antigo.json.id)).toMatchObject({
    estado: 'recusado',
    motivo: 'base antiga: não contém a última publicação',
  })

  await entrarComoAdmin(page)
  await page.goto('/publicacao')
  const linha = linhaDoProjeto(page, cen.projeto.nome)
  await expect(linha.getByText('Recusado: base antiga')).toBeVisible()
  await expect(linha.getByText('Avisado')).toBeVisible()
})

test('lote noturno: config hora 00:00 e modo lote, dois pedidos → worker → uma publicação; "Último lote" lista os dois', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000)
  const cen = await prepararCenario(testInfo.project.name, 'Publicação em lote', {
    horaDoLote: '00:00',
    modoPadrao: 'LOTE',
  })

  // Sem `modo`, vale o padrão do projeto (lote).
  const primeiro = await pedir(request, cen.token, {
    repositorio: cen.repositorio,
    commit: cen.c.BASE,
    descricao: 'Trocar rótulo do botão',
  })
  const segundo = await pedir(request, cen.token, {
    repositorio: cen.repositorio,
    commit: cen.c.NOVO,
    descricao: 'Ordenar contratos',
  })
  expect([primeiro.status, segundo.status]).toEqual([201, 201])
  expect(await consultar(request, cen.token, primeiro.json.id)).toMatchObject({ modo: 'lote' })

  rodarWorkerUmaVez()
  rodarWorkerUmaVez()
  // Uma publicação só, do commit mais novo: o primeiro pedido foi atendido pelo segundo.
  expect(await consultar(request, cen.token, segundo.json.id)).toMatchObject({
    estado: 'publicado',
    atendidoPor: null,
  })
  expect(await consultar(request, cen.token, primeiro.json.id)).toMatchObject({
    estado: 'publicado',
    atendidoPor: segundo.json.id,
  })

  await entrarComoAdmin(page)
  await page.goto('/publicacao')
  const lote = page.getByRole('list', { name: 'Itens do último lote' })
  await expect(lote.getByText('Trocar rótulo do botão')).toBeVisible()
  await expect(lote.getByText('Ordenar contratos')).toBeVisible()
  await expect(lote.getByRole('listitem')).toHaveCount(2)
})

test('falha que abre conserto: POST de QUEBRA → worker → pílula "Consertando · agente trabalhando" e a resposta do retrato traz o conserto', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000)
  const cen = await prepararCenario(testInfo.project.name, 'Publicação com falha')
  await falharEAbrirConserto(request, cen)

  await entrarComoAdmin(page)
  await page.goto('/publicacao')
  const linha = linhaDoProjeto(page, cen.projeto.nome)
  await expect(linha.getByText('Consertando · agente trabalhando')).toBeVisible()

  const tokenDaFabrica = await criarFonteDaFabrica(page)
  const envio = await enviarRetratoDaFabrica(
    request,
    tokenDaFabrica,
    retratoDeTeste(nomeDeTeste('Plano da publicação')),
  )
  expect(envio.status).toBe(200)
  const consertos = (envio.json as { consertos: Json[] }).consertos
  expect(consertos).toEqual([
    expect.objectContaining({
      repositorio: cen.repositorio,
      commit: cen.c.QUEBRA,
      trechoDoLog: expect.stringContaining('Error: build falhou'),
    }),
  ])
})

test('conserto que desiste para a fila: retrato com consertos [{ estado: "desistiu" }] → faixa "… parou: o agente não conseguiu consertar" e item em "Espera você" no Início', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000)
  const cen = await prepararCenario(testInfo.project.name, 'Publicação parada')
  await falharEAbrirConserto(request, cen)

  await entrarComoAdmin(page)
  const tokenDaFabrica = await criarFonteDaFabrica(page)
  const primeiro = await enviarRetratoDaFabrica(
    request,
    tokenDaFabrica,
    retratoDeTeste(nomeDeTeste('Plano da publicação'), new Date(Date.now() - 60_000)),
  )
  const [conserto] = (primeiro.json as { consertos: { id: string }[] }).consertos
  expect(conserto).toBeDefined()

  const desistiu: ConsertoDoRetrato = {
    id: conserto!.id,
    estado: 'desistiu',
    runId: 'run_conserto_e2e',
    motivo: 'o build depende de um segredo que o agente não tem',
  }
  const envio = await enviarRetratoDaFabrica(
    request,
    tokenDaFabrica,
    retratoDeTeste(nomeDeTeste('Plano da publicação'), new Date(), [desistiu]),
  )
  expect(envio.status).toBe(200)
  expect(envio.json).toMatchObject({ resultado: 'gravado', consertos: [] })

  const aviso = `${cen.projeto.nome} parou: o agente não conseguiu consertar`
  await page.goto('/publicacao')
  await expect(page.getByRole('region', { name: 'Espera você' })).toContainText(aviso)
  const linha = linhaDoProjeto(page, cen.projeto.nome)
  await expect(linha.getByText('Parado', { exact: true })).toBeVisible()
  await expect(linha.getByRole('button', { name: 'Retomar a fila' })).toBeVisible()

  await page.goto('/')
  await expect(page.getByText(aviso)).toBeVisible()
})

test('capturas: /publicacao com a fila parada e /projetos/<p>/configuracao#publicacao salvas em e2e/capturas/<projeto>/', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000)
  const projeto = testInfo.project.name

  // Projeto Alfa: um lote publicado (último lote) e depois uma falha cujo conserto desiste.
  const alfa = await prepararCenario(projeto, 'Projeto Alfa', {
    horaDoLote: horaDoLoteRecemVencida(),
    modoPadrao: 'LOTE',
  })
  for (const [commit, descricao] of [
    [alfa.c.BASE, 'Trocar rótulo do botão'],
    [alfa.c.NOVO, 'Ordenar contratos'],
  ] as const) {
    const r = await pedir(request, alfa.token, { repositorio: alfa.repositorio, commit, descricao })
    expect(r.status).toBe(201)
  }
  rodarWorkerUmaVez()
  rodarWorkerUmaVez()
  await falharEAbrirConserto(request, alfa)

  // Os demais projetos são gravados direto no banco, sem worker: os repositórios deles não têm
  // execuções nas fixtures.
  const [, outroRepositorio] = repositoriosDoProjetoE2E(projeto)
  const beta = await criarProjetoNoBanco(nomeDeTeste('Projeto Beta'))
  const { repositorioId: betaRepo } = await configurarPublicacaoNoBanco(beta.id, outroRepositorio)
  const sha = (c: string) => c.repeat(40)
  await semearPedidoDePublicacaoNoBanco(betaRepo, {
    commit: sha('a'),
    descricao: 'Versão anterior',
    estado: 'PUBLICADO',
    minutosAtras: 180,
    duracaoMin: 6,
  })
  await semearPedidoDePublicacaoNoBanco(betaRepo, {
    commit: sha('b'),
    descricao: 'Corrige PDF cortado',
    estado: 'PUBLICANDO',
    minutosAtras: 2,
  })
  await semearPedidoDePublicacaoNoBanco(betaRepo, {
    commit: sha('c'),
    descricao: 'Exportar CSV',
    estado: 'NA_FILA',
    checks: 'SEM_CHECKS',
    minutosAtras: 1,
  })
  await semearPedidoDePublicacaoNoBanco(betaRepo, {
    commit: sha('d'),
    descricao: 'Fuso na agenda',
    estado: 'NA_FILA',
    modo: 'LOTE',
  })
  const gama = await criarProjetoNoBanco(nomeDeTeste('Projeto Gama'))
  await vincularNoBanco(gama.id, repositorioDeAgentesE2E(projeto))

  await entrarComoAdmin(page)
  await page.goto('/publicacao')
  await expect(linhaDoProjeto(page, alfa.projeto.nome)).toContainText('Consertando')
  await expect(linhaDoProjeto(page, gama.nome)).toContainText('publicação não configurada')
  await capturar(page, projeto, 'publicacao.png')

  const tokenDaFabrica = await criarFonteDaFabrica(page)
  const primeiro = await enviarRetratoDaFabrica(
    request,
    tokenDaFabrica,
    retratoDeTeste(nomeDeTeste('Plano da publicação'), new Date(Date.now() - 60_000)),
  )
  const [conserto] = (primeiro.json as { consertos: { id: string }[] }).consertos
  const envio = await enviarRetratoDaFabrica(
    request,
    tokenDaFabrica,
    retratoDeTeste(nomeDeTeste('Plano da publicação'), new Date(), [
      { id: conserto!.id, estado: 'desistiu' },
    ]),
  )
  expect(envio.status).toBe(200)

  await page.goto('/publicacao')
  await expect(page.getByRole('region', { name: 'Espera você' })).toContainText(
    `${alfa.projeto.nome} parou: o agente não conseguiu consertar`,
  )
  await capturar(page, projeto, 'publicacao-parada.png')

  await page.goto(`/projetos/${alfa.projeto.id}/configuracao#publicacao`)
  await expect(page.locator('#publicacao').getByText(alfa.repositorio)).toBeVisible()
  await page.locator('#publicacao').scrollIntoViewIfNeeded()
  await capturar(page, projeto, 'publicacao-configuracao.png')

  await page.goto('/')
  await expect(
    page.getByText(`${alfa.projeto.nome} parou: o agente não conseguiu consertar`),
  ).toBeVisible()
  await capturar(page, projeto, 'publicacao-inicio.png')
})
