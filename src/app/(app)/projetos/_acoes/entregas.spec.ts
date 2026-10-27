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
  criarMilestoneMock,
  editarMilestoneMock,
  arquivarMilestoneMock,
  reativarMilestoneMock,
  associarClienteAMilestoneMock,
  removerClienteDaMilestoneMock,
  adicionarIssuesAMilestoneMock,
  removerIssueDaMilestoneMock,
} = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  revalidatePathMock: vi.fn(),
  logErrorMock: vi.fn(),
  obterSessaoMock: vi.fn<() => Promise<SessaoAtual | null>>(),
  criarMilestoneMock: vi.fn(),
  editarMilestoneMock: vi.fn(),
  arquivarMilestoneMock: vi.fn(),
  reativarMilestoneMock: vi.fn(),
  associarClienteAMilestoneMock: vi.fn(),
  removerClienteDaMilestoneMock: vi.fn(),
  adicionarIssuesAMilestoneMock: vi.fn(),
  removerIssueDaMilestoneMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('@/lib/log', () => ({ log: { error: logErrorMock } }))
vi.mock('@/lib/auth/sessao', () => ({ obterSessao: obterSessaoMock }))
vi.mock('@/modules/entregas/service', () => ({
  criarMilestone: criarMilestoneMock,
  editarMilestone: editarMilestoneMock,
  arquivarMilestone: arquivarMilestoneMock,
  reativarMilestone: reativarMilestoneMock,
  associarClienteAMilestone: associarClienteAMilestoneMock,
  removerClienteDaMilestone: removerClienteDaMilestoneMock,
  adicionarIssuesAMilestone: adicionarIssuesAMilestoneMock,
  removerIssueDaMilestone: removerIssueDaMilestoneMock,
}))

import {
  adicionarIssuesAMilestoneAction,
  alternarArquivamentoDaMilestoneAction,
  associarClienteAMilestoneAction,
  criarMilestoneAction,
  editarMilestoneAction,
  removerClienteDaMilestoneAction,
  removerIssueDaMilestoneAction,
} from './entregas'

function formulario(campos: Record<string, string | string[]>): FormData {
  const form = new FormData()
  for (const [chave, valor] of Object.entries(campos)) {
    for (const item of Array.isArray(valor) ? valor : [valor]) {
      form.append(chave, item)
    }
  }
  return form
}

describe('actions de entregas (unitário)', () => {
  const adminId = randomUUID()
  const sujeito: Sujeito = { usuarioId: adminId, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  const sessao: SessaoAtual = {
    sessaoId: 'ses-1',
    usuario: {
      id: adminId,
      nome: 'Administrador',
      email: 'admin@kustertech.com.br',
      tema: 'sistema',
    },
    sujeito,
  }
  const projetoId = randomUUID()
  const milestoneId = randomUUID()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('sem sessão redireciona sem chamar o service (todas as actions)', async () => {
    obterSessaoMock.mockResolvedValue(null)
    const base = { projetoId, milestoneId }

    await expect(
      criarMilestoneAction({}, formulario({ projetoId, titulo: 'Entrega 1' })),
    ).rejects.toThrow('NEXT_REDIRECT:/entrar')
    await expect(
      editarMilestoneAction({}, formulario({ ...base, titulo: 'Entrega 1' })),
    ).rejects.toThrow('NEXT_REDIRECT:/entrar')
    await expect(
      alternarArquivamentoDaMilestoneAction({}, formulario({ ...base, arquivar: 'true' })),
    ).rejects.toThrow('NEXT_REDIRECT:/entrar')
    await expect(
      associarClienteAMilestoneAction({}, formulario({ ...base, clienteId: randomUUID() })),
    ).rejects.toThrow('NEXT_REDIRECT:/entrar')
    await expect(
      removerClienteDaMilestoneAction({}, formulario({ ...base, clienteId: randomUUID() })),
    ).rejects.toThrow('NEXT_REDIRECT:/entrar')
    await expect(
      adicionarIssuesAMilestoneAction({}, formulario({ ...base, issueIds: [randomUUID()] })),
    ).rejects.toThrow('NEXT_REDIRECT:/entrar')
    await expect(
      removerIssueDaMilestoneAction({}, formulario({ ...base, issueId: randomUUID() })),
    ).rejects.toThrow('NEXT_REDIRECT:/entrar')

    for (const mock of [
      criarMilestoneMock,
      editarMilestoneMock,
      arquivarMilestoneMock,
      reativarMilestoneMock,
      associarClienteAMilestoneMock,
      removerClienteDaMilestoneMock,
      adicionarIssuesAMilestoneMock,
      removerIssueDaMilestoneMock,
    ]) {
      expect(mock).not.toHaveBeenCalled()
    }
  })

  test('ErroDeAutorizacao → "Sem permissão para gerenciar projetos."; erro interno → mensagem genérica e log sem a mensagem original', async () => {
    obterSessaoMock.mockResolvedValue(sessao)
    const form = () => formulario({ projetoId, milestoneId, issueId: randomUUID() })

    removerIssueDaMilestoneMock.mockRejectedValueOnce(new ErroDeAutorizacao('projetos.gerenciar'))
    await expect(removerIssueDaMilestoneAction({}, form())).resolves.toEqual({
      erro: 'Sem permissão para gerenciar projetos.',
    })

    removerIssueDaMilestoneMock.mockRejectedValueOnce(
      new ErroDeDominio('Milestone não encontrada.'),
    )
    await expect(removerIssueDaMilestoneAction({}, form())).resolves.toEqual({
      erro: 'Milestone não encontrada.',
    })

    removerIssueDaMilestoneMock.mockRejectedValueOnce(new Error('senha=segredo-do-banco'))
    await expect(removerIssueDaMilestoneAction({}, form())).resolves.toEqual({
      erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.',
    })
    expect(logErrorMock).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain('segredo-do-banco')
  })

  test('adicionarIssuesAMilestoneAction com 2 adicionadas → "2 issues adicionadas."', async () => {
    obterSessaoMock.mockResolvedValue(sessao)
    const ids = [randomUUID(), randomUUID()]

    adicionarIssuesAMilestoneMock.mockResolvedValueOnce({ adicionadas: 2 })
    await expect(
      adicionarIssuesAMilestoneAction({}, formulario({ projetoId, milestoneId, issueIds: ids })),
    ).resolves.toEqual({ sucesso: '2 issues adicionadas.' })
    expect(adicionarIssuesAMilestoneMock).toHaveBeenCalledWith(sujeito, milestoneId, ids)

    adicionarIssuesAMilestoneMock.mockResolvedValueOnce({ adicionadas: 1 })
    await expect(
      adicionarIssuesAMilestoneAction(
        {},
        formulario({ projetoId, milestoneId, issueIds: [ids[0] as string] }),
      ),
    ).resolves.toEqual({ sucesso: '1 issue adicionada.' })

    adicionarIssuesAMilestoneMock.mockResolvedValueOnce({ adicionadas: 0 })
    await expect(
      adicionarIssuesAMilestoneAction({}, formulario({ projetoId, milestoneId, issueIds: ids })),
    ).resolves.toEqual({
      sucesso: 'Nenhuma issue nova; as selecionadas já estavam na milestone.',
    })
  })

  test('criarMilestoneAction redireciona para a milestone criada e repassa prazo e clientes', async () => {
    obterSessaoMock.mockResolvedValue(sessao)
    const clienteId = randomUUID()
    criarMilestoneMock.mockResolvedValueOnce({ id: milestoneId })

    await expect(
      criarMilestoneAction(
        {},
        formulario({
          projetoId,
          titulo: 'Entrega 1',
          descricao: '',
          prazo: '2026-11-30',
          clientesIds: [clienteId],
        }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT:/projetos/${projetoId}/entregas/milestones/${milestoneId}`)

    expect(criarMilestoneMock).toHaveBeenCalledWith(sujeito, projetoId, {
      titulo: 'Entrega 1',
      descricao: null,
      prazo: new Date('2026-11-30T00:00:00.000Z'),
      clientesIds: [clienteId],
    })
  })

  test('mensagens de sucesso e revalidação do layout do projeto e dos clientes', async () => {
    obterSessaoMock.mockResolvedValue(sessao)
    const clienteId = randomUUID()

    await expect(
      editarMilestoneAction({}, formulario({ projetoId, milestoneId, titulo: 'Entrega 1' })),
    ).resolves.toEqual({ sucesso: 'Milestone atualizada.' })
    await expect(
      associarClienteAMilestoneAction({}, formulario({ projetoId, milestoneId, clienteId })),
    ).resolves.toEqual({ sucesso: 'Cliente associado à milestone.' })
    await expect(
      removerClienteDaMilestoneAction({}, formulario({ projetoId, milestoneId, clienteId })),
    ).resolves.toEqual({ sucesso: 'Cliente removido da milestone.' })
    await expect(
      removerIssueDaMilestoneAction(
        {},
        formulario({ projetoId, milestoneId, issueId: randomUUID() }),
      ),
    ).resolves.toEqual({ sucesso: 'Issue removida da milestone.' })

    await alternarArquivamentoDaMilestoneAction(
      {},
      formulario({ projetoId, milestoneId, arquivar: 'true' }),
    )
    await alternarArquivamentoDaMilestoneAction(
      {},
      formulario({ projetoId, milestoneId, arquivar: 'false' }),
    )
    expect(arquivarMilestoneMock).toHaveBeenCalledWith(sujeito, milestoneId)
    expect(reativarMilestoneMock).toHaveBeenCalledWith(sujeito, milestoneId)

    expect(revalidatePathMock).toHaveBeenCalledWith(`/projetos/${projetoId}`, 'layout')
    expect(revalidatePathMock).toHaveBeenCalledWith('/clientes', 'layout')
  })

  test('formulário inválido não chama o service', async () => {
    obterSessaoMock.mockResolvedValue(sessao)
    const resultado = await removerIssueDaMilestoneAction(
      {},
      formulario({ projetoId: 'nao-e-uuid', milestoneId, issueId: randomUUID() }),
    )
    expect(resultado.erro).toBeTruthy()
    expect(removerIssueDaMilestoneMock).not.toHaveBeenCalled()
  })
})
