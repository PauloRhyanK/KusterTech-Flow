import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import type { SessaoAtual } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'

const { redirectMock, revalidatePathMock, logErrorMock, obterSessaoMock, aprovarMock } = vi.hoisted(
  () => ({
    redirectMock: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`)
    }),
    revalidatePathMock: vi.fn(),
    logErrorMock: vi.fn(),
    obterSessaoMock: vi.fn<() => Promise<SessaoAtual | null>>(),
    aprovarMock: vi.fn(),
  }),
)

vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('@/lib/log', () => ({ log: { error: logErrorMock } }))
vi.mock('@/lib/auth/sessao', () => ({ obterSessao: obterSessaoMock }))
vi.mock('@/modules/homologacao/service', () => ({ aprovarMilestone: aprovarMock }))

import { aprovarMilestoneAction } from './acoes-de-aprovacao'

const sujeito: Sujeito = { usuarioId: randomUUID(), papeis: [{ papel: 'ADMIN', clienteId: null }] }
const sessao: SessaoAtual = {
  sessaoId: 'ses-1',
  usuario: { id: sujeito.usuarioId, nome: 'Admin', email: 'a@kustertech.com.br', tema: 'sistema' },
  sujeito,
}

function formulario(extra: Record<string, string> = {}): FormData {
  const campos: Record<string, string> = {
    clienteId: randomUUID(),
    projetoId: randomUUID(),
    milestoneId: randomUUID(),
    versoesEsperadas: 'v1,v2',
    ...extra,
  }
  const form = new FormData()
  for (const [k, v] of Object.entries(campos)) form.set(k, v)
  return form
}

describe('aprovarMilestoneAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    obterSessaoMock.mockResolvedValue(sessao)
    aprovarMock.mockResolvedValue({ clienteNome: 'Acme' })
  })

  test('sessão nula redireciona para /entrar sem chamar o service', async () => {
    obterSessaoMock.mockResolvedValue(null)
    await expect(aprovarMilestoneAction({}, formulario())).rejects.toThrow('NEXT_REDIRECT:/entrar')
    expect(aprovarMock).not.toHaveBeenCalled()
  })

  test('sucesso só depois do service: mensagem com o cliente e revalidação', async () => {
    const form = formulario()
    const resultado = await aprovarMilestoneAction({}, form)
    expect(resultado).toEqual({ sucesso: 'Milestone aprovada para Acme.' })
    expect(aprovarMock).toHaveBeenCalledWith(sujeito, {
      clienteId: form.get('clienteId'),
      milestoneId: form.get('milestoneId'),
      versoesEsperadas: 'v1,v2',
    })
    expect(revalidatePathMock).toHaveBeenCalledTimes(2)
  })

  test('dados inválidos não chegam ao service', async () => {
    expect(await aprovarMilestoneAction({}, formulario({ clienteId: 'x' }))).toEqual({
      erro: 'Dados inválidos.',
    })
    expect(aprovarMock).not.toHaveBeenCalled()
  })

  test('ErroDeAutorizacao → mensagem fixa; ErroDeDominio → a própria mensagem', async () => {
    aprovarMock.mockRejectedValueOnce(new ErroDeAutorizacao('homologacao.aprovar'))
    expect(await aprovarMilestoneAction({}, formulario())).toEqual({
      erro: 'Sem permissão para aprovar esta milestone.',
    })
    aprovarMock.mockRejectedValueOnce(new ErroDeDominio('1 correção bloqueadora em aberto.'))
    expect(await aprovarMilestoneAction({}, formulario())).toEqual({
      erro: '1 correção bloqueadora em aberto.',
    })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  test('erro inesperado → mensagem genérica, log só com o resumo', async () => {
    aprovarMock.mockRejectedValueOnce(new Error('senha=segredo'))
    const resultado = await aprovarMilestoneAction({}, formulario())
    expect(resultado.erro).toBe(
      'Não foi possível completar a operação agora. Tente novamente em instantes.',
    )
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain('segredo')
  })
})
