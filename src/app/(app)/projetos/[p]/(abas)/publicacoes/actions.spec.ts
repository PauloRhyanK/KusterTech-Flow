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
  autorizarMock,
  reconhecerMock,
  verificarMock,
} = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  revalidatePathMock: vi.fn(),
  logErrorMock: vi.fn(),
  obterSessaoMock: vi.fn<() => Promise<SessaoAtual | null>>(),
  autorizarMock: vi.fn(),
  reconhecerMock: vi.fn(),
  verificarMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('@/lib/log', () => ({ log: { error: logErrorMock } }))
vi.mock('@/lib/auth/sessao', () => ({ obterSessao: obterSessaoMock }))
vi.mock('@/modules/publicacao/service', () => ({
  autorizarPublicacao: autorizarMock,
  reconhecerDivergencia: reconhecerMock,
  registrarVerificacaoProd: verificarMock,
}))

import {
  autorizarPublicacaoAction,
  reconhecerDivergenciaAction,
  registrarVerificacaoAction,
} from './actions'

const sujeito: Sujeito = { usuarioId: randomUUID(), papeis: [{ papel: 'ADMIN', clienteId: null }] }
const sessao: SessaoAtual = {
  sessaoId: 'ses-1',
  usuario: { id: sujeito.usuarioId, nome: 'Admin', email: 'a@kustertech.com.br', tema: 'sistema' },
  sujeito,
}

const projetoId = randomUUID()
const issueId = randomUUID()

function formulario(extra: Record<string, string> = {}, verificadas: string[] = []): FormData {
  const campos: Record<string, string> = {
    projetoId,
    repositorioId: randomUUID(),
    versaoAlvoId: randomUUID(),
    composicaoId: randomUUID(),
    hashComposicao: 'a'.repeat(64),
    contextoConferido: 'on',
    ...extra,
  }
  const form = new FormData()
  for (const [k, v] of Object.entries(campos)) form.set(k, v)
  for (const v of verificadas) form.append('verificadas', v)
  return form
}

describe('autorizarPublicacaoAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    obterSessaoMock.mockResolvedValue(sessao)
    autorizarMock.mockResolvedValue({ autorizacaoId: randomUUID() })
  })

  test('sessão nula redireciona para /entrar sem chamar o service', async () => {
    obterSessaoMock.mockResolvedValue(null)

    await expect(autorizarPublicacaoAction({}, formulario())).rejects.toThrow(
      'NEXT_REDIRECT:/entrar',
    )
    expect(autorizarMock).not.toHaveBeenCalled()
  })

  test('sucesso: delega ao service com as caixas lidas, revalida Publicações e avisa que não dispara o deploy', async () => {
    const form = formulario(
      { desconhecidosConferidos: 'on', justificativa: '  Primeira publicação conferida  ' },
      [issueId],
    )

    const estado = await autorizarPublicacaoAction({}, form)

    expect(estado).toEqual({
      sucesso: 'Publicação autorizada. A autorização não dispara o deploy.',
    })
    expect(autorizarMock).toHaveBeenCalledWith(
      sujeito,
      expect.objectContaining({
        projetoId,
        contextoConferido: true,
        desconhecidosConferidos: true,
        verificadasPorHumano: [issueId],
        justificativa: 'Primeira publicação conferida',
      }),
    )
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projetos/${projetoId}/publicacoes`)
  })

  test('caixas desmarcadas viram false e justificativa vazia vira null', async () => {
    const form = formulario()
    form.delete('contextoConferido')

    await autorizarPublicacaoAction({}, form)

    expect(autorizarMock).toHaveBeenCalledWith(
      sujeito,
      expect.objectContaining({
        contextoConferido: false,
        desconhecidosConferidos: false,
        verificadasPorHumano: [],
        justificativa: null,
      }),
    )
  })

  test('ids inválidos: "Dados inválidos." sem chamar o service', async () => {
    const estado = await autorizarPublicacaoAction({}, formulario({ composicaoId: 'x' }))

    expect(estado).toEqual({ erro: 'Dados inválidos.' })
    expect(autorizarMock).not.toHaveBeenCalled()
  })

  test('ErroDeAutorizacao → mensagem fixa de sem permissão', async () => {
    autorizarMock.mockRejectedValue(new ErroDeAutorizacao('publicacao.autorizar'))

    const estado = await autorizarPublicacaoAction({}, formulario())

    expect(estado).toEqual({ erro: 'Somente administradores autorizam publicação em PROD.' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  test('ErroDeDominio → a própria mensagem', async () => {
    autorizarMock.mockRejectedValue(new ErroDeDominio('Esta versão já está autorizada.'))

    expect(await autorizarPublicacaoAction({}, formulario())).toEqual({
      erro: 'Esta versão já está autorizada.',
    })
  })

  test('erro inesperado → mensagem genérica e log sem a mensagem do erro', async () => {
    autorizarMock.mockRejectedValue(new Error('segredo-na-mensagem'))

    const estado = await autorizarPublicacaoAction({}, formulario())

    expect(estado).toEqual({
      erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.',
    })
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain('segredo-na-mensagem')
  })
})

describe('reconhecerDivergenciaAction', () => {
  const divergenciaId = randomUUID()

  function form(extra: Record<string, string> = {}): FormData {
    const f = new FormData()
    for (const [k, v] of Object.entries({ projetoId, divergenciaId, ...extra })) f.set(k, v)
    return f
  }

  beforeEach(() => {
    vi.clearAllMocks()
    obterSessaoMock.mockResolvedValue(sessao)
    reconhecerMock.mockResolvedValue(undefined)
  })

  test('sessão nula redireciona para /entrar sem chamar o service', async () => {
    obterSessaoMock.mockResolvedValue(null)

    await expect(reconhecerDivergenciaAction({}, form())).rejects.toThrow('NEXT_REDIRECT:/entrar')
    expect(reconhecerMock).not.toHaveBeenCalled()
  })

  test('sucesso: delega ao service e revalida Publicações', async () => {
    expect(await reconhecerDivergenciaAction({}, form())).toEqual({
      sucesso: 'Divergência reconhecida.',
    })
    expect(reconhecerMock).toHaveBeenCalledWith(sujeito, { projetoId, divergenciaId })
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projetos/${projetoId}/publicacoes`)
  })

  test('id inválido: "Dados inválidos."; sem permissão e já reconhecida: mensagens fixas', async () => {
    expect(await reconhecerDivergenciaAction({}, form({ divergenciaId: 'x' }))).toEqual({
      erro: 'Dados inválidos.',
    })
    expect(reconhecerMock).not.toHaveBeenCalled()

    reconhecerMock.mockRejectedValueOnce(new ErroDeAutorizacao('publicacao.autorizar'))
    expect(await reconhecerDivergenciaAction({}, form())).toEqual({
      erro: 'Somente administradores autorizam publicação em PROD.',
    })
    reconhecerMock.mockRejectedValueOnce(new ErroDeDominio('Esta divergência já foi reconhecida.'))
    expect(await reconhecerDivergenciaAction({}, form())).toEqual({
      erro: 'Esta divergência já foi reconhecida.',
    })
  })

  test('erro inesperado → mensagem genérica e log sem a mensagem do erro', async () => {
    reconhecerMock.mockRejectedValue(new Error('segredo-na-mensagem'))

    const estado = await reconhecerDivergenciaAction({}, form())

    expect(estado.erro).toBe(
      'Não foi possível completar a operação agora. Tente novamente em instantes.',
    )
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain('segredo-na-mensagem')
  })
})

describe('registrarVerificacaoAction', () => {
  const versaoId = randomUUID()

  function form(extra: Record<string, string> = {}): FormData {
    const f = new FormData()
    const campos = { projetoId, versaoId, observacao: '  Login conferido em produção.  ', ...extra }
    for (const [k, v] of Object.entries(campos)) f.set(k, v)
    return f
  }

  beforeEach(() => {
    vi.clearAllMocks()
    obterSessaoMock.mockResolvedValue(sessao)
    verificarMock.mockResolvedValue(undefined)
  })

  test('sessão nula redireciona para /entrar sem chamar o service', async () => {
    obterSessaoMock.mockResolvedValue(null)

    await expect(registrarVerificacaoAction({}, form())).rejects.toThrow('NEXT_REDIRECT:/entrar')
    expect(verificarMock).not.toHaveBeenCalled()
  })

  test('sucesso: delega ao service, revalida e confirma', async () => {
    expect(await registrarVerificacaoAction({}, form())).toEqual({
      sucesso: 'Verificação registrada.',
    })
    expect(verificarMock).toHaveBeenCalledWith(sujeito, {
      projetoId,
      versaoId,
      observacao: '  Login conferido em produção.  ',
    })
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projetos/${projetoId}/publicacoes`)
  })

  test('ids inválidos, sem permissão e erro de domínio', async () => {
    expect(await registrarVerificacaoAction({}, form({ versaoId: 'x' }))).toEqual({
      erro: 'Dados inválidos.',
    })
    verificarMock.mockRejectedValueOnce(new ErroDeAutorizacao('publicacao.autorizar'))
    expect(await registrarVerificacaoAction({}, form())).toEqual({
      erro: 'Somente administradores autorizam publicação em PROD.',
    })
    verificarMock.mockRejectedValueOnce(
      new ErroDeDominio('Registre primeiro a evidência de deploy desta versão em PROD.'),
    )
    expect(await registrarVerificacaoAction({}, form())).toEqual({
      erro: 'Registre primeiro a evidência de deploy desta versão em PROD.',
    })
  })
})
