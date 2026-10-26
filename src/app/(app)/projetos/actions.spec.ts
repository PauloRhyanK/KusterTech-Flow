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
  criarProjetoMock,
  editarProjetoMock,
  arquivarProjetoMock,
  desarquivarProjetoMock,
  associarClienteMock,
  desassociarClienteMock,
  vincularRepositorioMock,
  desvincularRepositorioMock,
  solicitarSincronizacaoMock,
} = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  revalidatePathMock: vi.fn(),
  logErrorMock: vi.fn(),
  obterSessaoMock: vi.fn<() => Promise<SessaoAtual | null>>(),
  criarProjetoMock: vi.fn(),
  editarProjetoMock: vi.fn(),
  arquivarProjetoMock: vi.fn(),
  desarquivarProjetoMock: vi.fn(),
  associarClienteMock: vi.fn(),
  desassociarClienteMock: vi.fn(),
  vincularRepositorioMock: vi.fn(),
  desvincularRepositorioMock: vi.fn(),
  solicitarSincronizacaoMock: vi.fn(),
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

vi.mock('@/modules/projetos/service', () => ({
  criarProjeto: criarProjetoMock,
  editarProjeto: editarProjetoMock,
  arquivarProjeto: arquivarProjetoMock,
  desarquivarProjeto: desarquivarProjetoMock,
  associarCliente: associarClienteMock,
  desassociarCliente: desassociarClienteMock,
}))

vi.mock('@/modules/github/service', () => ({
  vincularRepositorio: vincularRepositorioMock,
  desvincularRepositorio: desvincularRepositorioMock,
  solicitarSincronizacao: solicitarSincronizacaoMock,
}))

import {
  alternarArquivamentoDoProjetoAction,
  associarClienteAction,
  criarProjetoAction,
  desassociarClienteAction,
  desvincularRepositorioAction,
  editarProjetoAction,
  solicitarSincronizacaoAction,
  vincularRepositorioAction,
} from './actions'

describe('actions de projetos (unitário)', () => {
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
    test('sem sessão redireciona sem chamar o service (as cinco actions)', async () => {
      obterSessaoMock.mockResolvedValue(null)

      const formCriar = new FormData()
      formCriar.append('nome', 'Projeto Teste')
      await expect(criarProjetoAction({}, formCriar)).rejects.toThrow('NEXT_REDIRECT:/entrar')
      expect(criarProjetoMock).not.toHaveBeenCalled()

      const formEditar = new FormData()
      formEditar.append('projetoId', randomUUID())
      formEditar.append('nome', 'Projeto Teste')
      await expect(editarProjetoAction({}, formEditar)).rejects.toThrow('NEXT_REDIRECT:/entrar')
      expect(editarProjetoMock).not.toHaveBeenCalled()

      const formAssociar = new FormData()
      formAssociar.append('projetoId', randomUUID())
      formAssociar.append('clienteId', randomUUID())
      await expect(associarClienteAction({}, formAssociar)).rejects.toThrow('NEXT_REDIRECT:/entrar')
      expect(associarClienteMock).not.toHaveBeenCalled()

      const formDesassociar = new FormData()
      formDesassociar.append('projetoId', randomUUID())
      formDesassociar.append('clienteId', randomUUID())
      await expect(desassociarClienteAction({}, formDesassociar)).rejects.toThrow(
        'NEXT_REDIRECT:/entrar',
      )
      expect(desassociarClienteMock).not.toHaveBeenCalled()

      const formAlternar = new FormData()
      formAlternar.append('projetoId', randomUUID())
      formAlternar.append('arquivar', 'true')
      await expect(alternarArquivamentoDoProjetoAction({}, formAlternar)).rejects.toThrow(
        'NEXT_REDIRECT:/entrar',
      )
      expect(arquivarProjetoMock).not.toHaveBeenCalled()
      expect(desarquivarProjetoMock).not.toHaveBeenCalled()
    })
  })

  describe('criarProjetoAction', () => {
    test('criarProjetoAction passa clientesIds (getAll) ao service e redireciona para /projetos/<id>/configuracao', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      const novoId = randomUUID()
      criarProjetoMock.mockResolvedValue({ id: novoId })

      const c1 = randomUUID()
      const c2 = randomUUID()

      const form = new FormData()
      form.append('nome', 'Portal do Cliente')
      form.append('descricao', 'Descrição detalhada do projeto')
      form.append('clientesIds', c1)
      form.append('clientesIds', c2)

      await expect(criarProjetoAction({}, form)).rejects.toThrow(
        `NEXT_REDIRECT:/projetos/${novoId}/configuracao`,
      )

      expect(criarProjetoMock).toHaveBeenCalledWith(sujeitoMock, {
        nome: 'Portal do Cliente',
        descricao: 'Descrição detalhada do projeto',
        clientesIds: [c1, c2],
      })
    })

    test('clientesIds com valor não uuid → "Dados inválidos." sem chamar o service', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)

      const form = new FormData()
      form.append('nome', 'Projeto Válido')
      form.append('clientesIds', 'nao-uuid-invalido')

      const res = await criarProjetoAction({}, form)
      expect(res.erro).toBe('Dados inválidos.')
      expect(criarProjetoMock).not.toHaveBeenCalled()
    })

    test('validação de nome obrigatório e descrição máxima', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)

      const formNomeVazio = new FormData()
      formNomeVazio.append('nome', '   ')

      const resNomeVazio = await criarProjetoAction({}, formNomeVazio)
      expect(resNomeVazio.erro).toBe('O nome é obrigatório.')
      expect(criarProjetoMock).not.toHaveBeenCalled()

      const formDescLonga = new FormData()
      formDescLonga.append('nome', 'Projeto Válido')
      formDescLonga.append('descricao', 'd'.repeat(2001))

      const resDescLonga = await criarProjetoAction({}, formDescLonga)
      expect(resDescLonga.erro).toBe('A descrição não pode ter mais de 2000 caracteres.')
      expect(criarProjetoMock).not.toHaveBeenCalled()
    })
  })

  describe('editarProjetoAction', () => {
    test('edita com sucesso e revalida caminhos enumerados', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      const projetoId = randomUUID()

      const form = new FormData()
      form.append('projetoId', projetoId)
      form.append('nome', 'Nome Atualizado')
      form.append('descricao', 'Nova descrição')

      const res = await editarProjetoAction({}, form)
      expect(res).toEqual({ sucesso: 'Projeto atualizado.' })
      expect(editarProjetoMock).toHaveBeenCalledWith(sujeitoMock, projetoId, {
        nome: 'Nome Atualizado',
        descricao: 'Nova descrição',
      })
      expect(revalidatePathMock).toHaveBeenCalledWith('/projetos')
      expect(revalidatePathMock).toHaveBeenCalledWith(`/projetos/${projetoId}`, 'layout')
      expect(revalidatePathMock).toHaveBeenCalledWith('/clientes', 'layout')
    })
  })

  describe('associarClienteAction e desassociarClienteAction', () => {
    test('associa com sucesso e revalida caminhos enumerados', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      const projetoId = randomUUID()
      const clienteId = randomUUID()

      const form = new FormData()
      form.append('projetoId', projetoId)
      form.append('clienteId', clienteId)

      const res = await associarClienteAction({}, form)
      expect(res).toEqual({ sucesso: 'Cliente associado.' })
      expect(associarClienteMock).toHaveBeenCalledWith(sujeitoMock, projetoId, clienteId)
      expect(revalidatePathMock).toHaveBeenCalledWith('/projetos')
      expect(revalidatePathMock).toHaveBeenCalledWith(`/projetos/${projetoId}`, 'layout')
      expect(revalidatePathMock).toHaveBeenCalledWith('/clientes', 'layout')
    })

    test('desassocia com sucesso e revalida caminhos enumerados', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      const projetoId = randomUUID()
      const clienteId = randomUUID()

      const form = new FormData()
      form.append('projetoId', projetoId)
      form.append('clienteId', clienteId)

      const res = await desassociarClienteAction({}, form)
      expect(res).toEqual({ sucesso: 'Cliente removido do projeto.' })
      expect(desassociarClienteMock).toHaveBeenCalledWith(sujeitoMock, projetoId, clienteId)
      expect(revalidatePathMock).toHaveBeenCalledWith('/projetos')
      expect(revalidatePathMock).toHaveBeenCalledWith(`/projetos/${projetoId}`, 'layout')
      expect(revalidatePathMock).toHaveBeenCalledWith('/clientes', 'layout')
    })
  })

  describe('alternarArquivamentoDoProjetoAction', () => {
    test('arquiva projeto com sucesso e revalida caminhos', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      const projetoId = randomUUID()

      const form = new FormData()
      form.append('projetoId', projetoId)
      form.append('arquivar', 'true')

      const res = await alternarArquivamentoDoProjetoAction({}, form)
      expect(res).toEqual({ sucesso: 'Projeto arquivado.' })
      expect(arquivarProjetoMock).toHaveBeenCalledWith(sujeitoMock, projetoId)
      expect(revalidatePathMock).toHaveBeenCalledWith('/projetos')
      expect(revalidatePathMock).toHaveBeenCalledWith(`/projetos/${projetoId}`, 'layout')
      expect(revalidatePathMock).toHaveBeenCalledWith('/clientes', 'layout')
    })

    test('reativa projeto com sucesso e revalida caminhos', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      const projetoId = randomUUID()

      const form = new FormData()
      form.append('projetoId', projetoId)
      form.append('arquivar', 'false')

      const res = await alternarArquivamentoDoProjetoAction({}, form)
      expect(res).toEqual({ sucesso: 'Projeto reativado.' })
      expect(desarquivarProjetoMock).toHaveBeenCalledWith(sujeitoMock, projetoId)
      expect(revalidatePathMock).toHaveBeenCalledWith('/projetos')
      expect(revalidatePathMock).toHaveBeenCalledWith(`/projetos/${projetoId}`, 'layout')
      expect(revalidatePathMock).toHaveBeenCalledWith('/clientes', 'layout')
    })
  })

  describe('tratamento de erros', () => {
    test('ErroDeDominio "Cliente já associado a este projeto." chega ao estado; erro interno → genérica + log', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      const projetoId = randomUUID()
      const clienteId = randomUUID()

      associarClienteMock.mockRejectedValue(
        new ErroDeDominio('Cliente já associado a este projeto.'),
      )

      const form = new FormData()
      form.append('projetoId', projetoId)
      form.append('clienteId', clienteId)

      const resDominio = await associarClienteAction({}, form)
      expect(resDominio.erro).toBe('Cliente já associado a este projeto.')

      // Erro inesperado
      associarClienteMock.mockRejectedValue(new Error('Falha no banco'))
      const resInesperado = await associarClienteAction({}, form)
      expect(resInesperado.erro).toBe(
        'Não foi possível completar a operação agora. Tente novamente em instantes.',
      )
      expect(logErrorMock).toHaveBeenCalledTimes(1)
    })

    test('ErroDeAutorizacao vira "Sem permissão para gerenciar projetos."', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      const projetoId = randomUUID()
      const clienteId = randomUUID()

      associarClienteMock.mockRejectedValue(new ErroDeAutorizacao('projetos.gerenciar'))

      const form = new FormData()
      form.append('projetoId', projetoId)
      form.append('clienteId', clienteId)

      const res = await associarClienteAction({}, form)
      expect(res.erro).toBe('Sem permissão para gerenciar projetos.')
    })
  })

  describe('repositórios do GitHub', () => {
    const projetoId = randomUUID()
    const repositorioId = randomUUID()

    function formDoVinculo(): FormData {
      const form = new FormData()
      form.append('projetoId', projetoId)
      form.append('repositorioId', repositorioId)
      return form
    }

    test('sem sessão redireciona sem chamar o service (vincular, desvincular, sincronizar)', async () => {
      obterSessaoMock.mockResolvedValue(null)

      await expect(vincularRepositorioAction({}, formDoVinculo())).rejects.toThrow(
        'NEXT_REDIRECT:/entrar',
      )
      await expect(desvincularRepositorioAction({}, formDoVinculo())).rejects.toThrow(
        'NEXT_REDIRECT:/entrar',
      )
      await expect(solicitarSincronizacaoAction({}, formDoVinculo())).rejects.toThrow(
        'NEXT_REDIRECT:/entrar',
      )
      expect(vincularRepositorioMock).not.toHaveBeenCalled()
      expect(desvincularRepositorioMock).not.toHaveBeenCalled()
      expect(solicitarSincronizacaoMock).not.toHaveBeenCalled()
    })

    test('ids inválidos não chegam ao service', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      const form = new FormData()
      form.append('projetoId', 'nao-e-uuid')
      form.append('repositorioId', repositorioId)

      const resultado = await vincularRepositorioAction({}, form)
      expect(resultado.erro).toBe('Identificador de projeto inválido.')
      expect(vincularRepositorioMock).not.toHaveBeenCalled()
    })

    test('sucesso chama o service com o sujeito da sessão e revalida a configuração e o Resumo', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      vincularRepositorioMock.mockResolvedValue(undefined)
      desvincularRepositorioMock.mockResolvedValue(undefined)
      solicitarSincronizacaoMock.mockResolvedValue(undefined)

      expect((await vincularRepositorioAction({}, formDoVinculo())).sucesso).toBeDefined()
      expect(vincularRepositorioMock).toHaveBeenCalledWith(sujeitoMock, projetoId, repositorioId)

      expect((await desvincularRepositorioAction({}, formDoVinculo())).sucesso).toBe(
        'Repositório desvinculado.',
      )
      expect(desvincularRepositorioMock).toHaveBeenCalledWith(sujeitoMock, projetoId, repositorioId)

      const formSync = new FormData()
      formSync.append('projetoId', projetoId)
      expect((await solicitarSincronizacaoAction({}, formSync)).sucesso).toBe(
        'Sincronização solicitada; o worker atende em até 30 s.',
      )
      expect(solicitarSincronizacaoMock).toHaveBeenCalledWith(sujeitoMock, projetoId)

      expect(revalidatePathMock).toHaveBeenCalledWith(`/projetos/${projetoId}/configuracao`)
      expect(revalidatePathMock).toHaveBeenCalledWith(`/projetos/${projetoId}`)
    })

    test('ErroDeAutorizacao, ErroDeDominio e erro inesperado viram mensagens sem vazar detalhes', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)

      vincularRepositorioMock.mockRejectedValue(new ErroDeAutorizacao('projetos.gerenciar'))
      expect((await vincularRepositorioAction({}, formDoVinculo())).erro).toBe(
        'Sem permissão para gerenciar projetos.',
      )

      vincularRepositorioMock.mockRejectedValue(
        new ErroDeDominio('Este repositório já está vinculado a outro projeto.'),
      )
      expect((await vincularRepositorioAction({}, formDoVinculo())).erro).toBe(
        'Este repositório já está vinculado a outro projeto.',
      )

      desvincularRepositorioMock.mockRejectedValue(new Error('segredo do banco'))
      const resultado = await desvincularRepositorioAction({}, formDoVinculo())
      expect(resultado.erro).toBe(
        'Não foi possível completar a operação agora. Tente novamente em instantes.',
      )
      expect(logErrorMock).toHaveBeenCalled()
    })
  })
})
