import { describe, expect, test } from 'vitest'
import { MODELO_PADRAO } from '@/modules/demandas/model'
import { type ErroComDemanda, montarQuadro, rotuloDaAba } from './apresentacao'

const agora = new Date('2026-11-26T15:30:00.000Z')
const MIN = 60_000
const HORA = 60 * MIN
const antes = (ms: number) => new Date(agora.getTime() - ms)
const etapas = MODELO_PADRAO.map((e) => ({ ...e }))

function erro(id: string, p: Partial<ErroComDemanda> = {}): ErroComDemanda {
  return {
    issueId: id,
    projetoGlitchTip: 'app-vendas',
    titulo: `Erro ${id}`,
    onde: 'a.ts',
    nivel: 'error',
    link: `https://erros.exemplo.com/minha-org/issues/${id}`,
    eventos: 3,
    usuarios: 1,
    primeiroEm: antes(HORA),
    ultimoEm: antes(MIN),
    resolvidoEm: null,
    esperaDesde: null,
    demandaId: `d${id}`,
    demandaAnteriorId: null,
    serie: [],
    demanda: { encerrada: null, noArEm: null, etapaAtual: etapas[0]!.chave, etapas, prs: [] },
    ...p,
  }
}

const lido = (slug = 'app-vendas', ultimoSucessoEm: Date | null = antes(2 * MIN)) => ({
  projetoGlitchTip: slug,
  ultimoSucessoEm,
  ultimaFalhaEm: null,
  motivo: null,
})

const quadro = (erros: ErroComDemanda[], extra = {}) =>
  montarQuadro(
    { configurado: true, erros, leituras: [lido()], slugs: ['app-vendas'], ...extra },
    agora,
  )

describe('montarQuadro', () => {
  test('ordem: voltou, novo, em correção, na espera, corrigido; recentes primeiro', () => {
    const q = quadro([
      erro('esp', { demanda: null, demandaId: null, esperaDesde: antes(MIN) }),
      erro('cor', {
        ultimoEm: antes(30 * HORA),
        demanda: {
          encerrada: 'no_ar',
          noArEm: antes(2 * HORA),
          etapaAtual: 'no_ar',
          etapas,
          prs: [],
        },
      }),
      erro('em', {
        demanda: {
          encerrada: null,
          noArEm: null,
          etapaAtual: etapas[3]!.chave,
          etapas,
          prs: ['https://github.com/dono/app/pull/88'],
        },
      }),
      erro('novo-velho', { ultimoEm: antes(10 * MIN) }),
      erro('novo-recente', { ultimoEm: antes(MIN) }),
      erro('volta', { demandaAnteriorId: 'd0' }),
      erro('resolvido', { resolvidoEm: antes(MIN) }),
    ])
    expect(q.linhas.map((l) => [l.issueId, l.estado])).toEqual([
      ['volta', 'voltou'],
      ['novo-recente', 'novo'],
      ['novo-velho', 'novo'],
      ['em', 'em_correcao'],
      ['esp', 'na_espera'],
      ['cor', 'corrigido'],
    ])
    expect(q.contagem).toEqual({ voltou: 1, novo: 2, em_correcao: 1, na_espera: 1 })
    expect(q.linhas.find((l) => l.issueId === 'em')?.detalhe).toBe('desenvolvida · PR #88')
    expect(q.linhas.find((l) => l.issueId === 'novo-recente')?.detalhe).toBe(
      'demanda aberta, triagem',
    )
    expect(q.linhas.find((l) => l.issueId === 'esp')?.detalhe).toMatch(/^teto de 5 por hora/)
    expect(q.corrigidosEm7Dias).toBe(1)
  })

  test('leitura velha com 31 min, e não com 29', () => {
    expect(quadro([], { leituras: [lido('app-vendas', antes(31 * MIN))] }).leitura.velha).toBe(true)
    expect(quadro([], { leituras: [lido('app-vendas', antes(29 * MIN))] }).leitura.velha).toBe(
      false,
    )
  })

  test('projeto nunca lido conta como leitura velha', () => {
    const q = quadro([], { leituras: [] })
    expect(q.leitura).toEqual({ ultimoSucessoEm: null, velha: true, motivo: null })
    expect(q.projetosLidos).toBe(0)
  })

  test('motivo da falha vem junto; projeto sem repositório vira aviso, não leitura velha', () => {
    const q = quadro([], {
      slugs: ['app-vendas', 'portal'],
      leituras: [
        {
          ...lido('app-vendas', antes(45 * MIN)),
          ultimaFalhaEm: antes(MIN),
          motivo: 'token recusado',
        },
        { ...lido('portal', null), ultimaFalhaEm: antes(MIN), motivo: 'projeto sem repositório' },
      ],
    })
    expect(q.leitura).toMatchObject({ velha: true, motivo: 'token recusado' })
    expect(q.avisos).toEqual(['projeto sem repositório: portal'])
  })

  test('não configurado', () => {
    const q = montarQuadro({ configurado: false, erros: [], leituras: [], slugs: [] }, agora)
    expect(q.configurado).toBe(false)
    expect(q.leitura.velha).toBe(false)
  })

  test('nunca lido com falha traz o motivo', () => {
    const q = quadro([], {
      leituras: [
        { ...lido('app-vendas', null), ultimaFalhaEm: antes(MIN), motivo: 'token recusado' },
      ],
    })
    expect(q.leitura).toEqual({ ultimoSucessoEm: null, velha: true, motivo: 'token recusado' })
  })
})

describe('rotuloDaAba', () => {
  test('conta novos e os que voltaram', () => {
    const q = quadro([erro('a'), erro('b', { demandaAnteriorId: 'd0' })])
    expect(rotuloDaAba(q)).toEqual({ rotulo: 'Erros', contador: 2 })
  })
  test('leitura velha marca a aba', () => {
    const q = quadro([], { leituras: [lido('app-vendas', antes(31 * MIN))] })
    expect(rotuloDaAba(q).rotulo).toBe('Erros · sem leitura')
  })
})
