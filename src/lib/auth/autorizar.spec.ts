import { describe, expect, test } from 'vitest'
import {
  ACOES_COM_CLIENTE_OBRIGATORIO,
  autorizar,
  ErroDeAutorizacao,
  exigirPermissao,
  PERMISSOES,
  TODAS_AS_ACOES,
  type Acao,
  type Escopo,
  type Papel,
  type PapelAtribuido,
  type Sujeito,
} from './autorizar'

const admin: Sujeito = {
  usuarioId: 'u1',
  papeis: [{ papel: 'ADMIN', clienteId: null }],
}
const aprovadorAcme: Sujeito = {
  usuarioId: 'u2',
  papeis: [{ papel: 'APROVADOR', clienteId: 'acme' }],
}
const testadorGlobal: Sujeito = {
  usuarioId: 'u3',
  papeis: [{ papel: 'TESTADOR', clienteId: null }],
}

describe('autorizar', () => {
  test('admin passa em toda ação, com e sem escopo', () => {
    for (const acao of TODAS_AS_ACOES) {
      expect(autorizar(admin, acao)).toBe(true)
      expect(autorizar(admin, acao, { clienteId: 'acme' })).toBe(true)
    }
  })

  test('aprovador aprova só no cliente do seu papel', () => {
    expect(autorizar(aprovadorAcme, 'homologacao.aprovar', { clienteId: 'acme' })).toBe(true)
    expect(autorizar(aprovadorAcme, 'homologacao.aprovar', { clienteId: 'beta' })).toBe(false)
  })

  test('ação de homologação sem cliente explícito é negada a não-admin (D63)', () => {
    expect(autorizar(aprovadorAcme, 'homologacao.aprovar')).toBe(false)
    expect(autorizar(testadorGlobal, 'homologacao.comentar')).toBe(false)
    for (const acao of ACOES_COM_CLIENTE_OBRIGATORIO) {
      expect(autorizar(aprovadorAcme, acao)).toBe(false)
      expect(autorizar(aprovadorAcme, acao, {})).toBe(false)
    }
  })

  test('papel com clienteId null vale para qualquer cliente', () => {
    expect(autorizar(testadorGlobal, 'homologacao.comentar', { clienteId: 'qualquer' })).toBe(true)
  })

  test('escopo de cliente vale para qualquer ação', () => {
    expect(autorizar(aprovadorAcme, 'clientes.ler', { clienteId: 'beta' })).toBe(false)
    expect(autorizar(aprovadorAcme, 'clientes.ler')).toBe(true)
  })

  test('testador não aprova; só admin autoriza PROD (D31)', () => {
    expect(autorizar(testadorGlobal, 'homologacao.aprovar', { clienteId: 'acme' })).toBe(false)
    expect(autorizar(aprovadorAcme, 'publicacao.autorizar', { clienteId: 'acme' })).toBe(false)
    expect(PERMISSOES.ADMIN).toEqual(TODAS_AS_ACOES)
  })

  test('exigirPermissao lança ErroDeAutorizacao quando negado', () => {
    expect(() => exigirPermissao(testadorGlobal, 'usuarios.gerenciar')).toThrow(ErroDeAutorizacao)
  })

  test('exigirPermissao não lança quando autorizado', () => {
    const papelExtra: Papel = 'APROVADOR'
    const atribuicao: PapelAtribuido = { papel: papelExtra, clienteId: 'acme' }
    const escopo: Escopo = { clienteId: 'acme' }
    const acao: Acao = 'homologacao.aprovar'
    expect(() =>
      exigirPermissao({ usuarioId: 'u4', papeis: [atribuicao] }, acao, escopo),
    ).not.toThrow()
    expect(() => exigirPermissao(admin, 'usuarios.gerenciar')).not.toThrow()
  })

  test('sujeito com múltiplos papéis exige ação e cliente no mesmo papel', () => {
    const multiPapel: Sujeito = {
      usuarioId: 'u5',
      papeis: [
        { papel: 'TESTADOR', clienteId: null },
        { papel: 'APROVADOR', clienteId: 'acme' },
      ],
    }

    expect(autorizar(multiPapel, 'homologacao.aprovar', { clienteId: 'beta' })).toBe(false)
    expect(autorizar(multiPapel, 'homologacao.aprovar', { clienteId: 'acme' })).toBe(true)
    expect(autorizar(multiPapel, 'homologacao.comentar', { clienteId: 'beta' })).toBe(true)
    expect(autorizar(multiPapel, 'publicacao.autorizar', { clienteId: 'acme' })).toBe(false)
  })

  test('admin com clienteId não nulo autoriza qualquer ação com ou sem escopo', () => {
    const adminRestrito: Sujeito = {
      usuarioId: 'u6',
      papeis: [{ papel: 'ADMIN', clienteId: 'acme' }],
    }

    expect(autorizar(adminRestrito, 'homologacao.aprovar', { clienteId: 'beta' })).toBe(true)
    expect(autorizar(adminRestrito, 'usuarios.gerenciar')).toBe(true)
  })
})
