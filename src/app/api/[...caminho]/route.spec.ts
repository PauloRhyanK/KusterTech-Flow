import { describe, expect, test } from 'vitest'
import { DELETE, GET, PATCH, POST, PUT } from './route'

describe('rota de API inexistente', () => {
  test.each([
    ['GET', GET],
    ['POST', POST],
    ['PUT', PUT],
    ['PATCH', PATCH],
    ['DELETE', DELETE],
  ])('%s responde 404 com corpo JSON fixo', async (_metodo, handler) => {
    const resposta = handler()
    expect(resposta.status).toBe(404)
    expect(resposta.headers.get('content-type')).toMatch(/^application\/json/)
    expect(await resposta.json()).toEqual({ erro: 'Não encontrado.' })
  })
})
