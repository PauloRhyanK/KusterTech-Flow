import { Papel as PapelPrisma } from '@prisma/client'
import { describe, expect, test } from 'vitest'
import { PERMISSOES } from './autorizar'
import { converterPapelDoBanco } from './papel'

describe('papel (paridade e conversão entre Prisma e domínio)', () => {
  test('conjunto de valores de Papel do domínio coincide com o enum Papel do Prisma', () => {
    expect(Object.keys(PERMISSOES).sort()).toEqual(Object.values(PapelPrisma).sort())
  })

  test('converterPapelDoBanco converte todos os papéis válidos e rejeita papel desconhecido', () => {
    expect(converterPapelDoBanco('ADMIN')).toBe('ADMIN')
    expect(converterPapelDoBanco('APROVADOR')).toBe('APROVADOR')
    expect(converterPapelDoBanco('TESTADOR')).toBe('TESTADOR')

    expect(() => converterPapelDoBanco('OUTRO' as PapelPrisma)).toThrow(
      /Papel desconhecido no banco/,
    )
  })
})
