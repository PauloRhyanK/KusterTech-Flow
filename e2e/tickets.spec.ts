import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  criarDemandaAteOArNoBanco,
  criarProjetoNoBanco,
  criarRelatoNoBanco,
  criarSistemaConectadoNoBanco,
  exibirProjetoComoNoBanco,
  limparDemandasNoBanco,
  nomeDeTeste,
} from './support/banco'

// D74: a tela /tickets no navegador (lista, detalhe com a imagem gravada, link para a demanda e
// filtro), comparada com o esboço aprovado (opção A, lista à esquerda e detalhe ao lado).

const PASTA = 'docs/superpowers/specs/assets/tickets'
const PORTAL = 'kustertech-exemplo/portal'
const MINUTO = 60_000
const TITULO_DA_DEMANDA = 'Notificação fica em cima do botão após transferir lead'
const TEXTO =
  'Estamos com um problema no celular: depois de transferir um lead, a notificação fica em cima do botão e impede de transferir outro; tem que fechar o app.'

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

async function capturar(page: Page, nome: string): Promise<void> {
  mkdirSync(PASTA, { recursive: true })
  await page.screenshot({ path: join(PASTA, `${nome}.png`), fullPage: true })
}

// Um "print" do app, desenhado no próprio navegador, para a imagem do relato ser uma PNG de verdade.
async function printDoApp(page: Page): Promise<Buffer> {
  await page.setContent(
    `<body style="margin:0"><div id="p" style="width:180px;height:320px;background:#eef2f6;font:13px sans-serif;padding:12px;box-sizing:border-box">
      <b>Leads</b><div style="margin-top:12px;height:36px;background:#fff;border-radius:6px"></div>
      <div style="margin-top:8px;height:36px;background:#fff;border-radius:6px"></div>
      <div style="margin-top:150px;padding:8px;background:#3ecf8e;color:#fff;border-radius:6px">Lead transferido</div>
    </div></body>`,
  )
  return page.locator('#p').screenshot()
}

async function semear(page: Page): Promise<{ demandaId: string }> {
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto CAIS'))
  await exibirProjetoComoNoBanco(projeto.id, 'CAIS')
  const agora = Date.now()
  const demanda = await criarDemandaAteOArNoBanco({
    projetoId: projeto.id,
    repositorio: PORTAL,
    titulo: TITULO_DA_DEMANDA,
    partes: [{ chave: 'front', repositorio: PORTAL, ordem: 1 }],
    demanda: {
      etapaAtual: 'planejada',
      concluidas: ['recebida'],
      desenhoAprovado: null,
      criadaEm: new Date(agora - 8 * MINUTO),
    },
  })
  const sistema = await criarSistemaConectadoNoBanco({
    nome: 'CAIS v2',
    projetoId: projeto.id,
    repositorio: PORTAL,
  })
  await criarRelatoNoBanco({
    sistemaId: sistema.id,
    idExterno: 'rel_8f2a',
    resultado: 'SEGUE',
    em: new Date(agora - 10 * MINUTO),
    autorNome: 'Isabeli Casa Grande',
    autorPapel: 'corretora',
    texto: TEXTO,
    assunto: '/leads/transferir',
    versao: '2.14.3',
    ticket: 'CAIS-1842',
    demandaId: demanda.id,
    imagem: await printDoApp(page),
    envios: [
      {
        estado: 'recebida',
        mensagem: 'Recebemos, está na fila.',
        enviadoEm: new Date(agora - 7 * MINUTO),
      },
    ],
  })
  await criarRelatoNoBanco({
    sistemaId: sistema.id,
    idExterno: 'rel_91c0',
    resultado: 'ORIENTADO',
    em: new Date(agora - 20 * MINUTO),
    autorNome: 'Marcos Lima',
    autorPapel: 'corretor',
    assunto: '/tarefas',
  })
  return { demandaId: demanda.id }
}

test.afterEach(async () => {
  await limparDemandasNoBanco()
})

test('tickets: quadros, lista de hoje, detalhe com imagem, link da demanda e filtro; capturas', async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  if (!mobile) await page.setViewportSize({ width: 1440, height: 900 })
  await limparDemandasNoBanco()
  const { demandaId } = await semear(page)
  await entrar(page)

  await page.goto('/tickets')
  await expect(page.getByRole('heading', { level: 1, name: 'Tickets' })).toBeVisible()
  for (const [rotulo, n] of [
    ['chegaram em 7 dias', 2],
    ['viraram demanda', 1],
    ['orientados na hora', 1],
    ['sem demanda', 0],
  ] as const) {
    await expect(page.getByText(rotulo, { exact: true }).locator('..')).toHaveText(`${n}${rotulo}`)
  }
  const hoje = page.getByRole('region', { name: 'Hoje' })
  await expect(hoje.getByRole('heading')).toHaveText('Hoje · 2')
  const linhas = hoje.getByRole('link')
  await expect(linhas).toHaveCount(2)
  await expect(linhas.nth(0)).toContainText('Isabeli Casa Grande · CAIS v2 · app')
  await expect(linhas.nth(0)).toContainText('1 imagem')
  await expect(linhas.nth(1)).toContainText('Marcos Lima · CAIS v2 · app')
  // Sem ticket escolhido: no desktop o painel pede a escolha; no celular só a lista aparece.
  if (mobile) {
    await expect(page.getByText('Escolha um ticket')).toBeHidden()
  } else {
    await expect(page.getByText('Escolha um ticket')).toBeVisible()
    await capturar(page, '01-lista-desktop')
  }

  await linhas.nth(0).click()
  await expect(page).toHaveURL(/[?&]t=/)
  const detalhe = page.getByRole('article', { name: 'Detalhe do ticket' })
  await expect(detalhe).toBeVisible()
  await expect(detalhe.getByRole('heading', { level: 2 })).toHaveText(
    /^Estamos com um problema no celular: depois de transferir um lead/,
  )
  await expect(detalhe.getByText(/^Ticket #CAIS-1842 · recebido/)).toBeVisible()
  await expect(detalhe.getByRole('region', { name: 'O que foi enviado' })).toContainText(TEXTO)
  const imagem = detalhe.getByRole('img', { name: 'Imagem 1' })
  await expect(imagem).toBeVisible()
  await expect
    .poll(() => imagem.evaluate((i) => (i as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
  const origem = detalhe.getByRole('region', { name: 'De onde veio' })
  await expect(origem).toContainText('AppCAIS v2')
  await expect(origem).toContainText('Tela/leads/transferir')
  await expect(origem).toContainText('Versão2.14.3')
  await expect(origem).toContainText('Id no apprel_8f2a')
  const historico = detalhe.getByRole('region', { name: 'Histórico' }).getByRole('listitem')
  // Em ordem de data; "Buscado pelo Flow" é a gravação do relato (agora), depois do aviso.
  await expect(historico).toHaveCount(4)
  await expect(historico.nth(0)).toContainText('Relatado no app')
  await expect(historico.nth(1)).toContainText('Virou demanda')
  await expect(historico.nth(2)).toContainText('Aviso ao usuário: recebida')
  await expect(historico.nth(2)).toContainText('Recebemos, está na fila. · enviado')
  await expect(historico.nth(3)).toContainText('Buscado pelo Flow')
  if (mobile) {
    // Com um ticket escolhido, o celular mostra só o detalhe, com o caminho de volta.
    await expect(hoje).toBeHidden()
    await expect(page.getByRole('link', { name: 'Voltar à lista' })).toBeVisible()
    await capturar(page, '03-detalhe-mobile')
  } else {
    await expect(linhas.nth(0)).toHaveAttribute('aria-current', 'true')
    await capturar(page, '02-detalhe-desktop')
  }

  await detalhe.getByRole('link', { name: TITULO_DA_DEMANDA }).click()
  await expect(page).toHaveURL(new RegExp(`/demandas/${demandaId}$`))
  await expect(page.getByRole('heading', { level: 1, name: TITULO_DA_DEMANDA })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tickets de origem: 1' })).toBeVisible()

  await page.goto('/tickets')
  await page.getByLabel('Resultado').selectOption('orientado')
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect(page).toHaveURL(/[?&]resultado=orientado/)
  const filtradas = page.getByRole('region', { name: 'Hoje' }).getByRole('link')
  await expect(filtradas).toHaveCount(1)
  await expect(filtradas.nth(0)).toContainText('Marcos Lima')
  await expect(filtradas.nth(0)).toContainText('orientado')
})
