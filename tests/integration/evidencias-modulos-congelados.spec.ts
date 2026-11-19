import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { POST as postDeploy } from '@/app/api/evidencias/deploy/route'
import { POST as postVerificacao } from '@/app/api/evidencias/verificacao/route'
import { POST as postInexistente } from '@/app/api/[...caminho]/route'
import { limparBanco } from './banco-de-teste'

// Sem FLOW_MODULOS_EXTRAS: os módulos ambientes e publicacao ficam congelados.
beforeEach(async () => {
  await limparBanco()
})

afterAll(async () => {
  await db.$disconnect()
})

function requisicao(caminho: string): Request {
  return new Request(`http://localhost/api/evidencias/${caminho}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fle_x', 'content-type': 'application/json' },
    body: '{}',
  })
}

// O 404 de módulo congelado é igual ao de uma rota de API que não existe.
async function comoRotaInexistente(resposta: Response): Promise<void> {
  const inexistente = postInexistente()
  expect(resposta.status).toBe(404)
  expect(resposta.headers.get('content-type')).toBe(inexistente.headers.get('content-type'))
  expect(await resposta.json()).toEqual(await inexistente.json())
}

describe('endpoints de evidência com os módulos padrão', () => {
  test('deploy responde 404 e não grava evidência', async () => {
    const resposta = await postDeploy(requisicao('deploy'))
    await comoRotaInexistente(resposta)
    expect(await db.evidenciaDeploy.count()).toBe(0)
  })

  test('verificação responde 404 e não grava verificação', async () => {
    const resposta = await postVerificacao(requisicao('verificacao'))
    await comoRotaInexistente(resposta)
    expect(await db.evidenciaDeploy.count()).toBe(0)
  })
})
