import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), error: vi.fn() } }))

import { log } from '@/lib/log'
import { resolverModulosAtivos } from '@/lib/modulos'
import { criarTarefasDoCiclo, executarTarefas } from './tarefas'

const fonte = { obterFonte: () => null, intervaloMs: 1 }

describe('tarefas do worker', () => {
  test('com os módulos padrão o ciclo tem quatro tarefas, nesta ordem', () => {
    const nomes = criarTarefasDoCiclo({ ...fonte, ativos: resolverModulosAtivos(undefined) }).map(
      (t) => t.nome,
    )
    expect(nomes).toEqual([
      'processar-eventos-de-webhook',
      'reconciliar-github',
      'sincronizar-execucoes-warren',
      'processar-fila-de-publicacao',
    ])
  })

  test('a tarefa processar-fila-de-publicacao some quando fila-de-publicacao não está ativo', () => {
    const semFila = new Set(resolverModulosAtivos(undefined))
    semFila.delete('fila-de-publicacao')
    const tarefas = criarTarefasDoCiclo({ ...fonte, ativos: semFila })
    expect(tarefas.map((t) => t.nome)).not.toContain('processar-fila-de-publicacao')
    const comFila = criarTarefasDoCiclo({ ...fonte, ativos: resolverModulosAtivos(undefined) })
    expect(comFila.find((t) => t.nome === 'processar-fila-de-publicacao')?.modulo).toBe(
      'fila-de-publicacao',
    )
  })

  test('com todos os módulos ligados o ciclo tem as onze tarefas na ordem original', () => {
    const todos = resolverModulosAtivos('entregas,ambientes,homologacao,publicacao')
    expect(criarTarefasDoCiclo({ ...fonte, ativos: todos }).map((t) => t.nome)).toEqual([
      'processar-eventos-de-webhook',
      'reconciliar-github',
      'sincronizar-execucoes-warren',
      'processar-fila-de-publicacao',
      'sincronizar-deployments',
      'calcular-presencas',
      'atualizar-fila-de-homologacao',
      'executar-tarefas-github',
      'detectar-retestes',
      'calcular-composicoes',
      'detectar-divergencias',
    ])
  })

  test('executarTarefas: a segunda lança Error("segredo ghs_x"), a terceira roda; resultado [ok, falha, ok]; log.error recebe { tarefa: "b", erro: { tipo: "Error" } } e nenhum argumento contém "ghs_x"', async () => {
    const executadas: string[] = []
    const tarefas = [
      { nome: 'a', modulo: 'github' as const, executar: async () => void executadas.push('a') },
      {
        nome: 'b',
        modulo: 'github' as const,
        executar: async () => {
          throw new Error('segredo ghs_x')
        },
      },
      { nome: 'c', modulo: 'github' as const, executar: async () => void executadas.push('c') },
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
