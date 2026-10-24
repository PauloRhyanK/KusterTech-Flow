import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import type { SessaoAtual } from '@/lib/auth/sessao'

const { redirectMock, revalidatePathMock, logErrorMock, obterSessaoMock, definirTemaMock } =
  vi.hoisted(() => ({
    redirectMock: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`)
    }),
    revalidatePathMock: vi.fn(),
    logErrorMock: vi.fn(),
    obterSessaoMock: vi.fn<() => Promise<SessaoAtual | null>>(),
    definirTemaMock: vi.fn(),
  }))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}))

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
}))

vi.mock('@/lib/log', () => ({
  log: {
    error: logErrorMock,
  },
}))

vi.mock('@/lib/auth/sessao', () => ({
  obterSessao: obterSessaoMock,
}))

vi.mock('@/modules/usuarios/service', () => ({
  definirTema: definirTemaMock,
}))

import { alterarTema } from './actions'

describe('alterarTema', () => {
  const sujeitoMock: Sujeito = {
    usuarioId: 'usr-1',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  }

  const sessaoMock: SessaoAtual = {
    sessaoId: 'ses-1',
    usuario: {
      id: 'usr-1',
      nome: 'Usuário Teste',
      email: 'teste@kustertech.com.br',
      tema: 'sistema',
    },
    sujeito: sujeitoMock,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('sem sessão redireciona para /entrar e não chama definirTema', async () => {
    obterSessaoMock.mockResolvedValueOnce(null)

    const formData = new FormData()
    formData.append('tema', 'escuro')

    await expect(alterarTema({}, formData)).rejects.toThrow('NEXT_REDIRECT:/entrar')
    expect(redirectMock).toHaveBeenCalledWith('/entrar')
    expect(definirTemaMock).not.toHaveBeenCalled()
  })

  test('tema inválido devolve erro e não chama definirTema', async () => {
    obterSessaoMock.mockResolvedValueOnce(sessaoMock)

    const formData = new FormData()
    formData.append('tema', 'tema-inexistente')

    const resultado = await alterarTema({}, formData)

    expect(resultado).toEqual({ erro: 'Escolha um tema válido.' })
    expect(definirTemaMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  test('tema válido chama definirTema com o sujeito da sessão e devolve salvo com o tema', async () => {
    obterSessaoMock.mockResolvedValueOnce(sessaoMock)
    definirTemaMock.mockResolvedValueOnce(undefined)

    const formData = new FormData()
    formData.append('tema', 'escuro')

    const resultado = await alterarTema({}, formData)

    expect(resultado).toEqual({ salvo: true, tema: 'escuro' })
    expect(definirTemaMock).toHaveBeenCalledWith(sujeitoMock, 'escuro')
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
  })

  test('erro inesperado ao definir tema registra no log e devolve erro amigável', async () => {
    obterSessaoMock.mockResolvedValueOnce(sessaoMock)
    const erroBanco = new Error('Falha no banco')
    definirTemaMock.mockRejectedValueOnce(erroBanco)

    const formData = new FormData()
    formData.append('tema', 'claro')

    const resultado = await alterarTema({}, formData)

    expect(resultado).toEqual({
      erro: 'Não foi possível salvar a preferência agora. Tente novamente em instantes.',
    })
    expect(logErrorMock).toHaveBeenCalledTimes(1)
    expect(logErrorMock).toHaveBeenCalledWith(
      { err: erroBanco },
      'Erro inesperado ao salvar preferência de tema.',
    )
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})
