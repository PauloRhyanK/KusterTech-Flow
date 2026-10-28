import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { obterSituacaoDoWebhook } from '@/modules/github/queries'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

let admin: Sujeito
let testadorEscopado: Sujeito
let aprovadorEscopado: Sujeito

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-webhook@local.test',
    nome: 'Admin Webhook',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }

  const cliente = await db.cliente.create({
    data: { nome: 'Cliente W', nomeNormalizado: 'cliente w' },
  })
  const testador = await criarUsuario({
    email: 'testador-webhook@local.test',
    nome: 'Testador Webhook',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'TESTADOR', clienteId: cliente.id }],
  })
  testadorEscopado = {
    usuarioId: testador.id,
    papeis: [{ papel: 'TESTADOR', clienteId: cliente.id }],
  }
  const aprovador = await criarUsuario({
    email: 'aprovador-webhook@local.test',
    nome: 'Aprovador Webhook',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'APROVADOR', clienteId: cliente.id }],
  })
  aprovadorEscopado = {
    usuarioId: aprovador.id,
    papeis: [{ papel: 'APROVADOR', clienteId: cliente.id }],
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('obterSituacaoDoWebhook', () => {
  test('com segredo e três eventos (15:00, 15:05, 15:10; o de 15:05 com tentativas 5 e processadoEm null) → { ativo: true, ultimoEventoEm: 15:10, eventosNaoProcessados: 1 }; sem segredo → ativo false', async () => {
    const dia = (hm: string) => new Date(`2026-10-26T${hm}:00Z`)
    await db.eventoIntegracao.createMany({
      data: [
        {
          deliveryId: 'd-1500',
          evento: 'issues',
          recebidoEm: dia('15:00'),
          processadoEm: dia('15:01'),
        },
        { deliveryId: 'd-1505', evento: 'issues', recebidoEm: dia('15:05'), tentativas: 5 },
        { deliveryId: 'd-1510', evento: 'pull_request', recebidoEm: dia('15:10') },
      ],
    })

    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'segredo-de-teste')
    expect(await obterSituacaoDoWebhook(admin)).toEqual({
      ativo: true,
      ultimoEventoEm: dia('15:10'),
      eventosNaoProcessados: 1,
    })

    vi.stubEnv('GITHUB_WEBHOOK_SECRET', '   ')
    expect((await obterSituacaoDoWebhook(admin)).ativo).toBe(false)
  })

  test('TESTADOR escopado e APROVADOR escopado → ErroDeAutorizacao, lançado antes de qualquer método de db.eventoIntegracao (vi.spyOn em aggregate, findFirst e count: zero chamadas)', async () => {
    const aggregate = vi.spyOn(db.eventoIntegracao, 'aggregate')
    const findFirst = vi.spyOn(db.eventoIntegracao, 'findFirst')
    const count = vi.spyOn(db.eventoIntegracao, 'count')

    await expect(obterSituacaoDoWebhook(testadorEscopado)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await expect(obterSituacaoDoWebhook(aprovadorEscopado)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )

    expect(aggregate).not.toHaveBeenCalled()
    expect(findFirst).not.toHaveBeenCalled()
    expect(count).not.toHaveBeenCalled()
  })
})
