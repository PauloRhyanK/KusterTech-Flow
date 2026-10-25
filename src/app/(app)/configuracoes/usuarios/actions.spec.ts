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
  criarUsuarioComoAdminMock,
  alterarAtivoMock,
} = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  revalidatePathMock: vi.fn(),
  logErrorMock: vi.fn(),
  obterSessaoMock: vi.fn<() => Promise<SessaoAtual | null>>(),
  criarUsuarioComoAdminMock: vi.fn(),
  alterarAtivoMock: vi.fn(),
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
  criarUsuarioComoAdmin: criarUsuarioComoAdminMock,
  alterarAtivo: alterarAtivoMock,
  emailValido: (email: string) => {
    const limpo = email.trim().toLowerCase()
    return limpo.length > 0 && limpo.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(limpo)
  },
}))

import { alterarAtivoAction, criarUsuarioAction } from './actions'

describe('actions de gestão de usuários (unitário)', () => {
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

  describe('autorização e autenticação básica', () => {
    test('sem sessão, as duas actions redirecionam para /entrar sem chamar o service', async () => {
      obterSessaoMock.mockResolvedValue(null)

      const formCriar = new FormData()
      formCriar.append('email', 'teste@kustertech.com.br')
      formCriar.append('nome', 'Teste')
      formCriar.append('senha', 'senha-longa-123')
      formCriar.append('papel', 'TESTADOR')

      await expect(criarUsuarioAction({}, formCriar)).rejects.toThrow('NEXT_REDIRECT:/entrar')
      expect(redirectMock).toHaveBeenCalledWith('/entrar')
      expect(criarUsuarioComoAdminMock).not.toHaveBeenCalled()

      const formAtivo = new FormData()
      formAtivo.append('usuarioId', randomUUID())
      formAtivo.append('ativo', 'false')

      await expect(alterarAtivoAction({}, formAtivo)).rejects.toThrow('NEXT_REDIRECT:/entrar')
      expect(redirectMock).toHaveBeenCalledWith('/entrar')
      expect(alterarAtivoMock).not.toHaveBeenCalled()
    })

    test('ErroDeAutorizacao vira estado { erro: "Sem permissão para gerenciar usuários." }', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      criarUsuarioComoAdminMock.mockRejectedValueOnce(new ErroDeAutorizacao('usuarios.gerenciar'))
      alterarAtivoMock.mockRejectedValueOnce(new ErroDeAutorizacao('usuarios.gerenciar'))

      const formCriar = new FormData()
      formCriar.append('email', 'novo@kustertech.com.br')
      formCriar.append('nome', 'Novo')
      formCriar.append('senha', 'senha-longa-123')
      formCriar.append('papel', 'APROVADOR')

      const resCriar = await criarUsuarioAction({}, formCriar)
      expect(resCriar).toEqual({ erro: 'Sem permissão para gerenciar usuários.' })

      const formAtivo = new FormData()
      formAtivo.append('usuarioId', randomUUID())
      formAtivo.append('ativo', 'false')

      const resAtivo = await alterarAtivoAction({}, formAtivo)
      expect(resAtivo).toEqual({ erro: 'Sem permissão para gerenciar usuários.' })
    })
  })

  describe('criarUsuarioAction', () => {
    test('form vazio devolve Dados inválidos.', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      const res = await criarUsuarioAction({}, new FormData())
      expect(res).toEqual({ erro: 'Dados inválidos.' })
      expect(criarUsuarioComoAdminMock).not.toHaveBeenCalled()
    })

    test('validação Zod rejeita e-mail inválido, nome vazio, senha curta ou papel inválido', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)

      const formInvalido = new FormData()
      formInvalido.append('email', 'email-invalido')
      formInvalido.append('nome', '')
      formInvalido.append('senha', 'curta')
      formInvalido.append('papel', 'PAPEL_INVENTADO')

      const res = await criarUsuarioAction({}, formInvalido)
      expect(res.erro).toBeDefined()
      expect(criarUsuarioComoAdminMock).not.toHaveBeenCalled()
    })

    test('sucesso cria usuário, revalida /configuracoes/usuarios e retorna sucesso', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      criarUsuarioComoAdminMock.mockResolvedValueOnce({ id: 'u-novo' })

      const form = new FormData()
      form.append('email', 'novo@kustertech.com.br')
      form.append('nome', 'Novo Usuário')
      form.append('senha', 'senha-super-segura-123')
      form.append('papel', 'TESTADOR')

      const res = await criarUsuarioAction({}, form)

      expect(res).toEqual({ sucesso: 'Usuário criado.' })
      expect(criarUsuarioComoAdminMock).toHaveBeenCalledWith(sujeitoMock, {
        email: 'novo@kustertech.com.br',
        nome: 'Novo Usuário',
        senha: 'senha-super-segura-123',
        papel: 'TESTADOR',
      })
      expect(revalidatePathMock).toHaveBeenCalledWith('/configuracoes/usuarios')
    })

    test('erro de domínio é repassado ao estado de erro sem log', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      criarUsuarioComoAdminMock.mockRejectedValueOnce(
        new ErroDeDominio('Já existe um usuário com este e-mail.'),
      )

      const form = new FormData()
      form.append('email', 'existente@kustertech.com.br')
      form.append('nome', 'Existente')
      form.append('senha', 'senha-super-segura-123')
      form.append('papel', 'ADMIN')

      const res = await criarUsuarioAction({}, form)
      expect(res).toEqual({ erro: 'Já existe um usuário com este e-mail.' })
      expect(logErrorMock).not.toHaveBeenCalled()
    })

    test('erro inesperado mascara detalhe interno e registra log', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      criarUsuarioComoAdminMock.mockRejectedValueOnce(new Error('detalhe interno'))

      const form = new FormData()
      form.append('email', 'novo@kustertech.com.br')
      form.append('nome', 'Novo')
      form.append('senha', 'senha-super-segura-123')
      form.append('papel', 'ADMIN')

      const res = await criarUsuarioAction({}, form)
      expect(res).toEqual({
        erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.',
      })
      expect(res.erro).not.toContain('detalhe interno')
      expect(logErrorMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('alterarAtivoAction', () => {
    test('form vazio devolve Dados inválidos.', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      const res = await alterarAtivoAction({}, new FormData())
      expect(res).toEqual({ erro: 'Dados inválidos.' })
      expect(alterarAtivoMock).not.toHaveBeenCalled()
    })

    test('sem ativo ou com ativo diferente de true/false devolve Dados inválidos.', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)

      const formSemAtivo = new FormData()
      formSemAtivo.append('usuarioId', randomUUID())
      const resSemAtivo = await alterarAtivoAction({}, formSemAtivo)
      expect(resSemAtivo).toEqual({ erro: 'Dados inválidos.' })

      const formAtivoInvalido = new FormData()
      formAtivoInvalido.append('usuarioId', randomUUID())
      formAtivoInvalido.append('ativo', 'yes')
      const resAtivoInvalido = await alterarAtivoAction({}, formAtivoInvalido)
      expect(resAtivoInvalido).toEqual({ erro: 'Dados inválidos.' })

      expect(alterarAtivoMock).not.toHaveBeenCalled()
    })

    test('validação Zod rejeita usuarioId não uuid', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)

      const form = new FormData()
      form.append('usuarioId', 'nao-e-uuid')
      form.append('ativo', 'false')

      const res = await alterarAtivoAction({}, form)
      expect(res.erro).toBeDefined()
      expect(alterarAtivoMock).not.toHaveBeenCalled()
    })

    test('sucesso altera ativo, revalida /configuracoes/usuarios e retorna sucesso', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      alterarAtivoMock.mockResolvedValueOnce(undefined)

      const alvoId = randomUUID()
      const form = new FormData()
      form.append('usuarioId', alvoId)
      form.append('ativo', 'false')

      const res = await alterarAtivoAction({}, form)

      expect(res).toEqual({ sucesso: 'Estado atualizado.' })
      expect(alterarAtivoMock).toHaveBeenCalledWith(sujeitoMock, alvoId, false)
      expect(revalidatePathMock).toHaveBeenCalledWith('/configuracoes/usuarios')
    })

    test('erro de domínio ao desativar a si mesmo é repassado ao estado sem log', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      alterarAtivoMock.mockRejectedValueOnce(
        new ErroDeDominio('Você não pode desativar a própria conta.'),
      )

      const form = new FormData()
      form.append('usuarioId', adminId)
      form.append('ativo', 'false')

      const res = await alterarAtivoAction({}, form)
      expect(res).toEqual({ erro: 'Você não pode desativar a própria conta.' })
      expect(logErrorMock).not.toHaveBeenCalled()
    })

    test('service rejeitando com ErroDeDominio Usuario nao encontrado repassa sem log', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      alterarAtivoMock.mockRejectedValueOnce(new ErroDeDominio('Usuário não encontrado.'))

      const form = new FormData()
      form.append('usuarioId', randomUUID())
      form.append('ativo', 'false')

      const res = await alterarAtivoAction({}, form)
      expect(res).toEqual({ erro: 'Usuário não encontrado.' })
      expect(logErrorMock).not.toHaveBeenCalled()
    })

    test('erro inesperado ao alterar ativo mascara detalhe interno e registra log', async () => {
      obterSessaoMock.mockResolvedValue(sessaoMock)
      alterarAtivoMock.mockRejectedValueOnce(new Error('falha de conexao banco'))

      const form = new FormData()
      form.append('usuarioId', randomUUID())
      form.append('ativo', 'false')

      const res = await alterarAtivoAction({}, form)
      expect(res).toEqual({
        erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.',
      })
      expect(res.erro).not.toContain('falha de conexao')
      expect(logErrorMock).toHaveBeenCalledTimes(1)
    })
  })
})
