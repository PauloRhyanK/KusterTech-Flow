import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), error: vi.fn() } }))
vi.mock('@/modules/demandas/worker', () => ({
  limparArquivosDeDemandas: vi.fn(async () => ({ capturas: 0, parciais: 0, anexosDeRelatos: 0 })),
  marcarPartesSemPublicacao: vi.fn(async () => 0),
}))

vi.mock('@/modules/erros/service', () => ({
  buscarErrosDoGlitchTip: vi.fn(async () => ({
    projetos: 0,
    abertas: 0,
    voltaram: 0,
    naEspera: 0,
    atualizados: 0,
    resolvidos: 0,
    falhas: 0,
  })),
}))

vi.mock('@/modules/relatos/worker', () => ({
  buscarRelatosDosSistemas: vi.fn(async () => undefined),
  enviarAndamentoDosRelatos: vi.fn(async () => undefined),
  recuperarAnexosDosRelatos: vi.fn(async () => ({ copiados: 0, falhas: 0 })),
}))

vi.mock('@/modules/decidir/worker', () => ({
  arquivarConversasResolvidas: vi.fn(async () => 0),
  limparParciaisDeConversas: vi.fn(async () => 0),
}))

import { log } from '@/lib/log'
import { resolverModulosAtivos } from '@/lib/modulos'
import { limparArquivosDeDemandas } from '@/modules/demandas/worker'
import { recuperarAnexosDosRelatos } from '@/modules/relatos/worker'
import { buscarErrosDoGlitchTip } from '@/modules/erros/service'
import { criarTarefasDoCiclo, executarTarefas } from './tarefas'

const fonte = { obterFonte: () => null, intervaloMs: 1 }

describe('tarefas do worker', () => {
  test('com os módulos padrão o ciclo tem onze tarefas, nesta ordem', () => {
    const nomes = criarTarefasDoCiclo({ ...fonte, ativos: resolverModulosAtivos(undefined) }).map(
      (t) => t.nome,
    )
    expect(nomes).toEqual([
      'processar-eventos-de-webhook',
      'reconciliar-github',
      'sincronizar-execucoes-warren',
      'processar-fila-de-publicacao',
      'limpar-arquivos-de-demandas',
      'marcar-partes-sem-publicacao',
      'decidir:arquivar',
      'buscar-erros-do-glitchtip',
      'buscar-relatos',
      'enviar-andamento',
      'recuperar-anexos-de-relatos',
    ])
  })
  test('buscar-relatos e enviar-andamento são do módulo relatos e somem sem ele', () => {
    const semRelatos = new Set(resolverModulosAtivos(undefined))
    semRelatos.delete('relatos')
    const nomes = criarTarefasDoCiclo({ ...fonte, ativos: semRelatos }).map((t) => t.nome)
    expect(nomes).not.toContain('buscar-relatos')
    expect(nomes).not.toContain('enviar-andamento')
    const com = criarTarefasDoCiclo({ ...fonte, ativos: resolverModulosAtivos(undefined) })
    expect(com.filter((t) => t.modulo === 'relatos').map((t) => t.nome)).toEqual([
      'buscar-relatos',
      'enviar-andamento',
      'recuperar-anexos-de-relatos',
    ])
  })

  test('a tarefa limpar-arquivos-de-demandas some quando demandas não está ativo', () => {
    const semDemandas = new Set(resolverModulosAtivos(undefined))
    semDemandas.delete('demandas')
    const nomes = criarTarefasDoCiclo({ ...fonte, ativos: semDemandas }).map((t) => t.nome)
    expect(nomes).not.toContain('limpar-arquivos-de-demandas')
    const comDemandas = criarTarefasDoCiclo({ ...fonte, ativos: resolverModulosAtivos(undefined) })
    expect(comDemandas.find((t) => t.nome === 'limpar-arquivos-de-demandas')?.modulo).toBe(
      'demandas',
    )
  })

  test('recuperar-anexos-de-relatos roda no máximo uma vez por hora e só registra log quando houve trabalho', async () => {
    const recuperar = vi.mocked(recuperarAnexosDosRelatos)
    recuperar.mockClear()
    const tarefa = criarTarefasDoCiclo({
      ...fonte,
      ativos: resolverModulosAtivos(undefined),
    }).find((t) => t.nome === 'recuperar-anexos-de-relatos')!
    const t0 = new Date('2026-11-27T12:00:00.000Z')
    await tarefa.executar(t0)
    await tarefa.executar(new Date(t0.getTime() + 59 * 60_000))
    await tarefa.executar(new Date(t0.getTime() + 60 * 60_000))
    expect(recuperar).toHaveBeenCalledTimes(2)
  })

  test('a tarefa marcar-partes-sem-publicacao é do módulo demandas e some sem ele', () => {
    const semDemandas = new Set(resolverModulosAtivos(undefined))
    semDemandas.delete('demandas')
    const nomes = criarTarefasDoCiclo({ ...fonte, ativos: semDemandas }).map((t) => t.nome)
    expect(nomes).not.toContain('marcar-partes-sem-publicacao')
    const com = criarTarefasDoCiclo({ ...fonte, ativos: resolverModulosAtivos(undefined) })
    expect(com.find((t) => t.nome === 'marcar-partes-sem-publicacao')?.modulo).toBe('demandas')
  })

  test('limpar-arquivos-de-demandas roda no máximo uma vez por hora; depois de falhar, tenta no ciclo seguinte', async () => {
    const limpar = vi.mocked(limparArquivosDeDemandas)
    limpar.mockClear()
    const tarefa = criarTarefasDoCiclo({
      ...fonte,
      ativos: resolverModulosAtivos(undefined),
    }).find((t) => t.nome === 'limpar-arquivos-de-demandas')!
    const t0 = new Date('2026-11-20T12:00:00.000Z')
    const em = (ms: number) => new Date(t0.getTime() + ms)

    limpar.mockRejectedValueOnce(new Error('disco'))
    await expect(tarefa.executar(t0)).rejects.toThrow('disco')
    await tarefa.executar(em(30_000))
    await tarefa.executar(em(60_000))
    await tarefa.executar(em(30_000 + 59 * 60_000))
    await tarefa.executar(em(30_000 + 60 * 60_000))

    expect(limpar.mock.calls.map(([agora]) => agora)).toEqual([
      t0,
      em(30_000),
      em(30_000 + 60 * 60_000),
    ])
  })

  test('buscar-erros-do-glitchtip é do módulo erros e roda no máximo a cada 2 minutos', async () => {
    const buscar = vi.mocked(buscarErrosDoGlitchTip)
    buscar.mockClear()
    const semErros = new Set(resolverModulosAtivos(undefined))
    semErros.delete('erros')
    expect(criarTarefasDoCiclo({ ...fonte, ativos: semErros }).map((t) => t.nome)).not.toContain(
      'buscar-erros-do-glitchtip',
    )
    const tarefa = criarTarefasDoCiclo({
      ...fonte,
      ativos: resolverModulosAtivos(undefined),
    }).find((t) => t.nome === 'buscar-erros-do-glitchtip')!
    expect(tarefa.modulo).toBe('erros')
    const t0 = new Date('2026-11-26T12:00:00.000Z')
    const em = (ms: number) => new Date(t0.getTime() + ms)
    await tarefa.executar(t0)
    await tarefa.executar(em(60_000))
    await tarefa.executar(em(119_000))
    await tarefa.executar(em(120_000))
    expect(buscar.mock.calls.map(([agora]) => agora)).toEqual([t0, em(120_000)])
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

  test('com todos os módulos ligados o ciclo tem as dezoito tarefas na ordem original', () => {
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
      'limpar-arquivos-de-demandas',
      'marcar-partes-sem-publicacao',
      'decidir:arquivar',
      'buscar-erros-do-glitchtip',
      'buscar-relatos',
      'enviar-andamento',
      'recuperar-anexos-de-relatos',
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

  test('decidir:arquivar existe e só roda com o módulo decidir', async () => {
    const todas = criarTarefasDoCiclo({ ...fonte, ativos: resolverModulosAtivos(undefined) })
    expect(todas.find((t) => t.nome === 'decidir:arquivar')?.modulo).toBe('decidir')
    const semDecidir = new Set(resolverModulosAtivos(undefined))
    semDecidir.delete('decidir')
    expect(criarTarefasDoCiclo({ ...fonte, ativos: semDecidir }).map((t) => t.nome)).not.toContain(
      'decidir:arquivar',
    )
  })

  test('decidir:arquivar roda a cada 5 min e limpa os parciais das conversas uma vez por hora', async () => {
    const { arquivarConversasResolvidas, limparParciaisDeConversas } =
      await import('@/modules/decidir/worker')
    vi.mocked(arquivarConversasResolvidas).mockClear()
    vi.mocked(limparParciaisDeConversas).mockClear()
    const tarefa = criarTarefasDoCiclo({
      ...fonte,
      ativos: resolverModulosAtivos(undefined),
    }).find((t) => t.nome === 'decidir:arquivar')!
    const t0 = new Date('2026-11-20T12:00:00.000Z')
    const em = (min: number) => new Date(t0.getTime() + min * 60_000)
    await tarefa.executar(t0)
    await tarefa.executar(em(2))
    await tarefa.executar(em(5))
    expect(arquivarConversasResolvidas).toHaveBeenCalledTimes(2)
    expect(limparParciaisDeConversas).toHaveBeenCalledTimes(1)
    await tarefa.executar(em(61))
    expect(limparParciaisDeConversas).toHaveBeenCalledTimes(2)
  })
})
