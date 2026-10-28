import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import {
  contarEventosDeWebhook,
  criarClienteNoBanco,
  criarUsuarioNoBanco,
  githubIdDoRepositorioNoBanco,
  nomeDeTeste,
} from './support/banco'
import { assinarCorpo, enviarWebhook } from './support/webhook'

async function fazerLogin(page: Page, email: string, senha: string): Promise<void> {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function corpoDeIssueFechada(): Promise<string> {
  const id = await githubIdDoRepositorioNoBanco('kustertech-exemplo/portal')
  return JSON.stringify({
    action: 'closed',
    issue: { number: 3 },
    repository: { id, full_name: 'kustertech-exemplo/portal' },
  })
}

test('POST assinado → 202 e uma linha; reenvio → 200 duplicado e contarEventosDeWebhook = 1', async ({
  request,
}) => {
  const deliveryId = `e2e-${randomUUID()}`
  const corpo = await corpoDeIssueFechada()

  const primeira = await enviarWebhook(request, { evento: 'issues', deliveryId, corpo })
  expect(primeira.status()).toBe(202)
  expect(await primeira.json()).toEqual({ resultado: 'registrado' })
  expect(await contarEventosDeWebhook(deliveryId)).toBe(1)

  const segunda = await enviarWebhook(request, { evento: 'issues', deliveryId, corpo })
  expect(segunda.status()).toBe(200)
  expect(await segunda.json()).toEqual({ resultado: 'duplicado' })
  expect(await contarEventosDeWebhook(deliveryId)).toBe(1)
})

test('POST com assinatura de outro segredo → 401 e contarEventosDeWebhook = 0', async ({
  request,
}) => {
  const deliveryId = `e2e-${randomUUID()}`
  const corpo = await corpoDeIssueFechada()

  const resposta = await enviarWebhook(request, {
    evento: 'issues',
    deliveryId,
    corpo,
    assinatura: assinarCorpo(corpo, 'outro-segredo-qualquer'),
  })
  expect(resposta.status()).toBe(401)
  expect(await contarEventosDeWebhook(deliveryId)).toBe(0)
})

test('testador escopado com sessão ativa faz POST sem assinatura (page.request) → 401; a sessão não autoriza nada e o banco não muda', async ({
  page,
}) => {
  const cliente = await criarClienteNoBanco(nomeDeTeste('Cliente Webhook'))
  const email = `e2e+testador-webhook-${randomUUID()}@local.test`
  const senha = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email,
    nome: 'Testador Webhook',
    senha,
    papel: 'TESTADOR',
    clienteId: cliente.id,
  })
  await fazerLogin(page, email, senha)

  const deliveryId = `e2e-${randomUUID()}`
  const resposta = await enviarWebhook(page.request, {
    evento: 'issues',
    deliveryId,
    corpo: await corpoDeIssueFechada(),
    assinatura: null,
  })
  expect(resposta.status()).toBe(401)
  expect(await contarEventosDeWebhook(deliveryId)).toBe(0)
})
