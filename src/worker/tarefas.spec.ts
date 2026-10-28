import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), error: vi.fn() } }))

import { log } from '@/lib/log'
import { executarTarefas, TAREFAS_DO_CICLO } from './tarefas'

describe('tarefas do worker', () => {
  test('TAREFAS_DO_CICLO termina com calcular-composicoes e detectar-divergencias, depois de calcular-presencas e detectar-retestes', () => {
    expect(TAREFAS_DO_CICLO.map((t) => t.nome)).toEqual([
      'reconciliar-github',
      'sincronizar-deployments',
      'calcular-presencas',
      'atualizar-fila-de-homologacao',
      'executar-tarefas-github',
      'detectar-retestes',
      'calcular-composicoes',
      'detectar-divergencias',
    ])
    const nomes = TAREFAS_DO_CICLO.map((t) => t.nome)
    expect(nomes.indexOf('calcular-composicoes')).toBeGreaterThan(
      nomes.indexOf('calcular-presencas'),
    )
    expect(nomes.indexOf('calcular-composicoes')).toBeGreaterThan(
      nomes.indexOf('detectar-retestes'),
    )
    expect(nomes.indexOf('detectar-divergencias')).toBeGreaterThan(
      nomes.indexOf('sincronizar-deployments'),
    )
    expect(nomes.indexOf('detectar-divergencias')).toBeGreaterThan(
      nomes.indexOf('calcular-composicoes'),
    )
  })

  test('executarTarefas: a segunda lança Error("segredo ghs_x"), a terceira roda; resultado [ok, falha, ok]; log.error recebe { tarefa: "b", erro: { tipo: "Error" } } e nenhum argumento contém "ghs_x"', async () => {
    const executadas: string[] = []
    const tarefas = [
      { nome: 'a', executar: async () => void executadas.push('a') },
      {
        nome: 'b',
        executar: async () => {
          throw new Error('segredo ghs_x')
        },
      },
      { nome: 'c', executar: async () => void executadas.push('c') },
    ]

    const resultado = await executarTarefas(tarefas, new Date('2026-10-27T12:00:00.000Z'))

    expect(resultado).toEqual([
      { nome: 'a', resultado: 'ok' },
      { nome: 'b', resultado: 'falha' },
      { nome: 'c', resultado: 'ok' },
    ])
    expect(executadas).toEqual(['a', 'c'])
    expect(log.error).toHaveBeenCalledWith(
      { tarefa: 'b', erro: { tipo: 'Error' } },
      'tarefa do worker falhou',
    )
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain('ghs_x')
  })
})
