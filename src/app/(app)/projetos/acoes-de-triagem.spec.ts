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
  triarMock,
  reclassMock,
  confirmarMock,
} = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  revalidatePathMock: vi.fn(),
  logErrorMock: vi.fn(),
  obterSessaoMock: vi.fn<() => Promise<SessaoAtual | null>>(),
  triarMock: vi.fn(),
  reclassMock: vi.fn(),
  confirmarMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('@/lib/log', () => ({ log: { error: logErrorMock } }))
vi.mock('@/lib/auth/sessao', () => ({ obterSessao: obterSessaoMock }))
vi.mock('@/modules/homologacao/service', () => ({
  triarSolicitacao: triarMock,
  reclassificarSolicitacao: reclassMock,
  confirmarReteste: confirmarMock,
}))

import {
  confirmarRetesteAction,
  reclassificarSolicitacaoAction,
  triarSolicitacaoAction,
} from './acoes-de-triagem'

const sujeito: Sujeito = { usuarioId: randomUUID(), papeis: [{ papel: 'ADMIN', clienteId: null }] }
const sessao: SessaoAtual = {
  sessaoId: 'ses-1',
  usuario: { id: sujeito.usuarioId, nome: 'Admin', email: 'a@kustertech.com.br', tema: 'sistema' },
  sujeito,
}

function formulario(extra: Record<string, string> = {}): FormData {
  const campos: Record<string, string> = {
    tipo: 'reabrir',
    clienteId: randomUUID(),
    solicitacaoId: randomUUID(),
    projetoId: randomUUID(),
    issueId: randomUUID(),
    milestoneId: randomUUID(),
    ...extra,
  }
  const form = new FormData()
  for (const [k, v] of Object.entries(campos)) form.set(k, v)
  return form
}

describe('triarSolicitacaoAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    obterSessaoMock.mockResolvedValue(sessao)
    triarMock.mockResolvedValue({ tarefaId: randomUUID() })
  })

  test('sessão nula redireciona para /entrar', async () => {
    obterSessaoMock.mockResolvedValue(null)
    await expect(triarSolicitacaoAction({}, formulario())).rejects.toThrow('NEXT_REDIRECT:/entrar')
    expect(triarMock).not.toHaveBeenCalled()
  })

  test('as três decisões chegam ao service com a mensagem de sucesso própria', async () => {
    const reabrir = await triarSolicitacaoAction({}, formulario())
    expect(reabrir).toEqual({
      sucesso: 'Triagem registrada. O worker faz a reabertura em até 30 s.',
    })
    expect(triarMock).toHaveBeenLastCalledWith(
      sujeito,
      expect.objectContaining({ decisao: { tipo: 'reabrir' } }),
    )

    const criar = await triarSolicitacaoAction(
      {},
      formulario({
        tipo: 'criar_correcao',
        titulo: 'Correção: Item',
        corpo: 'Descrição',
        foraDoEscopo: 'on',
        justificativa: 'Fora do combinado inicial',
      }),
    )
    expect(criar).toEqual({
      sucesso: 'Triagem registrada. O worker cria a issue de correção em até 30 s.',
    })
    expect(triarMock).toHaveBeenLastCalledWith(
      sujeito,
      expect.objectContaining({
        decisao: {
          tipo: 'criar_correcao',
          titulo: 'Correção: Item',
          corpo: 'Descrição',
          foraDoEscopo: true,
          justificativa: 'Fora do combinado inicial',
        },
      }),
    )

    triarMock.mockResolvedValue({ tarefaId: null })
    const responder = await triarSolicitacaoAction(
      {},
      formulario({ tipo: 'responder', resposta: 'Está correto.', visibilidade: 'COMPARTILHAVEL' }),
    )
    expect(responder).toEqual({ sucesso: 'Resposta registrada.' })
    expect(revalidatePathMock).toHaveBeenCalled()
  })

  test('fora do escopo sem justificativa → "Explique o motivo em pelo menos 10 caracteres." sem chamar o service', async () => {
    const estado = await triarSolicitacaoAction(
      {},
      formulario({ tipo: 'criar_correcao', titulo: 'T', corpo: '', foraDoEscopo: 'on' }),
    )
    expect(estado).toEqual({ erro: 'Explique o motivo em pelo menos 10 caracteres.' })
    expect(triarMock).not.toHaveBeenCalled()
  })

  test('título vazio, corpo longo e resposta vazia usam as mensagens do plano', async () => {
    expect(
      await triarSolicitacaoAction({}, formulario({ tipo: 'criar_correcao', titulo: '  ' })),
    ).toEqual({ erro: 'Informe um título de até 200 caracteres.' })
    expect(
      await triarSolicitacaoAction(
        {},
        formulario({ tipo: 'criar_correcao', titulo: 'T', corpo: 'x'.repeat(5001) }),
      ),
    ).toEqual({ erro: 'A descrição pode ter até 5.000 caracteres.' })
    expect(
      await triarSolicitacaoAction(
        {},
        formulario({ tipo: 'responder', resposta: '', visibilidade: 'INTERNA' }),
      ),
    ).toEqual({ erro: 'Escreva a resposta (até 2.000 caracteres).' })
    expect(triarMock).not.toHaveBeenCalled()
  })

  test('tipo desconhecido e ids inválidos → "Dados inválidos."', async () => {
    expect(await triarSolicitacaoAction({}, formulario({ tipo: 'apagar' }))).toEqual({
      erro: 'Dados inválidos.',
    })
    expect(await triarSolicitacaoAction({}, formulario({ solicitacaoId: 'x' }))).toEqual({
      erro: 'Dados inválidos.',
    })
    expect(triarMock).not.toHaveBeenCalled()
  })

  test('ErroDeAutorizacao → mensagem fixa; ErroDeDominio → a própria mensagem; inesperado → genérica e sem detalhe no log', async () => {
    triarMock.mockRejectedValueOnce(new ErroDeAutorizacao('homologacao.triar'))
    expect(await triarSolicitacaoAction({}, formulario())).toEqual({
      erro: 'Sem permissão para fazer a triagem de correções.',
    })
    triarMock.mockRejectedValueOnce(new ErroDeDominio('Esta solicitação já foi triada.'))
    expect(await triarSolicitacaoAction({}, formulario())).toEqual({
      erro: 'Esta solicitação já foi triada.',
    })
    triarMock.mockRejectedValueOnce(new Error('senha=segredo-do-banco'))
    expect(await triarSolicitacaoAction({}, formulario())).toEqual({
      erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.',
    })
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain('segredo-do-banco')
  })
})

describe('reclassificarSolicitacaoAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    obterSessaoMock.mockResolvedValue(sessao)
    reclassMock.mockResolvedValue(undefined)
  })

  test('sessão nula redireciona; sucesso e erros mapeados', async () => {
    obterSessaoMock.mockResolvedValue(null)
    await expect(
      reclassificarSolicitacaoAction({}, formulario({ justificativa: 'Motivo suficiente' })),
    ).rejects.toThrow('NEXT_REDIRECT:/entrar')

    obterSessaoMock.mockResolvedValue(sessao)
    expect(
      await reclassificarSolicitacaoAction({}, formulario({ justificativa: 'Motivo suficiente' })),
    ).toEqual({ sucesso: 'Correção classificada como fora do escopo.' })
    expect(
      await reclassificarSolicitacaoAction({}, formulario({ justificativa: 'curto' })),
    ).toEqual({ erro: 'Explique o motivo em pelo menos 10 caracteres.' })
    reclassMock.mockRejectedValueOnce(new ErroDeAutorizacao('homologacao.triar'))
    expect(
      await reclassificarSolicitacaoAction({}, formulario({ justificativa: 'Motivo suficiente' })),
    ).toEqual({ erro: 'Sem permissão para fazer a triagem de correções.' })
  })
})

describe('confirmarRetesteAction', () => {
  const entrada = {
    itemId: randomUUID(),
    versaoId: randomUUID(),
    justificativa: 'Conferi a correção em QA.',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    obterSessaoMock.mockResolvedValue(sessao)
    confirmarMock.mockResolvedValue(undefined)
  })

  test('sessão nula redireciona para /entrar sem chamar o service', async () => {
    obterSessaoMock.mockResolvedValue(null)
    await expect(confirmarRetesteAction({}, formulario(entrada))).rejects.toThrow(
      'NEXT_REDIRECT:/entrar',
    )
    expect(confirmarMock).not.toHaveBeenCalled()
  })

  test('sucesso chama o service com os ids e a justificativa aparada, e revalida', async () => {
    const form = formulario({ ...entrada, justificativa: `  ${entrada.justificativa}  ` })
    const estado = await confirmarRetesteAction({}, form)

    expect(estado).toEqual({ sucesso: 'Reteste confirmado manualmente.' })
    expect(confirmarMock).toHaveBeenCalledWith(sujeito, {
      clienteId: form.get('clienteId'),
      itemId: entrada.itemId,
      versaoId: entrada.versaoId,
      justificativa: entrada.justificativa,
    })
    expect(revalidatePathMock).toHaveBeenCalled()
  })

  test('justificativa curta e ids inválidos → mensagem do plano sem chamar o service', async () => {
    expect(
      await confirmarRetesteAction({}, formulario({ ...entrada, justificativa: 'curta' })),
    ).toEqual({
      erro: 'Explique o motivo em pelo menos 10 caracteres.',
    })
    expect(await confirmarRetesteAction({}, formulario({ ...entrada, itemId: 'x' }))).toEqual({
      erro: 'Dados inválidos.',
    })
    expect(confirmarMock).not.toHaveBeenCalled()
  })

  test('ErroDeAutorizacao → mensagem fixa; ErroDeDominio → a própria mensagem; inesperado → genérica e sem detalhe no log', async () => {
    confirmarMock.mockRejectedValueOnce(new ErroDeAutorizacao('homologacao.triar'))
    expect(await confirmarRetesteAction({}, formulario(entrada))).toEqual({
      erro: 'Sem permissão para fazer a triagem de correções.',
    })
    confirmarMock.mockRejectedValueOnce(
      new ErroDeDominio('Faça a triagem da correção antes de confirmar o reteste.'),
    )
    expect(await confirmarRetesteAction({}, formulario(entrada))).toEqual({
      erro: 'Faça a triagem da correção antes de confirmar o reteste.',
    })
    confirmarMock.mockRejectedValueOnce(new Error('senha=segredo-do-banco'))
    expect(await confirmarRetesteAction({}, formulario(entrada))).toEqual({
      erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.',
    })
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain('segredo-do-banco')
  })
})
