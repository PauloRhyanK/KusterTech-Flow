import { describe, expect, test } from 'vitest'
import { ErroDeDominio } from '@/lib/erros'
import {
  rotuloDoTipo,
  situacaoDoRecurso,
  validarCustoMensal,
  validarHospedagem,
  validarNomeDeRecurso,
  validarTextoOpcional,
} from './model'

describe('validações de recurso', () => {
  test('validarNomeDeRecurso apara, recusa vazio e acima de 120', () => {
    expect(validarNomeDeRecurso('  vps-01 ')).toBe('vps-01')
    expect(() => validarNomeDeRecurso('   ')).toThrow('O nome é obrigatório.')
    expect(() => validarNomeDeRecurso('a'.repeat(121))).toThrow(
      'O nome não pode ter mais de 120 caracteres.',
    )
    expect(validarNomeDeRecurso('a'.repeat(120))).toHaveLength(120)
    expect(() => validarNomeDeRecurso('')).toThrow(ErroDeDominio)
  })

  test('validarHospedagem: CONTAINER em SERVIDOR ok; CONTAINER em CONTAINER, SERVIDOR em SERVIDOR e servidor arquivado recusados com as mensagens exatas', () => {
    expect(() =>
      validarHospedagem('CONTAINER', { tipo: 'SERVIDOR', arquivado: false }),
    ).not.toThrow()
    expect(() => validarHospedagem('CONTAINER', null)).not.toThrow()
    expect(() => validarHospedagem('SERVIDOR', null)).not.toThrow()
    expect(() => validarHospedagem('CONTAINER', { tipo: 'CONTAINER', arquivado: false })).toThrow(
      'Só servidores podem hospedar outros recursos.',
    )
    expect(() => validarHospedagem('SERVIDOR', { tipo: 'SERVIDOR', arquivado: false })).toThrow(
      'Um servidor não pode estar hospedado em outro recurso.',
    )
    expect(() => validarHospedagem('BANCO', { tipo: 'SERVIDOR', arquivado: true })).toThrow(
      'Servidor arquivado não recebe novos recursos.',
    )
  })

  test.each([
    ['48', '48.00'],
    ['48,5', '48.50'],
    ['48.50', '48.50'],
    [48, '48.00'],
    ['99999999.99', '99999999.99'],
    ['', null],
    [null, null],
    [undefined, null],
  ])('custo %s → %s', (entrada, saida) => {
    expect(validarCustoMensal(entrada)).toBe(saida)
  })

  test.each(['-1', 'abc', '100000000', '48,555', '1e3'])('custo %s é recusado', (entrada) => {
    expect(() => validarCustoMensal(entrada)).toThrow('Custo mensal inválido.')
  })

  test('texto opcional apara, anula vazio e recusa acima do máximo', () => {
    expect(validarTextoOpcional('  Hetzner ', 'O provedor', 80)).toBe('Hetzner')
    expect(validarTextoOpcional('   ', 'O provedor', 80)).toBeNull()
    expect(validarTextoOpcional(null, 'O provedor', 80)).toBeNull()
    expect(validarTextoOpcional(undefined, 'O provedor', 80)).toBeNull()
    expect(validarTextoOpcional('a'.repeat(80), 'O provedor', 80)).toHaveLength(80)
    expect(() => validarTextoOpcional('a'.repeat(81), 'O provedor', 80)).toThrow(
      'O provedor deve ter até 80 caracteres.',
    )
  })
})

describe('apresentação', () => {
  test('recurso ativo não tem selo; arquivado tem "Arquivado" neutro', () => {
    expect(situacaoDoRecurso({ arquivado: false })).toBeNull()
    expect(situacaoDoRecurso({ arquivado: true })).toEqual({
      chave: 'arquivado',
      texto: 'Arquivado',
      tom: 'neutro',
    })
  })

  test('rotuloDoTipo', () => {
    expect(
      (['SERVIDOR', 'CONTAINER', 'BANCO', 'STORAGE', 'OUTRO'] as const).map(rotuloDoTipo),
    ).toEqual(['Servidor', 'Container', 'Banco de dados', 'Storage', 'Outro'])
  })
})
