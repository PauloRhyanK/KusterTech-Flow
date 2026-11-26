import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import {
  arquivarProjetosComRepositorioNoBanco,
  commitsDePublicacaoE2E,
  configurarPublicacaoNoBanco,
  criarFonteDaFabricaNoBanco,
  criarFonteDeDemandasNoBanco,
  criarFonteDePublicacaoNoBanco,
  criarProjetoNoBanco,
  gravarVersaoConferidaNoBanco,
  limparDemandasNoBanco,
  limparPublicacaoNoBanco,
  nomeDeTeste,
  repositorioDePublicacaoE2E,
  revogarFontesDaFabricaNoBanco,
} from './support/banco'
import { rodarWorkerUmaVez } from './support/worker'

// A demanda até o ar de ponta a ponta: a Fábrica simulada fala o contrato 2 pela API, os pedidos
// entram pela fila de publicação e o worker real publica e fecha as partes. Só a leitura do site
// é simulada (`gravarVersaoConferidaNoBanco`): ela exige uma URL https.

type Json = Record<string, unknown>

interface Cenario {
  repositorio: string
  /** A parte de entrada leva o nome do repositório (o contrato fixa a chave). */
  front: string
  commits: ReturnType<typeof commitsDePublicacaoE2E>
  tokenDaFabrica: string
  tokenDaSessao: string
  tokenDaFila: string
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

async function prepararCenario(projectName: string): Promise<Cenario> {
  const repositorio = repositorioDePublicacaoE2E(projectName)
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Alfa até o ar'))
  await configurarPublicacaoNoBanco(projeto.id, repositorio)
  return {
    repositorio,
    front: repositorio.split('/')[1]!,
    commits: commitsDePublicacaoE2E(projectName),
    tokenDaFabrica: await criarFonteDaFabricaNoBanco(nomeDeTeste('Fábrica até o ar')),
    tokenDaSessao: await criarFonteDeDemandasNoBanco(nomeDeTeste('Sessão até o ar')),
    tokenDaFila: await criarFonteDePublicacaoNoBanco(nomeDeTeste('Fila até o ar')),
  }
}

// Evento no contrato 2 (`X-Fabrica-Contrato: 2`), como a Fábrica nova o envia.
async function evento(
  request: APIRequestContext,
  c: Cenario,
  id: string,
  tipo: string,
  dados: Json,
): Promise<void> {
  const r = await request.post(`/api/fabrica/demandas/${id}/eventos`, {
    headers: { Authorization: `Bearer ${c.tokenDaFabrica}`, 'X-Fabrica-Contrato': '2' },
    data: { id: randomUUID(), em: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), tipo, dados },
  })
  const corpo = await r.text()
  expect(r.status(), `${tipo}: ${corpo}`).toBe(201)
}

async function consultar(request: APIRequestContext, c: Cenario, id: string): Promise<Json> {
  const r = await request.get(`/api/demandas/${id}`, {
    headers: { Authorization: `Bearer ${c.tokenDaSessao}` },
  })
  expect(r.status()).toBe(200)
  return (await r.json()) as Json
}

const triagem = {
  tipo: 'funcao_nova',
  destino: 'fila_de_agentes',
  tamanho: 'medio',
  mexeEm: '2 telas, 1 rota',
  risco: 'baixo',
  dados: 'so_leitura',
  impacto: {
    toca: ['ficha do lead'],
    podeQuebrar: [],
    autorizacao: false,
    caminhoProtegido: false,
  },
  resposta: null,
  motivo: 'Função nova sem tela.',
}

// A demanda aberta pela sessão do projeto, com as partes back e front (o front depende do back)
// planejadas pela Fábrica.
async function ateAsPartesPlanejadas(
  request: APIRequestContext,
  c: Cenario,
  titulo: string,
): Promise<string> {
  const aberta = await request.post('/api/demandas', {
    headers: { Authorization: `Bearer ${c.tokenDaSessao}` },
    data: {
      repositorio: c.repositorio,
      titulo,
      tipo: 'funcao_nova',
      nivel: 'vai_sozinho',
      temTela: false,
    },
  })
  expect(aberta.status()).toBe(201)
  const id = String(((await aberta.json()) as Json).id)
  await evento(request, c, id, 'triagem', triagem)
  await evento(request, c, id, 'plano_criado', {
    plano: '.fabrica/planos/ate-o-ar.json',
    prUrl: null,
  })
  await evento(request, c, id, 'partes_planejadas', {
    partes: [
      {
        chave: 'back',
        repositorio: c.repositorio,
        objetivo: 'rota e dados',
        ordem: 1,
        dependeDe: [],
        chegaAoAr: 'publicacao',
      },
      {
        chave: c.front,
        repositorio: c.repositorio,
        objetivo: 'tela',
        ordem: 2,
        dependeDe: ['back'],
        chegaAoAr: 'publicacao',
      },
    ],
  })
  for (const parte of ['back', c.front]) {
    await evento(request, c, id, 'parte_planejada', {
      parte,
      plano: `.fabrica/planos/${parte}-ate-o-ar.json`,
      prUrl: null,
    })
  }
  return id
}

async function parteFeita(
  request: APIRequestContext,
  c: Cenario,
  id: string,
  parte: string,
  commit: string,
  numero: number,
): Promise<void> {
  await evento(request, c, id, 'parte_feita', {
    parte,
    prs: [
      {
        url: `https://github.com/${c.repositorio}/pull/${numero}`,
        numero,
        mergeCommit: commit.padEnd(40, '0').slice(0, 40),
      },
    ],
    commit,
    pendencias: [],
  })
}

// O pedido de publicação da parte, como a Fábrica o faz ao terminá-la.
async function pedirPublicacao(
  request: APIRequestContext,
  c: Cenario,
  id: string,
  parte: string,
  commit: string,
): Promise<{ status: number; json: Json }> {
  const r = await request.post('/api/publicacoes', {
    headers: { Authorization: `Bearer ${c.tokenDaFila}` },
    data: { repositorio: c.repositorio, commit, modo: 'imediato', demanda: id, parte },
  })
  return { status: r.status(), json: (await r.json()) as Json }
}

// Disparo e acompanhamento: dois ciclos publicam um pedido.
function publicar(): void {
  rodarWorkerUmaVez()
  rodarWorkerUmaVez()
}

async function encerrarAteEntregue(
  request: APIRequestContext,
  c: Cenario,
  id: string,
): Promise<void> {
  await evento(request, c, id, 'etapa_concluida', { marco: 'desenvolvida' })
  await evento(request, c, id, 'etapa_concluida', { marco: 'entregue' })
}

let c: Cenario

test.beforeEach(async ({}, testInfo) => {
  await limparDemandasNoBanco()
  await limparPublicacaoNoBanco()
  await arquivarProjetosComRepositorioNoBanco()
  await revogarFontesDaFabricaNoBanco()
  c = await prepararCenario(testInfo.project.name)
})

test.afterAll(async () => {
  await limparDemandasNoBanco()
  await limparPublicacaoNoBanco()
  await arquivarProjetosComRepositorioNoBanco()
  await revogarFontesDaFabricaNoBanco()
})

test('contrato 2: a conferência fecha as partes uma a uma e a demanda só aparece em "No ar" quando todas chegam', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000)
  const titulo = 'Aba de IA na ficha do lead'
  const id = await ateAsPartesPlanejadas(request, c, titulo)
  const grupo = (nome: string) =>
    page.getByRole('region', { name: nome, exact: true }).getByRole('link', {
      name: new RegExp(titulo),
    })

  // Back: feita → pedido → publicado → o site mostra BASE: só o back chega ao ar.
  await parteFeita(request, c, id, 'back', c.commits.BASE, 11)
  expect((await pedirPublicacao(request, c, id, 'back', c.commits.BASE)).status).toBe(201)
  publicar()
  await gravarVersaoConferidaNoBanco(c.repositorio, c.commits.BASE)
  rodarWorkerUmaVez()

  await parteFeita(request, c, id, c.front, c.commits.NOVO, 12)
  await evento(request, c, id, 'etapa_concluida', { marco: 'desenvolvida' })
  await entrar(page)
  await page.goto(`/demandas/${id}`)
  // A ordem registrada (o Flow a mostra; quem publica nessa ordem é a Fábrica).
  await expect(page.getByText(`Ordem de publicação: back antes do ${c.front}`)).toBeVisible()
  await expect(page.getByText(`No ar · ${c.commits.BASE.slice(0, 7)}`).first()).toBeVisible()
  await page.goto('/demandas')
  await expect(grupo('No ar')).toHaveCount(0)
  await expect(grupo('A caminho')).toHaveCount(1)
  expect((await consultar(request, c, id)).encerrada).toBeNull()

  // Front: pedido → publicado → o site mostra NOVO: a demanda fecha.
  expect((await pedirPublicacao(request, c, id, c.front, c.commits.NOVO)).status).toBe(201)
  publicar()
  await evento(request, c, id, 'etapa_concluida', { marco: 'entregue' })
  expect(await consultar(request, c, id)).toMatchObject({ etapa: { chave: 'no_ar' } })
  await gravarVersaoConferidaNoBanco(c.repositorio, c.commits.NOVO)
  rodarWorkerUmaVez()
  await expect.poll(async () => (await consultar(request, c, id)).encerrada).toBe('no_ar')

  await page.goto('/demandas')
  const linha = grupo('No ar')
  await expect(linha).toBeVisible()
  await expect(linha.getByText(`No ar · ${c.commits.NOVO.slice(0, 7)}`)).toBeVisible()
  await expect(grupo('Não chegou ao ar')).toHaveCount(0)

  await page.goto(`/demandas/${id}`)
  await expect(page.getByRole('region', { name: /^Falta:/ })).toHaveCount(0)
  const cartoes = page.getByRole('article')
  await expect(cartoes.getByRole('heading')).toHaveText([
    '1 · Back',
    `2 · ${c.front[0]!.toUpperCase()}${c.front.slice(1)}`,
  ])
})

test('front dispensado por já estar no ar, sem conferência → "Não chegou ao ar" com "Publicação dispensada"', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000)
  const titulo = 'Filtro por etapa no funil'
  const id = await ateAsPartesPlanejadas(request, c, titulo)

  // Back publicado e conferido: fecha no ar.
  await parteFeita(request, c, id, 'back', c.commits.BASE, 21)
  expect((await pedirPublicacao(request, c, id, 'back', c.commits.BASE)).status).toBe(201)
  publicar()
  await gravarVersaoConferidaNoBanco(c.repositorio, c.commits.BASE)
  rodarWorkerUmaVez()

  // Front pede o mesmo commit, que já foi publicado: a fila o dispensa e, sem site conferido
  // para esse pedido, a parte não chega ao ar.
  await parteFeita(request, c, id, c.front, c.commits.BASE, 22)
  const dispensado = await pedirPublicacao(request, c, id, c.front, c.commits.BASE)
  expect(dispensado.status).toBe(200)
  expect(dispensado.json).toMatchObject({ estado: 'dispensado' })
  await encerrarAteEntregue(request, c, id)

  await entrar(page)
  await page.goto('/demandas')
  const linha = page
    .getByRole('region', { name: 'Não chegou ao ar' })
    .getByRole('link', { name: new RegExp(titulo) })
  await expect(linha).toBeVisible()
  await expect(linha.getByText(`${c.front} · dispensada`)).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'No ar', exact: true })
      .getByRole('link', { name: new RegExp(titulo) }),
  ).toHaveCount(0)

  await page.goto(`/demandas/${id}`)
  await expect(page.getByText('Publicação dispensada').first()).toBeVisible()
})
