import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import {
  criarDemandaEsperandoNoBanco,
  criarFonteDaFabricaNoBanco,
  criarProjetoNoBanco,
  esperaDaDemandaNoBanco,
  exibirProjetoComoNoBanco,
  limparConversasNoBanco,
  limparDemandasNoBanco,
  nomeDeTeste,
  revogarFontesDaFabricaNoBanco,
  vincularNoBanco,
  type TriagemDeTeste,
} from './support/banco'
import {
  buscarConversas,
  enviarRetratoDaFabrica,
  responderConversa,
  retratoComDecisoes,
} from './support/fabrica'

// O Decidir de ponta a ponta, com o atendente da Fábrica simulado pela API (Task 12).

const PASTA_DAS_CAPTURAS = 'docs/superpowers/specs/desenhos/2026-11-21-decidir/capturas'
const REPO = 'kustertech-exemplo/portal'
const ISSUE_41 = 'https://github.com/kustertech-exemplo/portal/issues/41'
const PASTA_DA_LEITURA = 'docs/homologacao/2026-11-26-decidir-leitura'
const PERGUNTA_43 = {
  titulo: '[fábrica] pergunta: Em que ordem a ficha do lead mostra os campos extras do formulário?',
  url: 'https://github.com/kustertech-exemplo/portal/issues/43',
}
const FIM_DE_FASE = { titulo: '[fábrica] orquestrador: aprovar fase', url: ISSUE_41 }
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const LEMBRETE = {
  titulo: 'Lembrete de parcela por WhatsApp',
  descricao: 'O cliente quer ser avisado três dias antes de vencer a parcela, pelo WhatsApp.',
  triagem: {
    tipo: 'ideia',
    tamanho: 'medio',
    mexeEm: 'cobrança e conector',
    motivo:
      'A Ana pediu que o sistema avise o cliente três dias antes de vencer a parcela, pelo WhatsApp dele. O conector já envia mensagens; falta o agendamento e um modelo de texto.',
  },
} as const satisfies { titulo: string; descricao: string; triagem: TriagemDeTeste }

const PDF = {
  titulo: 'PDF sai cortado',
  descricao: 'O relatório mensal em PDF corta a última coluna.',
  triagem: {
    tipo: 'defeito',
    tamanho: 'pequeno',
    mexeEm: 'relatório mensal',
    motivo: 'O PDF do relatório mensal corta a última coluna da tabela.',
  },
} as const satisfies { titulo: string; descricao: string; triagem: TriagemDeTeste }

const CONTATO = {
  titulo: 'Trocar "Lead" por "Contato"',
  descricao: 'Nas telas de vendas, a palavra "Lead" confunde os vendedores.',
  triagem: {
    tipo: 'ajuste',
    tamanho: 'pequeno',
    mexeEm: 'textos de vendas',
    motivo: 'Troca de texto em quatro telas de vendas, sem mudar dados.',
  },
} as const satisfies { titulo: string; descricao: string; triagem: TriagemDeTeste }

interface Cenario {
  alfaId: string
  token: string
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

async function capturar(
  page: Page,
  projeto: string,
  nome: string,
  pasta: string = PASTA_DAS_CAPTURAS,
): Promise<void> {
  const caminho = join(pasta, projeto, `${nome}.png`)
  mkdirSync(dirname(caminho), { recursive: true })
  await page.screenshot({ path: caminho, fullPage: true })
}

// O celular nunca rola na horizontal.
async function semRolagemHorizontal(page: Page): Promise<void> {
  const larguras = await page.evaluate(() => ({
    conteudo: document.documentElement.scrollWidth,
    tela: window.innerWidth,
  }))
  expect(larguras.conteudo).toBeLessThanOrEqual(larguras.tela)
}

// Projeto Alfa com o portal e uma fonte da Fábrica nova (as anteriores revogadas).
async function prepararCenario(): Promise<Cenario> {
  await revogarFontesDaFabricaNoBanco()
  const alfa = await criarProjetoNoBanco(nomeDeTeste('Projeto Alfa'))
  await vincularNoBanco(alfa.id, REPO)
  await exibirProjetoComoNoBanco(alfa.id, 'Projeto Alfa')
  return { alfaId: alfa.id, token: await criarFonteDaFabricaNoBanco(nomeDeTeste('Atendente')) }
}

async function demanda(
  c: Cenario,
  d: { titulo: string; descricao: string; triagem: TriagemDeTeste },
): Promise<string> {
  const { id } = await criarDemandaEsperandoNoBanco(c.alfaId, REPO, {
    titulo: d.titulo,
    descricao: d.descricao,
    espera: 'decidir_destino',
    triagem: d.triagem,
  })
  return id
}

async function retratoComFimDeFase(request: APIRequestContext, c: Cenario): Promise<void> {
  const r = await enviarRetratoDaFabrica(
    request,
    c.token,
    retratoComDecisoes('cadastro', [FIM_DE_FASE]),
  )
  expect(r, JSON.stringify(r.json)).toMatchObject({ status: 200 })
}

// A conversa do item com esse título na busca do atendente.
async function conversaNaBusca(
  request: APIRequestContext,
  c: Cenario,
  titulo: string,
): Promise<Record<string, unknown> & { id: string; responderA: string }> {
  const busca = await buscarConversas(request, c.token)
  expect(busca.status).toBe(200)
  const conversa = busca.json.conversas.find(
    (x) => (x.item as { titulo: string }).titulo === titulo,
  )
  expect(conversa, JSON.stringify(busca.json)).toBeTruthy()
  return conversa as Record<string, unknown> & { id: string; responderA: string }
}

const tituloDoItem = (page: Page) => page.getByRole('heading', { level: 2 })
const cartao = (page: Page) => page.getByRole('region', { name: 'Pronto para registrar' })

test.describe('Decidir', () => {
  let c: Cenario

  test.beforeEach(async () => {
    await limparConversasNoBanco()
    await limparDemandasNoBanco()
    c = await prepararCenario()
  })

  test.afterAll(async () => {
    await limparConversasNoBanco()
    await limparDemandasNoBanco()
    await revogarFontesDaFabricaNoBanco()
  })

  test('item simples com um toque: pedido triado → "Fila de agentes" → cartão → "Confirmar e ir para a próxima" → próximo item; demanda sai da espera; captura pedido', async ({
    page,
  }, testInfo) => {
    const id = await demanda(c, LEMBRETE)
    await demanda(c, PDF)
    await demanda(c, CONTATO)
    await entrar(page)
    await page.goto('/decidir')

    await expect(tituloDoItem(page)).toHaveText(LEMBRETE.titulo)
    await expect(page.getByText('Fazemos isso agora, depois, ou não fazemos?')).toBeVisible()
    await expect(page.getByText(LEMBRETE.triagem.motivo, { exact: false })).toBeVisible()

    await page.getByRole('button', { name: 'Fila de agentes', exact: true }).click()
    await expect(cartao(page)).toContainText('Destino: Fila de agentes')
    await semRolagemHorizontal(page)
    await capturar(page, testInfo.project.name, 'pedido')

    await cartao(page).getByRole('button', { name: 'Confirmar e ir para a próxima' }).click()
    await expect(tituloDoItem(page)).toHaveText(PDF.titulo)
    expect(await esperaDaDemandaNoBanco(id)).toMatchObject({ espera: null, encerrada: null })
  })

  test('duas réplicas até o cartão: Paulo escreve com uma imagem → GET /api/fabrica/conversas traz a conversa com o nome da imagem → resposta do agente com duas rápidas → Paulo toca uma → resposta com cartão destino → aparece em até 3 s sem recarregar → confirmar; captura conversa-com-cartao', async ({
    page,
    request,
  }, testInfo) => {
    const id = await demanda(c, LEMBRETE)
    await entrar(page)
    await page.goto('/decidir')
    await expect(page.getByText(LEMBRETE.triagem.motivo, { exact: false })).toBeVisible()

    const caixa = page.getByLabel('Mensagem')
    await caixa.fill(
      'Fila de agentes, mas quero poder escolher quantos dias antes. E tem que respeitar quem pediu para não receber mensagem.',
    )
    await page
      .getByLabel('Escolher imagem')
      .setInputFiles({ name: 'print-config-cobranca.png', mimeType: 'image/png', buffer: PNG })
    await caixa.press('Enter')
    await expect(page.getByText(/Enviada, aguardando o agente/)).toBeVisible()
    await expect(page.getByRole('img', { name: 'print-config-cobranca.png' })).toBeVisible()

    const primeira = await conversaNaBusca(request, c, LEMBRETE.titulo)
    const mensagens = primeira.mensagens as { autor: string; anexos: { nome: string }[] }[]
    expect(mensagens.at(-1)).toMatchObject({
      autor: 'paulo',
      anexos: [{ nome: 'print-config-cobranca.png' }],
    })
    const r1 = await responderConversa(request, c.token, primeira.id, {
      emRespostaA: primeira.responderA,
      mensagem:
        'Entendido. Pelo print, a tela de cobrança já tem "dias de carência"; ponho o campo novo ao lado. Uma dúvida só: o lembrete vale para todos os clientes ou o vendedor liga por carteira?',
      respostasRapidas: ['Todos, ligado por padrão', 'O vendedor liga por carteira'],
    })
    expect(r1, JSON.stringify(r1.json)).toMatchObject({ status: 201 })

    const rapida = page.getByRole('button', { name: 'Todos, ligado por padrão' })
    await expect(rapida).toBeVisible({ timeout: 3_000 })
    await rapida.click()
    await expect(page.getByText(/Enviada, aguardando o agente/)).toBeVisible()

    const segunda = await conversaNaBusca(request, c, LEMBRETE.titulo)
    expect(segunda.responderA).not.toBe(primeira.responderA)
    const r2 = await responderConversa(request, c.token, segunda.id, {
      emRespostaA: segunda.responderA,
      mensagem: 'Fechado. Registro assim:',
      respostasRapidas: [],
      cartao: {
        acao: 'destino',
        destino: 'fila_de_agentes',
        nivel: 'aprovar_desenho',
        escopo: 'lembrete configurável em dias, ligado por padrão, respeita quem recusou mensagens',
        resposta: 'Vamos fazer. Você será avisada quando estiver no ar.',
      },
    })
    expect(r2, JSON.stringify(r2.json)).toMatchObject({ status: 201 })

    // A consulta a cada 2 s traz o cartão sem recarregar a página.
    await expect(cartao(page)).toContainText('lembrete configurável em dias', { timeout: 3_000 })
    await expect(cartao(page)).toContainText('Vamos fazer. Você será avisada')
    await semRolagemHorizontal(page)
    await capturar(page, testInfo.project.name, 'conversa-com-cartao')

    await cartao(page).getByRole('button', { name: 'Confirmar e ir para a próxima' }).click()
    await expect(page.getByText('Nada esperando por você.')).toBeVisible()
    expect(await esperaDaDemandaNoBanco(id)).toMatchObject({ espera: null, encerrada: null })
  })

  test('fim de fase: retrato com a issue 41 → "Fase 2 concluída: cadastro" com "Aprovar a fase" → cartão com o PR #412 e o head → "Confirmar e mergear" → item sai; captura fim-de-fase', async ({
    page,
    request,
  }, testInfo) => {
    await retratoComFimDeFase(request, c)
    await entrar(page)
    await page.goto('/decidir')

    await expect(tituloDoItem(page)).toHaveText('Fase 2 concluída: cadastro')
    await expect(page.getByText('Aprovo a fase e sigo para a próxima?')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Aprovar a fase' })).toBeVisible()
    await expect(cartao(page)).toContainText('PR #412')
    await expect(cartao(page)).toContainText('a41c9e2')
    await semRolagemHorizontal(page)
    await capturar(page, testInfo.project.name, 'fim-de-fase')

    await cartao(page).getByRole('button', { name: 'Confirmar e mergear' }).click()
    await expect(page.getByText('Nada esperando por você.')).toBeVisible()
  })

  test('pergunta da Fábrica legível: título sem prefixo, destaque do corpo, markdown, opções, diagrama, detalhes recolhidos; o toque numa opção leva ao cartão Responder; capturas da leitura', async ({
    page,
    request,
  }, testInfo) => {
    const r = await enviarRetratoDaFabrica(
      request,
      c.token,
      retratoComDecisoes('lead-de-formulario-na-ficha', [PERGUNTA_43]),
    )
    expect(r, JSON.stringify(r.json)).toMatchObject({ status: 200 })
    await entrar(page)
    await page.goto('/decidir')

    await expect(tituloDoItem(page)).toHaveText(
      'Em que ordem a ficha do lead mostra os campos extras do formulário?',
    )
    await expect(page.getByRole('region', { name: 'O que preciso de você' })).toContainText(
      'Escolher a ordem dos campos extras na ficha',
    )
    const conversa = page.getByRole('list').filter({ hasText: 'O que aconteceu' }).first()
    await expect(conversa.getByRole('heading', { name: 'O que aconteceu' })).toBeVisible()
    await expect(conversa.locator('strong', { hasText: 'na ordem em que o cliente' })).toBeVisible()
    await expect(page.getByText('**')).toHaveCount(0)
    await expect(page.getByText('Feche esta issue')).toHaveCount(0)

    const opcoes = page.getByRole('list', { name: 'Opções' }).getByRole('listitem')
    await expect(opcoes).toHaveCount(2)
    await expect(opcoes.first()).toContainText('Recomendada')

    // O diagrama é desenhado de verdade pelo Mermaid.
    const figura = page.locator('figure', { hasText: 'Diagrama enviado pelo agente' })
    await expect(figura.locator('svg')).toBeVisible()
    await expect(figura.locator('svg')).toContainText('Recebimento')

    const detalhes = page.locator('details', { hasText: 'Detalhes técnicos' })
    await expect(detalhes.getByRole('table')).toBeHidden()
    await semRolagemHorizontal(page)
    await capturar(page, testInfo.project.name, 'leitura', PASTA_DA_LEITURA)

    await detalhes.locator('summary').click()
    await expect(detalhes.getByRole('table')).toBeVisible()
    await semRolagemHorizontal(page)
    await capturar(page, testInfo.project.name, 'leitura-detalhes-abertos', PASTA_DA_LEITURA)

    await figura.getByRole('button', { name: 'Ampliar' }).click()
    await expect(page.getByRole('dialog', { name: 'Diagrama' })).toBeVisible()
    await capturar(page, testInfo.project.name, 'leitura-diagrama-ampliado', PASTA_DA_LEITURA)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Diagrama' })).toBeHidden()

    await page
      .getByRole('group', { name: 'Responder com uma opção' })
      .getByRole('button', { name: '1. Ordem alfabética' })
      .click()
    await expect(cartao(page)).toContainText('1. Ordem alfabética')
    await semRolagemHorizontal(page)
    await capturar(page, testInfo.project.name, 'leitura-cartao', PASTA_DA_LEITURA)
  })

  test('atendente parado: mensagem fica "Enviada, aguardando o agente"; com o relógio adiantado 61 s aparece "O agente está demorando…" e "Não vamos fazer" leva ao cartão e à confirmação sem o agente; captura sem-agente', async ({
    page,
    request,
  }, testInfo) => {
    const id = await demanda(c, CONTATO)
    // O atendente buscou há pouco, mas não responde.
    expect((await buscarConversas(request, c.token)).status).toBe(200)
    await page.clock.install()
    await entrar(page)
    await page.goto('/decidir')
    await expect(page.getByText(CONTATO.triagem.motivo)).toBeVisible()

    await page.getByLabel('Mensagem').fill('Precisa trocar também nos e-mails?')
    await page.getByRole('button', { name: 'Enviar' }).click()
    await expect(page.getByText(/Enviada, aguardando o agente/)).toBeVisible()
    await expect(page.getByText('O agente está demorando', { exact: false })).toHaveCount(0)

    await page.clock.fastForward(61_000)
    const semEle = page.getByRole('group', { name: 'Decidir sem o agente' })
    await expect(semEle).toContainText('O agente está demorando. Você pode decidir sem ele:')
    await semRolagemHorizontal(page)
    await capturar(page, testInfo.project.name, 'sem-agente')

    await semEle.getByRole('button', { name: 'Não vamos fazer' }).click()
    await expect(cartao(page)).toContainText('não vamos fazer; a demanda é encerrada')
    await cartao(page).getByRole('button', { name: 'Confirmar e ir para a próxima' }).click()
    await expect(page.getByText('Nada esperando por você.')).toBeVisible()
    expect((await esperaDaDemandaNoBanco(id)).encerrada).not.toBeNull()
  })

  test('Início mostra "N itens esperam sua resposta" com link para Decidir e o menu mostra o contador; ↓ troca de item no desktop', async ({
    page,
    request,
  }, testInfo) => {
    await demanda(c, LEMBRETE)
    await demanda(c, PDF)
    await retratoComFimDeFase(request, c)
    await entrar(page)

    await expect(page.getByText('3 itens esperam sua resposta')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Abrir Decidir' })).toHaveAttribute(
      'href',
      '/decidir',
    )
    if (testInfo.project.name === 'mobile') {
      await page.getByRole('button', { name: 'Abrir navegação' }).click()
    }
    await expect(
      page.getByRole('link', { name: /Decidir/ }).getByLabel('3 esperando'),
    ).toBeVisible()
    if (testInfo.project.name === 'mobile') return

    await page.goto('/decidir')
    // O fim de fase vem antes dos pedidos; os pedidos, do mais antigo ao mais novo.
    await expect(tituloDoItem(page)).toHaveText('Fase 2 concluída: cadastro')
    await expect(
      page.getByRole('navigation', { name: 'Pilha do Decidir' }).getByTitle('Fábrica'),
    ).toBeVisible()
    await page.getByRole('heading', { level: 1, name: 'Decidir' }).click()
    await page.keyboard.press('ArrowDown')
    await expect(tituloDoItem(page)).toHaveText(LEMBRETE.titulo)
    await page.keyboard.press('ArrowDown')
    await expect(tituloDoItem(page)).toHaveText(PDF.titulo)
  })
})
