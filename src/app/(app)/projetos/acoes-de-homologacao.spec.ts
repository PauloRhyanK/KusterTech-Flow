import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import type { SessaoAtual } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'

const { redirectMock, revalidatePathMock, logErrorMock, obterSessaoMock, registrarMock } =
  vi.hoisted(() => ({
    redirectMock: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`)
    }),
    revalidatePathMock: vi.fn(),
    logErrorMock: vi.fn(),
    obterSessaoMock: vi.fn<() => Promise<SessaoAtual | null>>(),
    registrarMock: vi.fn(),
  }))

vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('@/lib/log', () => ({ log: { error: logErrorMock } }))
vi.mock('@/lib/auth/sessao', () => ({ obterSessao: obterSessaoMock }))
vi.mock('@/modules/homologacao/service', () => ({
  registrarAcaoDeHomologacao: registrarMock,
}))

import { registrarAcaoDeHomologacaoAction } from './acoes-de-homologacao'

const sujeito: Sujeito = { usuarioId: randomUUID(), papeis: [{ papel: 'ADMIN', clienteId: null }] }
const sessao: SessaoAtual = {
  sessaoId: 'ses-1',
  usuario: { id: sujeito.usuarioId, nome: 'Admin', email: 'a@kustertech.com.br', tema: 'sistema' },
  sujeito,
}

function formulario(extra: Record<string, string> = {}): FormData {
  const campos: Record<string, string> = {
    acao: 'APROVAR',
    itemId: randomUUID(),
    clienteId: randomUUID(),
    milestoneId: randomUUID(),
    issueId: randomUUID(),
    versaoId: randomUUID(),
    ultimoEventoId: randomUUID(),
    texto: '',
    visibilidade: 'INTERNA',
    projetoId: randomUUID(),
    ...extra,
  }
  const form = new FormData()
  for (const [k, v] of Object.entries(campos)) form.set(k, v)
  return form
}

describe('registrarAcaoDeHomologacaoAction (unitário)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    obterSessaoMock.mockResolvedValue(sessao)
  })

  test('sessão nula redireciona para /entrar', async () => {
    obterSessaoMock.mockResolvedValue(null)

    await expect(registrarAcaoDeHomologacaoAction({}, formulario())).rejects.toThrow(
      'NEXT_REDIRECT:/entrar',
    )
    expect(registrarMock).not.toHaveBeenCalled()
  })

  test('ErroDeAutorizacao vira "Sem permissão para esta ação de homologação."', async () => {
    registrarMock.mockRejectedValue(new ErroDeAutorizacao('homologacao.aprovar'))

    const estado = await registrarAcaoDeHomologacaoAction({}, formulario())

    expect(estado).toEqual({ erro: 'Sem permissão para esta ação de homologação.' })
  })

  test('erro inesperado devolve a mensagem genérica e não repete o texto do erro', async () => {
    registrarMock.mockRejectedValue(new Error('senha=segredo-do-banco'))

    const estado = await registrarAcaoDeHomologacaoAction({}, formulario())

    expect(estado).toEqual({
      erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.',
    })
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain('segredo-do-banco')
  })

  test('acao "PUBLICAR" → "Dados inválidos." sem chamar o service', async () => {
    const estado = await registrarAcaoDeHomologacaoAction({}, formulario({ acao: 'PUBLICAR' }))

    expect(estado).toEqual({ erro: 'Dados inválidos.' })
    expect(registrarMock).not.toHaveBeenCalled()
  })

  test('ErroDeDominio devolve a própria mensagem', async () => {
    registrarMock.mockRejectedValue(new ErroDeDominio('Homologação não encontrada.'))

    expect(await registrarAcaoDeHomologacaoAction({}, formulario())).toEqual({
      erro: 'Homologação não encontrada.',
    })
  })

  test('sucesso: mensagem por ação, campos vazios viram null e revalida cliente e projeto', async () => {
    registrarMock.mockResolvedValue({
      eventoId: 'e1',
      novoEstado: 'APROVADA',
      clienteNome: 'Cliente A',
    })
    const form = formulario({ versaoId: '', ultimoEventoId: '' })

    const estado = await registrarAcaoDeHomologacaoAction({}, form)

    expect(estado).toEqual({ sucesso: 'Aprovação registrada para Cliente A.' })
    expect(registrarMock).toHaveBeenCalledWith(
      sujeito,
      expect.objectContaining({ acao: 'APROVAR', versaoId: null, ultimoEventoId: null }),
    )
    expect(revalidatePathMock).toHaveBeenCalledWith(`/clientes/${form.get('clienteId')}`, 'layout')
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projetos/${form.get('projetoId')}`, 'layout')
  })
})
