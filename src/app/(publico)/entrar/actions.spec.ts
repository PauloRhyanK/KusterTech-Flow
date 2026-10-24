import { beforeEach, describe, expect, test, vi } from 'vitest'

const { cookieSetMock, headersGetMock, redirectMock, logErrorMock } = vi.hoisted(() => ({
  cookieSetMock: vi.fn(),
  headersGetMock: vi.fn<(nome: string) => string | null>(() => null),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  logErrorMock: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    set: cookieSetMock,
  })),
  headers: vi.fn(async () => ({
    get: headersGetMock,
  })),
}))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}))

vi.mock('@/lib/db', () => ({
  db: {},
}))

vi.mock('@/lib/log', () => ({
  log: {
    error: logErrorMock,
  },
}))

vi.mock('@/modules/usuarios/service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/modules/usuarios/service')>()
  return {
    ...original,
    autenticar: vi.fn(),
  }
})

vi.mock('@/lib/auth/sessao', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/sessao')>()
  return {
    ...original,
    criarSessao: vi.fn(),
  }
})

import { criarSessao } from '@/lib/auth/sessao'
import { autenticar } from '@/modules/usuarios/service'
import { entrar } from './actions'

function criarFormData(email: string, senha: string): FormData {
  const form = new FormData()
  form.set('email', email)
  form.set('senha', senha)
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
  headersGetMock.mockReturnValue(null)
})

describe('action entrar (unitário)', () => {
  test('formulário vazio ou com e-mail inválido devolve "Informe e-mail e senha." sem chamar autenticar', async () => {
    const vazio = await entrar({}, criarFormData('', ''))
    expect(vazio).toEqual({
      erro: 'Informe e-mail e senha.',
      email: '',
    })

    const emailInvalido = await entrar({}, criarFormData('invalido-sem-arroba', 'senha123'))
    expect(emailInvalido).toEqual({
      erro: 'Informe e-mail e senha.',
      email: 'invalido-sem-arroba',
    })

    expect(autenticar).not.toHaveBeenCalled()
    expect(cookieSetMock).not.toHaveBeenCalled()
  })

  test('aceita e-mail com domínio local (ex.: admin@localhost) e valida IP de x-forwarded-for (válido, inválido e ausente)', async () => {
    vi.mocked(autenticar).mockResolvedValue({ ok: false, motivo: 'credenciais' })

    // 1. Cabeçalho válido (lista de IPs)
    headersGetMock.mockImplementation((nome) =>
      nome === 'x-forwarded-for' ? '203.0.113.42, 10.0.0.1' : null,
    )
    const resValido = await entrar({}, criarFormData('admin@localhost', 'senha-errada'))
    expect(resValido).toEqual({
      erro: 'E-mail ou senha incorretos.',
      email: 'admin@localhost',
    })
    expect(autenticar).toHaveBeenLastCalledWith({
      email: 'admin@localhost',
      senha: 'senha-errada',
      ip: '203.0.113.42',
    })

    // 2. Cabeçalho inválido (texto arbitrário)
    headersGetMock.mockImplementation((nome) =>
      nome === 'x-forwarded-for' ? 'ip-forjado-invalido' : null,
    )
    await entrar({}, criarFormData('admin@localhost', 'senha-errada'))
    expect(autenticar).toHaveBeenLastCalledWith({
      email: 'admin@localhost',
      senha: 'senha-errada',
      ip: 'desconhecido',
    })

    // 3. Cabeçalho ausente
    headersGetMock.mockReturnValue(null)
    await entrar({}, criarFormData('admin@localhost', 'senha-errada'))
    expect(autenticar).toHaveBeenLastCalledWith({
      email: 'admin@localhost',
      senha: 'senha-errada',
      ip: 'desconhecido',
    })
  })

  test('concordância singular/plural na mensagem de bloqueio (1 minuto vs N minutos)', async () => {
    const agora = Date.now()

    vi.mocked(autenticar).mockResolvedValueOnce({
      ok: false,
      motivo: 'bloqueado',
      bloqueadoAte: new Date(agora + 30_000),
    })
    const res1Min = await entrar({}, criarFormData('paulo@exemplo.com', 'senha123'))
    expect(res1Min).toEqual({
      erro: 'Muitas tentativas. Tente novamente em 1 minuto.',
      email: 'paulo@exemplo.com',
    })

    vi.mocked(autenticar).mockResolvedValueOnce({
      ok: false,
      motivo: 'bloqueado',
      bloqueadoAte: new Date(agora + 14 * 60_000 + 10_000),
    })
    const res15Min = await entrar({}, criarFormData('paulo@exemplo.com', 'senha123'))
    expect(res15Min).toEqual({
      erro: 'Muitas tentativas. Tente novamente em 15 minutos.',
      email: 'paulo@exemplo.com',
    })
  })

  test('erro inesperado em autenticar é registrado no log, devolve mensagem amigável e não grava cookie', async () => {
    vi.mocked(autenticar).mockRejectedValueOnce(new Error('Falha de conexão com o banco'))

    const resultado = await entrar({}, criarFormData('paulo@exemplo.com', 'senha-forte-123'))

    expect(resultado).toEqual({
      erro: 'Não foi possível entrar agora. Tente novamente em instantes.',
      email: 'paulo@exemplo.com',
    })
    expect(logErrorMock).toHaveBeenCalledTimes(1)
    expect(criarSessao).not.toHaveBeenCalled()
    expect(cookieSetMock).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })
})
