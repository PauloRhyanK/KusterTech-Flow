import { describe, expect, test } from 'vitest'
import { ErroDeDominio } from '@/lib/erros'
import {
  lerPrazo,
  milestonesHerdadas,
  progressoDaMilestone,
  textoDoProgresso,
  validarDescricaoDeMilestone,
  validarJustificativa,
  validarTituloDeMilestone,
  type ItemDeProgresso,
} from './model'

function item(
  issueId: string,
  estado: 'ABERTA' | 'FECHADA',
  foraDoEscopo = false,
): ItemDeProgresso {
  return { issueId, estado, foraDoEscopo }
}

const base = [
  item('i-portal-1', 'ABERTA'),
  item('i-portal-4', 'FECHADA'),
  item('i-api-1', 'ABERTA'),
]

describe('progressoDaMilestone', () => {
  test('progressoDaMilestone: [] → {0,0,null}; i-portal-1 ABERTA, i-portal-4 FECHADA, i-api-1 ABERTA → {1,3,33}; i-portal-4 repetida → {1,3,33}', () => {
    expect(progressoDaMilestone([])).toEqual({ fechadas: 0, total: 0, percentual: null })
    expect(progressoDaMilestone(base)).toEqual({ fechadas: 1, total: 3, percentual: 33 })
    expect(progressoDaMilestone([...base, item('i-portal-4', 'FECHADA')])).toEqual({
      fechadas: 1,
      total: 3,
      percentual: 33,
    })
  })

  test('progressoDaMilestone com correções: + i-api-3 ABERTA no escopo → {1,4,25}; i-api-3 fora → {1,3,33}; i-api-3 FECHADA no escopo → {2,4,50}; repetida uma fora e outra não → conta', () => {
    expect(progressoDaMilestone([...base, item('i-api-3', 'ABERTA')])).toEqual({
      fechadas: 1,
      total: 4,
      percentual: 25,
    })
    expect(progressoDaMilestone([...base, item('i-api-3', 'ABERTA', true)])).toEqual({
      fechadas: 1,
      total: 3,
      percentual: 33,
    })
    expect(progressoDaMilestone([...base, item('i-api-3', 'FECHADA')])).toEqual({
      fechadas: 2,
      total: 4,
      percentual: 50,
    })
    expect(
      progressoDaMilestone([...base, item('i-api-3', 'ABERTA', true), item('i-api-3', 'ABERTA')]),
    ).toEqual({ fechadas: 1, total: 4, percentual: 25 })
  })

  test('progressoDaMilestone: 2 de 3 → 66; 2 de 2 → 100; só itens fora → {0,0,null}', () => {
    expect(
      progressoDaMilestone([item('a', 'FECHADA'), item('b', 'FECHADA'), item('c', 'ABERTA')])
        .percentual,
    ).toBe(66)
    expect(progressoDaMilestone([item('a', 'FECHADA'), item('b', 'FECHADA')]).percentual).toBe(100)
    expect(progressoDaMilestone([item('a', 'FECHADA', true), item('b', 'ABERTA', true)])).toEqual({
      fechadas: 0,
      total: 0,
      percentual: null,
    })
  })
})

describe('textoDoProgresso', () => {
  test('textoDoProgresso: total 0 → "Nenhuma issue vinculada"; {1,3,33} → "1 de 3 issues fechadas · 33%"; {0,1,0} → "0 de 1 issue fechada · 0%"; nenhum texto contém "pronta", "entregue", "aprovada" ou "QA"', () => {
    const textos = [
      textoDoProgresso({ fechadas: 0, total: 0, percentual: null }),
      textoDoProgresso({ fechadas: 1, total: 3, percentual: 33 }),
      textoDoProgresso({ fechadas: 0, total: 1, percentual: 0 }),
    ]
    expect(textos).toEqual([
      'Nenhuma issue vinculada',
      '1 de 3 issues fechadas · 33%',
      '0 de 1 issue fechada · 0%',
    ])
    for (const texto of textos) {
      expect(texto).not.toMatch(/pronta|entregue|aprovada|QA/)
    }
  })
})

describe('milestonesHerdadas', () => {
  test('milestonesHerdadas: m1 no escopo, m2 fora, m3 arquivada, jaNaCorrecao [m4] → [m1]; com m1 em jaNaCorrecao → []', () => {
    const daOriginal = [
      { milestoneId: 'm1', foraDoEscopo: false, arquivada: false },
      { milestoneId: 'm2', foraDoEscopo: true, arquivada: false },
      { milestoneId: 'm3', foraDoEscopo: false, arquivada: true },
    ]
    expect(milestonesHerdadas(daOriginal, ['m4'])).toEqual(['m1'])
    expect(milestonesHerdadas(daOriginal, ['m1'])).toEqual([])
  })
})

function mensagem(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ErroDeDominio)
    return (e as Error).message
  }
  throw new Error('não lançou')
}

describe('validações', () => {
  test('validações: título vazio e com 121 caracteres; justificativa "  " e com 501; lerPrazo("2026-11-30") → 2026-11-30T00:00:00.000Z; lerPrazo("") → null; lerPrazo("2026-02-30") → "Prazo inválido."', () => {
    expect(mensagem(() => validarTituloDeMilestone(''))).toBe('O título é obrigatório.')
    expect(mensagem(() => validarTituloDeMilestone('a'.repeat(121)))).toBe(
      'O título não pode ter mais de 120 caracteres.',
    )
    expect(validarTituloDeMilestone('  Entrega 1  ')).toBe('Entrega 1')
    expect(validarTituloDeMilestone('a'.repeat(120))).toHaveLength(120)

    expect(validarDescricaoDeMilestone(undefined)).toBeNull()
    expect(validarDescricaoDeMilestone('  ')).toBeNull()
    expect(mensagem(() => validarDescricaoDeMilestone('a'.repeat(2001)))).toBe(
      'A descrição não pode ter mais de 2000 caracteres.',
    )

    expect(mensagem(() => validarJustificativa('  '))).toBe('A justificativa é obrigatória.')
    expect(mensagem(() => validarJustificativa('a'.repeat(501)))).toBe(
      'A justificativa não pode ter mais de 500 caracteres.',
    )
    expect(validarJustificativa(' motivo ')).toBe('motivo')

    expect(lerPrazo('2026-11-30')?.toISOString()).toBe('2026-11-30T00:00:00.000Z')
    expect(lerPrazo('')).toBeNull()
    expect(lerPrazo(null)).toBeNull()
    expect(mensagem(() => lerPrazo('2026-02-30'))).toBe('Prazo inválido.')
    expect(mensagem(() => lerPrazo('30/11/2026'))).toBe('Prazo inválido.')
  })
})
