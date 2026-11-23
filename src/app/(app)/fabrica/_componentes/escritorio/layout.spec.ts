import { describe, expect, test } from 'vitest'
import type { Area } from '@/modules/fabrica/escritorio/model'
import { hobbyDoPapel, TAMANHO_DO_CANTO } from './hobbies'
import {
  AREAS,
  DE_PE,
  lugaresDoAndar,
  type Ponto,
  POSE_DO_HOBBY,
  PORTA_DA_GESTAO,
  pontoDoConserto,
  SENTADO,
  soma,
} from './layout'

const ag = (id: string, papel: string, area: Area, variacao = 0) => ({ id, papel, area, variacao })

describe('layout do andar', () => {
  test('pior caso do Desenvolvimento: 5 frontends + backend + devops + segurança cabem sem sobrepor e sem sair da área', () => {
    const agentes = [
      ...[0, 1, 2, 3, 4].map((i) => ag(`raia:f${i}`, 'frontend', 'desenvolvimento', i)),
      ag('raia:b', 'backend', 'desenvolvimento'),
      ag('raia:d', 'devops', 'desenvolvimento'),
      ag('raia:s', 'seguranca', 'desenvolvimento'),
    ]
    const l = lugaresDoAndar(agentes)
    const pontos = [...l.values()].flatMap((p) => [p.mesa!, p.canto!])
    const r = AREAS.desenvolvimento
    for (const p of pontos) {
      expect(p.x).toBeGreaterThanOrEqual(r.x + 24)
      expect(p.x).toBeLessThanOrEqual(r.x + r.w - 24)
      expect(p.y).toBeGreaterThanOrEqual(r.y + 24)
      expect(p.y).toBeLessThanOrEqual(r.y + r.h - 24)
    }
    for (const [i, a] of pontos.entries())
      for (const b of pontos.slice(i + 1))
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(48)
  })

  test('cada agente com hobby tem mesa e canto; conserto não tem nenhum', () => {
    const l = lugaresDoAndar([
      ag('papel:revisor', 'revisor', 'teste'),
      ag('papel:fixer', 'fixer', 'desenvolvimento'),
    ])
    expect(l.get('papel:revisor')?.mesa).not.toBeNull()
    expect(l.get('papel:revisor')?.canto).not.toBeNull()
    expect(l.get('papel:fixer')).toEqual({ mesa: null, canto: null })
  })

  test('papel sem hobby tem mesa e nenhum canto', () => {
    const l = lugaresDoAndar([ag('raia:x', 'desconhecido', 'desenvolvimento')])
    expect(l.get('raia:x')?.mesa).not.toBeNull()
    expect(l.get('raia:x')?.canto).toBeNull()
  })

  test('cada papel de cada área tem mesa e canto dentro da área', () => {
    const papeis: [string, Area][] = [
      ['produto', 'triagem'],
      ['orquestrador', 'planejamento'],
      ['ux-ui', 'desenho'],
      ['ux-engineer', 'desenho'],
      ['frontend', 'desenvolvimento'],
      ['backend', 'desenvolvimento'],
      ['arquiteto', 'desenvolvimento'],
      ['devops', 'desenvolvimento'],
      ['seguranca', 'desenvolvimento'],
      ['revisor', 'teste'],
      ['qa', 'teste'],
    ]
    const l = lugaresDoAndar(papeis.map(([p, a]) => ag(`papel:${p}`, p, a)))
    for (const [p, area] of papeis) {
      const r = AREAS[area]
      for (const ponto of [l.get(`papel:${p}`)!.mesa!, l.get(`papel:${p}`)!.canto!]) {
        expect(ponto.x).toBeGreaterThanOrEqual(r.x + 24)
        expect(ponto.x).toBeLessThanOrEqual(r.x + r.w - 24)
        expect(ponto.y).toBeGreaterThanOrEqual(r.y + 24)
        expect(ponto.y).toBeLessThanOrEqual(r.y + r.h - 24)
      }
    }
  })

  test('a porta da gestão fica fora das áreas de trabalho', () => {
    const dentro = (a: Area) => {
      const r = AREAS[a]
      return (
        PORTA_DA_GESTAO.x >= r.x &&
        PORTA_DA_GESTAO.x <= r.x + r.w &&
        PORTA_DA_GESTAO.y >= r.y &&
        PORTA_DA_GESTAO.y <= r.y + r.h
      )
    }
    expect((Object.keys(AREAS) as Area[]).some(dentro)).toBe(false)
  })

  test('o conserto trabalha na mesa da raia, no lugar de quem senta', () => {
    const mesa = { x: 300, y: 500 }
    expect(pontoDoConserto(mesa)).toEqual(soma(mesa, SENTADO))
  })

  // Pior caso razoável de cada área: quem pode estar junto no andar.
  const f = (papel: string, n: number) => Array.from({ length: n }, () => papel)
  const CENARIOS: [Area, string[]][] = [
    ['triagem', f('produto', 2)],
    ['planejamento', f('orquestrador', 2)],
    ['desenho', ['ux-ui', 'ux-ui', 'ux-engineer']],
    ['desenho', ['ux-ui', 'ux-engineer', 'ux-engineer']],
    ['desenvolvimento', [...f('frontend', 5), 'backend', 'devops', 'seguranca']],
    [
      'desenvolvimento',
      [...f('frontend', 2), ...f('backend', 2), ...f('devops', 2), ...f('seguranca', 2)],
    ],
    [
      'desenvolvimento',
      [...f('backend', 2), ...f('devops', 2), ...f('seguranca', 2), ...f('arquiteto', 2)],
    ],
    [
      'desenvolvimento',
      [...f('frontend', 2), ...f('arquiteto', 2), ...f('seguranca', 2), 'backend', 'devops'],
    ],
    ['teste', [...f('revisor', 2), ...f('qa', 2)]],
  ]

  interface Caixa {
    x0: number
    y0: number
    x1: number
    y1: number
  }
  const caixa = (c: Ponto, w: number, h: number): Caixa => ({
    x0: c.x - w / 2,
    y0: c.y - h / 2,
    x1: c.x + w / 2,
    y1: c.y + h / 2,
  })
  const sobrepoe = (a: Caixa, b: Caixa) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
  const dentro = (a: Caixa, area: Area) => {
    const r = AREAS[area]
    return a.x0 >= r.x && a.x1 <= r.x + r.w && a.y0 >= r.y && a.y1 <= r.y + r.h
  }

  function montar(area: Area, papeis: string[]) {
    const vistos = new Map<string, number>()
    const agentes = papeis.map((papel, i) => {
      const variacao = vistos.get(papel) ?? 0
      vistos.set(papel, variacao + 1)
      return ag(`raia:${i}`, papel, area, variacao)
    })
    const l = lugaresDoAndar(agentes)
    return agentes.map((a) => {
      const { mesa, canto } = l.get(a.id)!
      const hobby = hobbyDoPapel(a.papel)!
      return {
        a,
        hobby,
        mesa: mesa!,
        canto: canto!,
        // onde o personagem pode estar: sentado, de pé na frente da mesa, no canto
        pontos: [soma(mesa!, SENTADO), soma(mesa!, DE_PE), soma(canto!, POSE_DO_HOBBY[hobby])],
      }
    })
  }

  test.each(CENARIOS)(
    '%s com %j: personagens a 48 px uns dos outros em qualquer estado',
    (area, papeis) => {
      const lista = montar(area, papeis)
      for (const [i, x] of lista.entries())
        for (const y of lista.slice(i + 1))
          for (const p of x.pontos)
            for (const q of y.pontos)
              expect(
                Math.hypot(p.x - q.x, p.y - q.y),
                `${x.a.papel} × ${y.a.papel}`,
              ).toBeGreaterThanOrEqual(48)
    },
  )

  test.each(CENARIOS)(
    '%s com %j: personagens, mesas e cantos dentro da área e sem se sobrepor',
    (area, papeis) => {
      const lista = montar(area, papeis)
      const mesas = lista.map((x) => caixa(x.mesa, 64, 48))
      const cantos = lista.map((x) => caixa(x.canto, ...TAMANHO_DO_CANTO[x.hobby]))
      for (const x of lista)
        for (const p of x.pontos) expect(dentro(caixa(p, 48, 66), area)).toBe(true)
      for (const [i, m] of mesas.entries()) {
        expect(dentro(m, area)).toBe(true)
        for (const n of mesas.slice(i + 1)) expect(sobrepoe(m, n)).toBe(false)
        for (const c of cantos) expect(sobrepoe(m, c)).toBe(false)
      }
      for (const [i, c] of cantos.entries()) {
        expect(dentro(c, area), `canto de ${lista[i]!.a.papel}`).toBe(true)
        for (const [j, d] of cantos.entries()) {
          // a mesma vaga repetida (variação 2+) se desloca 52 px de propósito
          const mesmaVaga =
            lista[i]!.a.papel === lista[j]!.a.papel &&
            lista[i]!.a.variacao % 2 === lista[j]!.a.variacao % 2
          if (j > i && !mesmaVaga)
            expect(sobrepoe(c, d), `${lista[i]!.a.papel} × ${lista[j]!.a.papel}`).toBe(false)
        }
      }
    },
  )
})
