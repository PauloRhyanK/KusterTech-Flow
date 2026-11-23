import { describe, expect, test } from 'vitest'
import type { Area } from '@/modules/fabrica/escritorio/model'
import { AREAS, lugaresDoAndar, PORTA_DA_GESTAO, pontoDoConserto } from './layout'

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

  test('o conserto fica ao lado da mesa, sem sair da área', () => {
    const r = AREAS.desenvolvimento
    for (const mesa of [
      { x: r.x + 50, y: r.y + 62 },
      { x: r.x + r.w - 60, y: r.y + 62 },
    ]) {
      const p = pontoDoConserto(mesa, 'desenvolvimento')
      expect(Math.abs(p.x - mesa.x)).toBeGreaterThanOrEqual(48)
      expect(p.x - 24).toBeGreaterThanOrEqual(r.x)
      expect(p.x + 24).toBeLessThanOrEqual(r.x + r.w)
    }
  })
})
