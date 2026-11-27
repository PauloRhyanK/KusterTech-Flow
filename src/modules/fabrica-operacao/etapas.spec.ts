import { describe, expect, test } from 'vitest'
import {
  LIMITES_PADRAO,
  admitir,
  aplicarDecisaoDeGate,
  aplicarResultado,
  colidem,
  confirmarMerge,
  etapasElegiveis,
  iniciarExecucao,
  type Etapa,
} from './etapas'

function etapa(id: string, extra: Partial<Etapa> = {}): Etapa {
  return {
    id,
    tipo: 'implementacao',
    repo: 'PauloRhyanK/KusterTech-Flow',
    arquivos: [`src/${id}/**`],
    dependeDe: [],
    prioridade: 0,
    criadaEm: '2026-11-27T10:00:00Z',
    estado: 'pendente',
    falhasTecnicas: 0,
    correcoes: 0,
    prUrl: null,
    motivo: null,
    ...extra,
  }
}

describe('etapasElegiveis', () => {
  test('pendente sem dependências é elegível', () => {
    expect(etapasElegiveis([etapa('a')])).toEqual(['a'])
  })

  test('dependências mergeadas ou concluídas liberam; outra em execução segura', () => {
    const etapas = [
      etapa('a', { estado: 'mergeada' }),
      etapa('b', { tipo: 'leitura', estado: 'concluida' }),
      etapa('c', { estado: 'executando' }),
      etapa('d', { dependeDe: ['a', 'b'] }),
      etapa('e', { dependeDe: ['a', 'c'] }),
    ]
    expect(etapasElegiveis(etapas)).toEqual(['d'])
  })

  test('dependência inexistente nunca libera', () => {
    expect(etapasElegiveis([etapa('a', { dependeDe: ['fantasma'] })])).toEqual([])
  })

  test('ciclo nunca libera e termina', () => {
    expect(
      etapasElegiveis([etapa('a', { dependeDe: ['b'] }), etapa('b', { dependeDe: ['a'] })]),
    ).toEqual([])
  })

  test.each(['bloqueada', 'cancelada', 'executando', 'aguardando_gates'] as const)(
    '%s nunca é elegível',
    (estado) => {
      expect(etapasElegiveis([etapa('a', { estado })])).toEqual([])
    },
  )
})

describe('iniciarExecucao', () => {
  test('pendente passa a executando e limpa o motivo', () => {
    expect(iniciarExecucao(etapa('a', { motivo: 'antes' }))).toMatchObject({
      estado: 'executando',
      motivo: null,
    })
  })

  test('outro estado não muda', () => {
    const e = etapa('a', { estado: 'mergeada' })
    expect(iniciarExecucao(e)).toBe(e)
  })
})

describe('aplicarResultado', () => {
  const executando = (extra: Partial<Etapa> = {}) => etapa('a', { estado: 'executando', ...extra })

  test('implementação com PR vai para os gates', () => {
    expect(
      aplicarResultado(executando(), { tipo: 'pr_aberto', prUrl: 'https://x/pull/1' }),
    ).toMatchObject({ estado: 'aguardando_gates', prUrl: 'https://x/pull/1' })
  })

  test('leitura sem PR é concluída', () => {
    expect(aplicarResultado(executando({ tipo: 'leitura' }), { tipo: 'sem_pr' }).estado).toBe(
      'concluida',
    )
  })

  test('leitura que abre PR não é aceita: bloqueia', () => {
    expect(
      aplicarResultado(executando({ tipo: 'leitura' }), { tipo: 'pr_aberto', prUrl: 'u' }),
    ).toMatchObject({ estado: 'bloqueada', motivo: 'etapa de leitura abriu PR' })
  })

  test('implementação que termina sem PR conta falha técnica', () => {
    expect(aplicarResultado(executando(), { tipo: 'sem_pr' })).toMatchObject({
      estado: 'pendente',
      falhasTecnicas: 1,
      motivo: 'execução terminou sem PR',
    })
  })

  test('falha técnica volta a pendente até o teto, depois bloqueia', () => {
    const r = { tipo: 'falha_tecnica', motivo: 'rede' } as const
    expect(aplicarResultado(executando({ falhasTecnicas: 1 }), r)).toMatchObject({
      estado: 'pendente',
      falhasTecnicas: 2,
    })
    expect(aplicarResultado(executando({ falhasTecnicas: 2 }), r)).toMatchObject({
      estado: 'bloqueada',
      falhasTecnicas: 3,
    })
  })

  test('limite de uso volta a pendente sem contar falha', () => {
    expect(
      aplicarResultado(executando({ falhasTecnicas: 2 }), {
        tipo: 'limite_de_uso',
        retornoEm: null,
      }),
    ).toMatchObject({ estado: 'pendente', falhasTecnicas: 2 })
  })

  test('erro de configuração bloqueia na hora', () => {
    expect(
      aplicarResultado(executando(), { tipo: 'erro_de_configuracao', motivo: 'modelo inválido' }),
    ).toMatchObject({ estado: 'bloqueada', motivo: 'modelo inválido' })
  })

  test('saída inválida conta como falha técnica', () => {
    expect(
      aplicarResultado(executando(), { tipo: 'saida_invalida', motivo: 'sem veredito' }),
    ).toMatchObject({ estado: 'pendente', falhasTecnicas: 1, motivo: 'sem veredito' })
  })

  test('cancelada volta a pendente sem contar falha', () => {
    expect(aplicarResultado(executando(), { tipo: 'cancelada' })).toMatchObject({
      estado: 'pendente',
      falhasTecnicas: 0,
    })
  })

  test('incerto fica executando e pede reconciliação', () => {
    expect(aplicarResultado(executando(), { tipo: 'incerto' })).toMatchObject({
      estado: 'executando',
      motivo: 'reconciliar antes de repetir',
    })
  })

  test('resultado fora de execução não muda nada', () => {
    const e = etapa('a', { estado: 'mergeada' })
    expect(aplicarResultado(e, { tipo: 'sem_pr' })).toBe(e)
  })

  test('não muda a etapa de entrada', () => {
    const e = executando()
    aplicarResultado(e, { tipo: 'falha_tecnica', motivo: 'x' })
    expect(e).toMatchObject({ estado: 'executando', falhasTecnicas: 0 })
  })
})

describe('aplicarDecisaoDeGate', () => {
  const emGates = (extra: Partial<Etapa> = {}) =>
    etapa('a', { estado: 'aguardando_gates', prUrl: 'https://x/pull/1', ...extra })

  test('mergear registra o pedido; o estado muda só com a confirmação', () => {
    expect(aplicarDecisaoDeGate(emGates(), 'mergear', [])).toMatchObject({
      estado: 'aguardando_gates',
      motivo: 'merge solicitado',
    })
  })

  test('corrigir volta a pendente mantendo o PR e soma correção', () => {
    expect(aplicarDecisaoDeGate(emGates(), 'corrigir', ['CI vermelho'])).toMatchObject({
      estado: 'pendente',
      correcoes: 1,
      prUrl: 'https://x/pull/1',
      motivo: 'CI vermelho',
    })
  })

  test('corrigir depois do teto bloqueia para escalar', () => {
    expect(
      aplicarDecisaoDeGate(emGates({ correcoes: LIMITES_PADRAO.maxCorrecoes }), 'corrigir', ['x']),
    ).toMatchObject({ estado: 'bloqueada', motivo: 'escalar: x' })
  })

  test('humano bloqueia com os motivos', () => {
    expect(
      aplicarDecisaoDeGate(emGates(), 'humano', ['toca arquivos protegidos: a']),
    ).toMatchObject({ estado: 'bloqueada', motivo: 'toca arquivos protegidos: a' })
  })

  test('aguardar não muda nada', () => {
    const e = emGates()
    expect(aplicarDecisaoDeGate(e, 'aguardar', ['CI pendente'])).toBe(e)
  })

  test('fora dos gates não muda nada', () => {
    const e = etapa('a')
    expect(aplicarDecisaoDeGate(e, 'corrigir', ['x'])).toBe(e)
  })
})

describe('confirmarMerge', () => {
  test('nos gates vira mergeada', () => {
    expect(confirmarMerge(etapa('a', { estado: 'aguardando_gates' })).estado).toBe('mergeada')
  })

  test('em outro estado não muda', () => {
    const e = etapa('a')
    expect(confirmarMerge(e)).toBe(e)
  })
})

describe('colidem e admitir', () => {
  test('mesmo repositório com caixa diferente e globs sobrepostos colide', () => {
    expect(
      colidem(
        { repo: 'Dono/Repo', arquivos: ['src/**'] },
        { repo: 'dono/repo', arquivos: ['src/a.ts'] },
      ),
    ).toBe(true)
  })

  test('repositórios diferentes não colidem', () => {
    expect(
      colidem({ repo: 'dono/a', arquivos: ['src/**'] }, { repo: 'dono/b', arquivos: ['src/**'] }),
    ).toBe(false)
  })

  test('ordena por prioridade e depois por idade, pula colisões e respeita vagas', () => {
    const candidatas = [
      etapa('velha', { criadaEm: '2026-11-27T09:00:00Z' }),
      etapa('nova', { criadaEm: '2026-11-27T11:00:00Z' }),
      etapa('urgente', { prioridade: 10, criadaEm: '2026-11-27T12:00:00Z' }),
      etapa('colide-ativa', { arquivos: ['src/ativa/x.ts'] }),
      etapa('colide-urgente', { prioridade: 5, arquivos: ['src/urgente/**'] }),
    ]
    const ativas = [etapa('ativa', { estado: 'executando' })]
    expect(admitir(candidatas, ativas, 3)).toEqual(['urgente', 'velha', 'nova'])
    expect(admitir(candidatas, ativas, 1)).toEqual(['urgente'])
  })

  test('sem vagas não admite ninguém', () => {
    expect(admitir([etapa('a')], [], 0)).toEqual([])
  })
})
