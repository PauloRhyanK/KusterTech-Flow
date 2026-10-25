import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import type { SessaoAtual } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'

const {
  redirectMock,
  revalidatePathMock,
  logErrorMock,
  obterSessaoMock,
  criarClienteMock,
  editarClienteMock,
  arquivarClienteMock,
  desarquivarClienteMock,
} = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  revalidatePathMock: vi.fn(),
  logErrorMock: vi.fn(),
  obterSessaoMock: vi.fn<() => Promise<SessaoAtual | null>>(),
  criarClienteMock: vi.fn(),
  editarClienteMock: vi.fn(),
  arquivarClienteMock: vi.fn(),
  desarquivarClienteMock: vi.fn(),
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

vi.mock('@/modules/clientes/service', () => ({
  criarCliente: criarClienteMock,
  editarCliente: editarClienteMock,
  arquivarCliente: arquivarClienteMock,
  desarquivarCliente: desarquivarClienteMock,
}))

import { alternarArquivamentoAction, criarClienteAction, editarClienteAction } from './actions'

describe('actions de clientes (unitário)', () => {
  const adminId = randomUUID()
  const sujeitoMock: Sujeito = {
    usuarioId: adminId,
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  }

  const sessaoMock: SessaoAtual = {
    sessaoId: 'ses-1',
    usuario: {
      id: adminId,
      nome: 'Administrador',
      email: 'admin@kustertech.com.br',
      tema: 'sistema',
    },
    sujeito: sujeitoMock,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('autenticação e sessão básica', () => {
    test('sem sessão redireciona para /entrar e não chama o service (três actions)', async () => {
      obterSessaoMock.mockResolvedValue(null)

      const formCriar = new FormData()
      formCriar.append('nome', 'Cliente Teste')

      await expect(criarClienteAction({}, formCriar)).rejects.toThrow('NEXT_REDIRECT:/entrar')
      expect(criarClienteMock).not.toHaveBeenCalled()

      const formEditar = new FormData()
      formEditar.append('clienteId', randomUUID())
      formEditar.append('nome', 'Cliente Teste')

      await expect(editarClienteAction({}, formEditar)).rejects.toThrow('NEXT_REDIRECT:/entrar')
      expect(editarClienteMock).not.toHaveBeenCalled()

      const formAlternar = new FormData()
      formAlternar.append('clienteId', randomUUID())
      formAlternar.append('arquivar', 'true')

      await expect(alternarArquivamentoAction({}, formAlternar)).rejects.toThrow(
        'NEXT_REDIRECT:/entrar',
      )
      expect(arquivarClienteMock).not.toHaveBeenCalled()
      expect(desarquivarClienteMock).not.toHaveBeenCalled()
    })
  })

  describe('validação de campos', () => {
    test('nome vazio devolve "O nome é obrigatório." sem chamar o service; observações > 2000 idem', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)

      const formNomeVazio = new FormData()
      formNomeVazio.append('nome', '   ')

      const resNomeVazio = await criarClienteAction({}, formNomeVazio)
      expect(resNomeVazio.erro).toBe('O nome é obrigatório.')
      expect(criarClienteMock).not.toHaveBeenCalled()

      const formObsLonga = new FormData()
      formObsLonga.append('nome', 'Cliente Válido')
      formObsLonga.append('observacoes', 'a'.repeat(2001))

      const resObsLonga = await criarClienteAction({}, formObsLonga)
      expect(resObsLonga.erro).toBe('As observações não podem ter mais de 2000 caracteres.')
      expect(criarClienteMock).not.toHaveBeenCalled()
    })

    test('editarClienteAction valida clienteId inválido sem chamar o service', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)

      const formInvalido = new FormData()
      formInvalido.append('clienteId', 'id-nao-uuid')
      formInvalido.append('nome', 'Cliente Válido')

      const res = await editarClienteAction({}, formInvalido)
      expect(res.erro).toBe('Identificador de cliente inválido.')
      expect(editarClienteMock).not.toHaveBeenCalled()
    })

    test('alternarArquivamentoAction valida enum arquivar', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)

      const formInvalido = new FormData()
      formInvalido.append('clienteId', randomUUID())
      formInvalido.append('arquivar', 'invalido')

      const res = await alternarArquivamentoAction({}, formInvalido)
      expect(res.erro).toBe('Dados inválidos.')
      expect(arquivarClienteMock).not.toHaveBeenCalled()
    })
  })

  describe('tratamento de erros', () => {
    test('ErroDeAutorizacao vira "Sem permissão para gerenciar clientes."; ErroDeDominio devolve a mensagem; erro interno vai ao log com mensagem genérica', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)

      // ErroDeAutorizacao
      criarClienteMock.mockRejectedValueOnce(new ErroDeAutorizacao('clientes.gerenciar'))
      const form = new FormData()
      form.append('nome', 'Cliente')
      const resAuth = await criarClienteAction({}, form)
      expect(resAuth.erro).toBe('Sem permissão para gerenciar clientes.')

      // ErroDeDominio
      criarClienteMock.mockRejectedValueOnce(
        new ErroDeDominio('Já existe um cliente com este nome.'),
      )
      const resDominio = await criarClienteAction({}, form)
      expect(resDominio.erro).toBe('Já existe um cliente com este nome.')

      // Erro interno
      const erroInesperado = new Error('Falha de conexão')
      criarClienteMock.mockRejectedValueOnce(erroInesperado)
      const resInesperado = await criarClienteAction({}, form)
      expect(resInesperado.erro).toBe(
        'Não foi possível completar a operação agora. Tente novamente em instantes.',
      )
      expect(logErrorMock).toHaveBeenCalledWith(
        { err: erroInesperado },
        'Erro inesperado ao criar cliente.',
      )
    })
  })

  describe('fluxo de sucesso', () => {
    test('criarClienteAction com sucesso chama redirect("/clientes/<id>")', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      const novoId = randomUUID()
      criarClienteMock.mockResolvedValueOnce({ id: novoId })

      const form = new FormData()
      form.append('nome', 'Novo Cliente')
      form.append('observacoes', 'Observação teste')

      await expect(criarClienteAction({}, form)).rejects.toThrow(
        `NEXT_REDIRECT:/clientes/${novoId}`,
      )
      expect(redirectMock).toHaveBeenCalledWith(`/clientes/${novoId}`)
      expect(criarClienteMock).toHaveBeenCalledWith(sujeitoMock, {
        nome: 'Novo Cliente',
        observacoes: 'Observação teste',
      })
    })

    test('editarClienteAction com sucesso revalida caminhos e devolve sucesso', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      const clienteId = randomUUID()
      editarClienteMock.mockResolvedValueOnce(undefined)

      const form = new FormData()
      form.append('clienteId', clienteId)
      form.append('nome', 'Nome Atualizado')

      const res = await editarClienteAction({}, form)
      expect(res).toEqual({ sucesso: 'Cliente atualizado.' })
      expect(revalidatePathMock).toHaveBeenCalledWith('/clientes')
      expect(revalidatePathMock).toHaveBeenCalledWith(`/clientes/${clienteId}`, 'layout')
    })

    test('alternarArquivamentoAction com true arquiva e com false reativa', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      const clienteId = randomUUID()

      // Arquivar
      arquivarClienteMock.mockResolvedValueOnce(undefined)
      const formArq = new FormData()
      formArq.append('clienteId', clienteId)
      formArq.append('arquivar', 'true')

      const resArq = await alternarArquivamentoAction({}, formArq)
      expect(resArq).toEqual({ sucesso: 'Cliente arquivado.' })
      expect(arquivarClienteMock).toHaveBeenCalledWith(sujeitoMock, clienteId)
      expect(revalidatePathMock).toHaveBeenCalledWith('/clientes')
      expect(revalidatePathMock).toHaveBeenCalledWith(`/clientes/${clienteId}`, 'layout')

      // Reativar
      desarquivarClienteMock.mockResolvedValueOnce(undefined)
      const formReativar = new FormData()
      formReativar.append('clienteId', clienteId)
      formReativar.append('arquivar', 'false')

      const resReativar = await alternarArquivamentoAction({}, formReativar)
      expect(resReativar).toEqual({ sucesso: 'Cliente reativado.' })
      expect(desarquivarClienteMock).toHaveBeenCalledWith(sujeitoMock, clienteId)
    })
  })
})
