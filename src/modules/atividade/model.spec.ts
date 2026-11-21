import { describe, expect, it } from 'vitest'
import {
  agregarPorProjeto,
  classificarOrigem,
  contarAtividade,
  cortarTitulo,
  JANELA_MS,
  mergeadoNaJanela,
  ordenarLinhas,
  tempoDesde,
  type LinhaDeAtividade,
  type PrDaAtividade,
} from './model'

const AGORA = new Date('2026-11-20T12:00:00Z')
const antes = (ms: number) => new Date(AGORA.getTime() - ms)
const MIN = 60_000
const H = 60 * MIN

describe('classificarOrigem', () => {
  it('autor warren-forge[bot] é fabrica, mesmo em branch claude/x', () => {
    expect(classificarOrigem({ autor: 'warren-forge[bot]', branch: 'claude/x' })).toBe('fabrica')
  })
  it('branch warren/run_abc com autor null é fabrica; warren/outra é outro', () => {
    expect(classificarOrigem({ autor: null, branch: 'warren/run_abc' })).toBe('fabrica')
    expect(classificarOrigem({ autor: null, branch: 'warren/outra' })).toBe('outro')
  })
  it('claude/ é sessao; variações são outro', () => {
    expect(classificarOrigem({ autor: 'ana', branch: 'claude/corrige-pdf' })).toBe('sessao')
    expect(classificarOrigem({ autor: 'ana', branch: 'claude' })).toBe('outro')
    expect(classificarOrigem({ autor: 'ana', branch: 'claude-x' })).toBe('outro')
    expect(classificarOrigem({ autor: 'ana', branch: 'Claude/x' })).toBe('outro')
  })
  it('autor null e branch feat/x é outro', () => {
    expect(classificarOrigem({ autor: null, branch: 'feat/x' })).toBe('outro')
  })
})

describe('mergeadoNaJanela', () => {
  const m = (d: Date) => ({ estado: 'MERGEADO' as const, mergeadoNoGitHub: d })
  it('24 h exatas entra; 24 h e 1 ms não; data futura entra', () => {
    expect(mergeadoNaJanela(m(antes(JANELA_MS)), AGORA)).toBe(true)
    expect(mergeadoNaJanela(m(antes(JANELA_MS + 1)), AGORA)).toBe(false)
    expect(mergeadoNaJanela(m(antes(-5 * MIN)), AGORA)).toBe(true)
  })
  it('FECHADO ou MERGEADO sem data nunca conta', () => {
    expect(mergeadoNaJanela({ estado: 'FECHADO', mergeadoNoGitHub: antes(MIN) }, AGORA)).toBe(false)
    expect(mergeadoNaJanela({ estado: 'MERGEADO', mergeadoNoGitHub: null }, AGORA)).toBe(false)
  })
})

describe('cortarTitulo', () => {
  it('120 caracteres ficam iguais; 121 viram 119 + reticências', () => {
    expect(cortarTitulo('a'.repeat(120))).toBe('a'.repeat(120))
    const cortado = cortarTitulo('a'.repeat(121))
    expect(cortado).toBe('a'.repeat(119) + '…')
    expect(cortado.length).toBe(120)
  })
  it('não parte par substituto', () => {
    expect(cortarTitulo('a'.repeat(119) + '🚀🚀')).toBe('a'.repeat(119) + '…')
  })
})

describe('tempoDesde', () => {
  it('tira o prefixo "há "', () => {
    expect(tempoDesde(antes(12 * MIN), AGORA)).toBe('12 min')
    expect(tempoDesde(antes(90 * MIN), AGORA)).toBe('1 h')
    expect(tempoDesde(antes(30_000), AGORA)).toBe('menos de 1 min')
  })
})

function pr(p: Partial<PrDaAtividade>): PrDaAtividade {
  return {
    projetoId: 'p1',
    estado: 'ABERTO',
    autor: 'ana',
    branch: 'feat/x',
    mergeadoNoGitHub: null,
    ...p,
  }
}
const merge = (p: Partial<PrDaAtividade>, ms: number) =>
  pr({ estado: 'MERGEADO', mergeadoNoGitHub: antes(ms), ...p })

describe('contarAtividade', () => {
  it('conta mergeados na janela e abertos, por origem', () => {
    const prs = [
      merge({ branch: 'claude/a' }, H),
      merge({ autor: 'warren-forge[bot]' }, 2 * H),
      merge({}, 25 * H),
      pr({}),
      pr({ estado: 'FECHADO' }),
    ]
    expect(contarAtividade(prs, AGORA)).toEqual({
      mergeadosHoje: 2,
      abertos: 1,
      porOrigem: { sessao: 1, fabrica: 1, outro: 1 },
    })
  })
})

describe('agregarPorProjeto', () => {
  const projetos = new Map([
    ['p1', { id: 'p1', nome: 'Alfa', desatualizado: false }],
    ['p2', { id: 'p2', nome: 'Beta', desatualizado: true }],
    ['p3', { id: 'p3', nome: 'Gama', desatualizado: false }],
  ])
  it('agrupa, descarta linhas vazias e ignora projeto fora do mapa', () => {
    const prs = [
      merge({ projetoId: 'p1' }, H),
      pr({ projetoId: 'p2' }),
      merge({ projetoId: 'p3' }, 30 * H),
      pr({ projetoId: 'p3', estado: 'FECHADO' }),
      pr({ projetoId: 'zz' }),
    ]
    const linhas = agregarPorProjeto(prs, projetos, AGORA)
    expect(linhas.map((l) => l.projeto.id)).toEqual(['p1', 'p2'])
    expect(linhas[1]).toMatchObject({ abertos: 1, desatualizado: true })
  })
})

describe('ordenarLinhas', () => {
  const l = (nome: string, mergeadosHoje: number, abertos: number): LinhaDeAtividade => ({
    projeto: { id: nome, nome },
    desatualizado: false,
    mergeadosHoje,
    abertos,
    porOrigem: { sessao: 0, fabrica: 0, outro: 0 },
  })
  const nomes = (ls: LinhaDeAtividade[]) => ls.map((x) => `${x.projeto.nome}`)
  it('ordena por merges, abertos e nome', () => {
    expect(nomes(ordenarLinhas([l('B', 3, 5), l('A', 9, 2)]))).toEqual(['A', 'B'])
    expect(nomes(ordenarLinhas([l('B', 3, 1), l('A', 3, 4)]))).toEqual(['A', 'B'])
    expect(nomes(ordenarLinhas([l('Beta', 1, 1), l('Ágata', 1, 1)]))).toEqual(['Ágata', 'Beta'])
  })
})
