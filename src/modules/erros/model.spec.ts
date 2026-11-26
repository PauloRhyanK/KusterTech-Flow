import { describe, expect, test } from 'vitest'
import {
  acrescentarPonto,
  barrinhas,
  decidir,
  descricaoDaDemanda,
  entra,
  estadoNoQuadro,
  type IssueLida,
  lerConfiguracao,
  mascarar,
  type Ponto,
  tituloDaDemanda,
} from './model'

const agora = new Date('2026-11-26T15:30:00.000Z')
const HORA = 60 * 60_000
const DIA = 24 * HORA
const antes = (ms: number) => new Date(agora.getTime() - ms)

function issue(p: Partial<IssueLida> = {}): IssueLida {
  return {
    id: '17',
    titulo: "TypeError: Cannot read properties of undefined (reading 'itens')",
    onde: 'pedidos/fechar.ts in calcularTotal',
    nivel: 'error',
    status: 'unresolved',
    eventos: 48,
    usuarios: 9,
    primeiroEm: antes(2 * DIA),
    ultimoEm: antes(60_000),
    link: 'https://erros.exemplo.com/minha-org/issues/17',
    ...p,
  }
}

const env = {
  GLITCHTIP_URL: 'https://erros.exemplo.com/',
  GLITCHTIP_ORG: 'minha-org',
  GLITCHTIP_TOKEN: 'tok',
  GLITCHTIP_PROJETOS: 'app-vendas:dono/app-vendas, portal:dono/portal',
}

describe('lerConfiguracao', () => {
  test('lê a configuração completa, sem a barra final e com espaços aparados', () => {
    expect(lerConfiguracao(env)).toEqual({
      ok: true,
      config: {
        url: 'https://erros.exemplo.com',
        org: 'minha-org',
        token: 'tok',
        projetos: [
          { slug: 'app-vendas', repositorio: 'dono/app-vendas' },
          { slug: 'portal', repositorio: 'dono/portal' },
        ],
      },
    })
  })

  test.each(['GLITCHTIP_URL', 'GLITCHTIP_TOKEN', 'GLITCHTIP_PROJETOS'])(
    'sem %s não está configurado',
    (chave) => {
      expect(lerConfiguracao({ ...env, [chave]: undefined })).toEqual({
        ok: false,
        motivo: 'GlitchTip não configurado',
      })
    },
  )

  test('sem a organização é configuração inválida', () => {
    expect(lerConfiguracao({ ...env, GLITCHTIP_ORG: '' }).ok).toBe(false)
  })

  test('recusa http', () => {
    expect(lerConfiguracao({ ...env, GLITCHTIP_URL: 'http://erros.exemplo.com' }).ok).toBe(false)
  })

  test.each(['app-vendas', 'app-vendas:semdono', ':dono/repo'])(
    'item malformado "%s" aparece no motivo',
    (item) => {
      const r = lerConfiguracao({ ...env, GLITCHTIP_PROJETOS: item })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.motivo).toContain(item)
    },
  )

  test('slug repetido é inválido', () => {
    const r = lerConfiguracao({ ...env, GLITCHTIP_PROJETOS: 'a:d/a,a:d/b' })
    expect(r.ok).toBe(false)
  })
})

describe('entra', () => {
  test.each(['error', 'fatal'])('nível %s não resolvido e recente entra', (nivel) => {
    expect(entra(issue({ nivel, ultimoEm: antes(6 * DIA) }), agora)).toBe(true)
  })
  test('warning não entra', () => expect(entra(issue({ nivel: 'warning' }), agora)).toBe(false))
  test('resolvida não entra', () => expect(entra(issue({ status: 'resolved' }), agora)).toBe(false))
  test('último evento há 8 dias não entra', () =>
    expect(entra(issue({ ultimoEm: antes(8 * DIA) }), agora)).toBe(false))
})

describe('decidir', () => {
  const noAr = antes(DIA)
  test('nova com vaga abre', () => {
    expect(decidir({ issue: issue(), demanda: null, abertasNaUltimaHora: 4 })).toEqual({
      tipo: 'abrir',
      voltou: false,
    })
  })
  test('nova com o teto cheio espera', () => {
    expect(decidir({ issue: issue(), demanda: null, abertasNaUltimaHora: 5 })).toEqual({
      tipo: 'esperar',
    })
  })
  test('com demanda aberta só atualiza', () => {
    expect(
      decidir({
        issue: issue(),
        demanda: { encerrada: null, noArEm: null },
        abertasNaUltimaHora: 0,
      }),
    ).toEqual({ tipo: 'atualizar' })
  })
  test('evento depois de ir ao ar: voltou', () => {
    const demanda = { encerrada: 'no_ar', noArEm: noAr }
    expect(decidir({ issue: issue(), demanda, abertasNaUltimaHora: 0 })).toEqual({
      tipo: 'abrir',
      voltou: true,
    })
    expect(decidir({ issue: issue(), demanda, abertasNaUltimaHora: 5 })).toEqual({
      tipo: 'esperar',
    })
  })
  test('sem evento depois de ir ao ar só atualiza', () => {
    expect(
      decidir({
        issue: issue({ ultimoEm: antes(2 * DIA) }),
        demanda: { encerrada: 'no_ar', noArEm: noAr },
        abertasNaUltimaHora: 0,
      }),
    ).toEqual({ tipo: 'atualizar' })
  })
  test('descartada não reabre', () => {
    expect(
      decidir({
        issue: issue(),
        demanda: { encerrada: 'descartada', noArEm: null },
        abertasNaUltimaHora: 0,
      }),
    ).toEqual({ tipo: 'atualizar' })
  })
})

describe('estadoNoQuadro', () => {
  const base = { resolvidoEm: null, esperaDesde: null, ultimoEm: antes(60_000), voltou: false }
  const aberta = { encerrada: null, noArEm: null, naPrimeiraEtapa: true }
  test('resolvida no GlitchTip sai', () => {
    expect(estadoNoQuadro({ ...base, resolvidoEm: antes(HORA), demanda: aberta }, agora)).toBe(null)
  })
  test('sem demanda e com espera', () => {
    expect(estadoNoQuadro({ ...base, esperaDesde: antes(HORA), demanda: null }, agora)).toBe(
      'na_espera',
    )
  })
  test('aberta pela regra voltou', () => {
    expect(estadoNoQuadro({ ...base, voltou: true, demanda: aberta }, agora)).toBe('voltou')
  })
  test('aberta na primeira etapa é novo', () => {
    expect(estadoNoQuadro({ ...base, demanda: aberta }, agora)).toBe('novo')
  })
  test('aberta depois da primeira etapa é em correção', () => {
    expect(estadoNoQuadro({ ...base, demanda: { ...aberta, naPrimeiraEtapa: false } }, agora)).toBe(
      'em_correcao',
    )
  })
  test('no ar há 23 h sem evento posterior é corrigido; há 25 h sai', () => {
    const ultimoEm = antes(30 * HORA)
    const noAr = (h: number) => ({
      encerrada: 'no_ar',
      noArEm: antes(h * HORA),
      naPrimeiraEtapa: false,
    })
    expect(estadoNoQuadro({ ...base, ultimoEm, demanda: noAr(23) }, agora)).toBe('corrigido')
    expect(estadoNoQuadro({ ...base, ultimoEm, demanda: noAr(25) }, agora)).toBe(null)
  })
  test('descartada sai', () => {
    expect(
      estadoNoQuadro(
        { ...base, demanda: { encerrada: 'descartada', noArEm: null, naPrimeiraEtapa: false } },
        agora,
      ),
    ).toBe(null)
  })
})

describe('série e barrinhas', () => {
  const hora = (h: number) => {
    const d = new Date(agora.getTime() - h * HORA)
    d.setUTCMinutes(0, 0, 0)
    return d.toISOString()
  }
  test('mesma hora substitui, hora nova acrescenta, guarda 6', () => {
    let serie: Ponto[] = []
    serie = acrescentarPonto(serie, 10, agora)
    serie = acrescentarPonto(serie, 12, agora)
    expect(serie).toEqual([{ hora: hora(0), total: 12 }])
    for (let h = 1; h <= 7; h++) {
      serie = acrescentarPonto(serie, 12 + h, new Date(agora.getTime() + h * HORA))
    }
    expect(serie).toHaveLength(6)
    expect(serie.at(-1)?.total).toBe(19)
  })
  test('diferenças por hora das últimas 5 h', () => {
    const totais = [10, 10, 12, 15, 15, 30]
    const serie = totais.map((total, i) => ({ hora: hora(5 - i), total }))
    expect(barrinhas(serie, agora)).toEqual({ valores: [0, 2, 3, 0, 15], subindo: true })
  })
  test('hora sem ponto conta zero', () => {
    const serie = [
      { hora: hora(2), total: 5 },
      { hora: hora(0), total: 9 },
    ]
    expect(barrinhas(serie, agora).valores).toEqual([0, 0, 0, 0, 4])
  })
  test('série vazia', () => {
    expect(barrinhas([], agora)).toEqual({ valores: [0, 0, 0, 0, 0], subindo: false })
  })
})

describe('mascarar', () => {
  test('e-mail', () => expect(mascarar('falhou para ana@exemplo.com')).toBe('falhou para [e-mail]'))
  test.each(['(11) 98765-4321', '+55 11 987654321'])('telefone %s', (t) =>
    expect(mascarar(`ligar ${t}`)).toBe('ligar [telefone]'),
  )
  test.each(['123.456.789-09', '12345678909', '12.345.678/0001-90'])('documento %s', (d) =>
    expect(mascarar(`cliente ${d}`)).toBe('cliente [documento]'),
  )
  test('texto sem dado pessoal fica igual', () =>
    expect(mascarar('Unique constraint failed on (email)')).toBe(
      'Unique constraint failed on (email)',
    ))
})

describe('texto da demanda', () => {
  test('título com prefixo, mascarado e cortado em 120', () => {
    expect(tituloDaDemanda(issue({ titulo: 'falhou ana@exemplo.com' }))).toBe(
      'Erro: falhou [e-mail]',
    )
    const longo = tituloDaDemanda(issue({ titulo: 'x'.repeat(300) }))
    expect(longo).toHaveLength(120)
    expect(longo.endsWith('…')).toBe(true)
  })
  test('descrição com onde, nível, volume e link', () => {
    const d = descricaoDaDemanda(issue(), null)
    for (const parte of [
      'pedidos/fechar.ts in calcularTotal',
      'error',
      '48 eventos',
      '9 usuários',
      'https://erros.exemplo.com/minha-org/issues/17',
    ]) {
      expect(d).toContain(parte)
    }
  })
  test('descrição do erro que voltou liga a anterior', () => {
    const d = descricaoDaDemanda(issue({ onde: 'cpf 123.456.789-09' }), {
      id: 'abc',
      noArEm: new Date('2026-11-20T13:00:00.000Z'),
    })
    expect(d).toContain('/demandas/abc')
    expect(d).toContain('20/11/2026')
    expect(d).toContain('[documento]')
  })
})
