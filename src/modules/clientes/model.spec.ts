import { describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { ErroDeDominio } from '@/lib/erros'
import { clientesVisiveis, normalizarNome, podeVerVisaoGlobal, validarNomeDeCliente } from './model'

describe('clientes / model (unitário)', () => {
  test('normalizarNome: " Acmé  Ltda " → "acme ltda"; "ACME" e "acme" iguais; "São João" → "sao joao"', () => {
    expect(normalizarNome(' Acmé  Ltda ')).toBe('acme ltda')
    expect(normalizarNome('ACME')).toBe('acme')
    expect(normalizarNome('acme')).toBe('acme')
    expect(normalizarNome('ACME')).toBe(normalizarNome('acme'))
    expect(normalizarNome('São João')).toBe('sao joao')
    expect(normalizarNome('  ÁÉÍÓÚ  ãõñ  çÇ  ')).toBe('aeiou aon cc')
  })

  test('validarNomeDeCliente: vazio e só espaços lançam ErroDeDominio; 121 caracteres lança; devolve aparado', () => {
    expect(() => validarNomeDeCliente('')).toThrow(ErroDeDominio)
    expect(() => validarNomeDeCliente('')).toThrow('O nome é obrigatório.')

    expect(() => validarNomeDeCliente('   ')).toThrow(ErroDeDominio)
    expect(() => validarNomeDeCliente('   ')).toThrow('O nome é obrigatório.')

    const nome120 = 'a'.repeat(120)
    expect(validarNomeDeCliente(nome120)).toBe(nome120)

    const nome121 = 'a'.repeat(121)
    expect(() => validarNomeDeCliente(nome121)).toThrow(ErroDeDominio)
    expect(() => validarNomeDeCliente(nome121)).toThrow(
      'O nome não pode ter mais de 120 caracteres.',
    )

    const nomeComEspacos = '  Cliente Exemplo  '
    expect(validarNomeDeCliente(nomeComEspacos)).toBe('Cliente Exemplo')

    // 120 caracteres com espaços ao redor que ao aparar fica 120
    const nome120ComEspacos = `  ${'b'.repeat(120)}  `
    expect(validarNomeDeCliente(nome120ComEspacos)).toBe('b'.repeat(120))

    // 121 caracteres aparados lançam erro
    const nome121ComEspacos = `  ${'c'.repeat(121)}  `
    expect(() => validarNomeDeCliente(nome121ComEspacos)).toThrow(
      'O nome não pode ter mais de 120 caracteres.',
    )
  })

  test('clientesVisiveis: ADMIN → todos; APROVADOR global → todos; TESTADOR de A e B → [A, B] sem repetição; podeVerVisaoGlobal só para todos', () => {
    const admin: Sujeito = {
      usuarioId: 'u-admin',
      papeis: [{ papel: 'ADMIN', clienteId: null }],
    }
    expect(clientesVisiveis(admin)).toBe('todos')
    expect(podeVerVisaoGlobal(admin)).toBe(true)

    // Admin com clienteId teorico continua 'todos'
    const adminComCliente: Sujeito = {
      usuarioId: 'u-admin-2',
      papeis: [{ papel: 'ADMIN', clienteId: 'c-1' }],
    }
    expect(clientesVisiveis(adminComCliente)).toBe('todos')
    expect(podeVerVisaoGlobal(adminComCliente)).toBe(true)

    // Aprovador global (clienteId === null)
    const aprovadorGlobal: Sujeito = {
      usuarioId: 'u-aprov-1',
      papeis: [{ papel: 'APROVADOR', clienteId: null }],
    }
    expect(clientesVisiveis(aprovadorGlobal)).toBe('todos')
    expect(podeVerVisaoGlobal(aprovadorGlobal)).toBe(true)

    // Testador escopado em A e B
    const testadorEscopado: Sujeito = {
      usuarioId: 'u-test-1',
      papeis: [
        { papel: 'TESTADOR', clienteId: 'c-a' },
        { papel: 'TESTADOR', clienteId: 'c-b' },
        { papel: 'APROVADOR', clienteId: 'c-a' }, // Repetido
      ],
    }
    expect(clientesVisiveis(testadorEscopado)).toEqual(['c-a', 'c-b'])
    expect(podeVerVisaoGlobal(testadorEscopado)).toBe(false)

    // Usuário sem papéis
    const semPapeis: Sujeito = {
      usuarioId: 'u-vazio',
      papeis: [],
    }
    expect(clientesVisiveis(semPapeis)).toEqual([])
    expect(podeVerVisaoGlobal(semPapeis)).toBe(false)

    // Usuário com um papel escopado e outro global
    const misto: Sujeito = {
      usuarioId: 'u-misto',
      papeis: [
        { papel: 'TESTADOR', clienteId: 'c-a' },
        { papel: 'APROVADOR', clienteId: null },
      ],
    }
    expect(clientesVisiveis(misto)).toBe('todos')
    expect(podeVerVisaoGlobal(misto)).toBe(true)
  })
})
