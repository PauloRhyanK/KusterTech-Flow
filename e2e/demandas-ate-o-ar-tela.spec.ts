import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  criarDemandaAteOArNoBanco,
  criarProjetoNoBanco,
  exibirProjetoComoNoBanco,
  limparDemandasNoBanco,
  nomeDeTeste,
} from './support/banco'

// D74: a lista e o detalhe "até o ar" no navegador, com uma demanda em cada um dos quatro grupos,
// comparados com o desenho de 25/11 (01-lista.png e 02-detalhe.png).

const PASTA = 'docs/superpowers/specs/desenhos/2026-11-25-no-ar/capturas'
const PORTAL = 'kustertech-exemplo/portal'
const API = 'kustertech-exemplo/api'
const HORA = 60 * 60_000

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

async function semear(): Promise<{ faltaId: string }> {
  const alfa = await criarProjetoNoBanco(nomeDeTeste('Projeto Alfa'))
  const beta = await criarProjetoNoBanco(nomeDeTeste('Projeto Beta'))
  await exibirProjetoComoNoBanco(alfa.id, 'Projeto Alfa')
  await exibirProjetoComoNoBanco(beta.id, 'Projeto Beta')
  const agora = Date.now()

  // Espera você.
  await criarDemandaAteOArNoBanco({
    projetoId: alfa.id,
    repositorio: PORTAL,
    titulo: 'Tela de funil de vendas',
    partes: [{ chave: 'portal', repositorio: PORTAL, ordem: 1 }],
    demanda: {
      etapaAtual: 'desenho',
      concluidas: ['recebida', 'planejada'],
      desenhoAprovado: null,
      espera: 'travada',
      esperaMotivo: 'O teste de contrato falhou',
      esperaDesde: new Date(agora - 4 * 24 * HORA),
    },
  })

  // Não chegou ao ar: back ainda planejando e front com a publicação dispensada.
  const falta = await criarDemandaAteOArNoBanco({
    projetoId: alfa.id,
    repositorio: PORTAL,
    titulo: 'Modo editor com IA',
    partes: [
      {
        chave: 'front',
        repositorio: PORTAL,
        ordem: 2,
        dependeDe: ['back'],
        estado: 'NAO_CHEGOU',
        motivo: 'Publicação dispensada',
        prs: 3,
      },
      { chave: 'back', repositorio: API, ordem: 1, objetivo: 'aba, IA e envio' },
    ],
    demanda: { naoChegouDesde: new Date(agora - 24 * HORA) },
    eventos: [
      { tipo: 'criada', origem: 'flow' },
      { tipo: 'triagem', origem: 'fabrica' },
      { tipo: 'desenho_aprovado', origem: 'paulo', dados: { versao: 1 } },
      { tipo: 'parte_feita', origem: 'fabrica', dados: { chave: 'front' } },
    ],
  })
  await criarDemandaAteOArNoBanco({
    projetoId: alfa.id,
    repositorio: API,
    titulo: 'Orientador por IA e fila de relatos',
    partes: [
      {
        chave: 'back',
        repositorio: API,
        ordem: 1,
        estado: 'NAO_CHEGOU',
        motivo: 'Nunca foi publicada',
        prs: 1,
      },
    ],
    demanda: {
      etapaAtual: 'no_ar',
      concluidas: ['recebida', 'planejada', 'desenho', 'desenvolvida', 'testada', 'entregue'],
      naoChegouDesde: new Date(agora - 5 * 24 * HORA),
    },
  })

  // A caminho.
  await criarDemandaAteOArNoBanco({
    projetoId: alfa.id,
    repositorio: PORTAL,
    titulo: 'Suporte por IA no CRM',
    partes: [
      { chave: 'front', repositorio: PORTAL, ordem: 1, estado: 'NO_AR', commitNoAr: 'a1b2c3d4e5' },
      {
        chave: 'back',
        repositorio: API,
        ordem: 2,
        estado: 'PUBLICANDO',
        motivo: 'Conferindo o site',
      },
    ],
    demanda: {
      etapaAtual: 'no_ar',
      concluidas: ['recebida', 'planejada', 'desenho', 'desenvolvida', 'testada', 'entregue'],
    },
  })

  // No ar.
  const fechada = {
    etapaAtual: 'no_ar',
    concluidas: [
      'recebida',
      'planejada',
      'desenho',
      'desenvolvida',
      'testada',
      'entregue',
      'no_ar',
    ],
    encerrada: 'no_ar',
    noArEm: new Date(agora - HORA),
  }
  await criarDemandaAteOArNoBanco({
    projetoId: alfa.id,
    repositorio: PORTAL,
    titulo: 'Nome da aba na ficha do lead',
    partes: [
      { chave: 'front', repositorio: PORTAL, ordem: 1, estado: 'NO_AR', commitNoAr: 'c5c01ba7d2' },
    ],
    demanda: fechada,
  })
  await criarDemandaAteOArNoBanco({
    projetoId: beta.id,
    repositorio: API,
    titulo: 'Restauração do backup',
    partes: [
      { chave: 'back', repositorio: API, ordem: 1, estado: 'NO_AR', commitNoAr: '9c127b7e11' },
    ],
    demanda: { ...fechada, temTela: false },
  })
  return { faltaId: falta.id }
}

test.afterEach(async () => {
  await limparDemandasNoBanco()
})

test('lista e detalhe até o ar: quatro números, grupos, faixa "Falta" e partes na ordem; capturas', async ({
  page,
}, testInfo) => {
  const tela = testInfo.project.name === 'mobile' ? 'mobile' : 'desktop'
  if (tela === 'desktop') await page.setViewportSize({ width: 1440, height: 900 })
  await limparDemandasNoBanco()
  const { faltaId } = await semear()
  await entrar(page)

  await page.goto('/demandas')
  const quadros = page.getByRole('region', { name: 'Demandas até o ar' }).getByRole('link')
  await expect(quadros).toHaveText([
    /^2No ar/,
    /^1A caminho/,
    /^2Não chegou ao ar/,
    /^1Espera vocêhá 4 dias$/,
  ])
  for (const [grupo, n] of [
    ['Espera você', 1],
    ['Não chegou ao ar', 2],
    ['A caminho', 1],
    ['No ar', 2],
  ] as const) {
    await expect(
      page
        .getByRole('region', { name: grupo })
        .getByRole('listitem')
        .filter({
          has: page.getByRole('link'),
        }),
    ).toHaveCount(n)
  }
  const linha = page.getByRole('link', { name: /Modo editor com IA/ })
  await expect(linha.getByText('back · planejando')).toBeVisible()
  await expect(linha.getByText('front · dispensada')).toBeVisible()
  await expect(linha.getByText('Falta a parte do back')).toBeVisible()
  await expect(page.getByText('No ar · c5c01ba')).toBeVisible()
  await capturar(page, `lista-${tela}`)

  await page.goto(`/demandas/${faltaId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Modo editor com IA' })).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Falta: a parte do back (aba, IA e envio)' }),
  ).toContainText('A Fábrica está planejando essa parte.')
  await expect(page.getByText('Ordem de publicação: back antes do front')).toBeVisible()
  const cartoes = page.getByRole('article')
  await expect(cartoes.getByRole('heading')).toHaveText(['1 · Back', '2 · Front'])
  await expect(cartoes.nth(1).getByText('espera o back')).toBeVisible()
  // A demanda tem tela: o passo "Desenho aprovado" fica na parte da tela (a de entrada, o front).
  await expect(cartoes.nth(1).getByText('Desenho aprovado')).toBeVisible()
  await expect(cartoes.nth(0).getByText('Desenho aprovado')).toHaveCount(0)
  await expect(page.getByText('Histórico')).toBeVisible()
  await expect(page.getByText('4 eventos')).toBeVisible()
  await expect(page.getByText('Desenho aprovado (versão 1)')).toBeHidden()
  await capturar(page, `detalhe-${tela}`)
})
