import { describe, expect, test } from 'vitest'
import {
  acrescentarPonto,
  barrinhas,
  comoVoltou,
  corrigidoEm,
  decidir,
  descricaoDaDemanda,
  entra,
  estadoNoQuadro,
  type IssueLida,
  ambientesParaLer,
  grupoDoErro,
  ignorada,
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
        ambientes: ['production', 'producao', 'produção', 'prod', 'live'],
        limiares: { eventos: 10, horas: 2, porDia: 3, horasSemErro: 24 },
      },
    })
  })

  test('limiares e ambientes vêm do ambiente', () => {
    const r = lerConfiguracao({
      ...env,
      GLITCHTIP_AMBIENTES: 'LIVE, producao',
      GLITCHTIP_LIMIAR_EVENTOS: '20',
      GLITCHTIP_LIMIAR_HORAS: '4',
      GLITCHTIP_DEMANDAS_POR_DIA: '1',
      GLITCHTIP_HORAS_SEM_ERRO: '6',
    })
    expect(r.ok && r.config.ambientes).toEqual(['live', 'producao'])
    expect(r.ok && r.config.limiares).toEqual({ eventos: 20, horas: 4, porDia: 1, horasSemErro: 6 })
  })

  test('limiar que não é número inteiro positivo é inválido', () => {
    expect(lerConfiguracao({ ...env, GLITCHTIP_LIMIAR_EVENTOS: 'dez' })).toEqual({
      ok: false,
      motivo: 'GLITCHTIP_LIMIAR_EVENTOS inválido',
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
  const limiares = { eventos: 10, horas: 2, porDia: 3, horasSemErro: 24 }
  const base = { demanda: null, demandaDoGrupo: null, abertasNoDia: 0, limiares }
  const recente = issue({ eventos: 3, primeiroEm: antes(HORA), ultimoEm: antes(60_000) })
  test('erro novo e passageiro fica em observação', () => {
    expect(decidir({ ...base, issue: recente })).toEqual({ tipo: 'observar' })
  })
  test('10 eventos abrem', () => {
    expect(decidir({ ...base, issue: { ...recente, eventos: 10 } })).toEqual({
      tipo: 'abrir',
      voltou: false,
    })
  })
  test('ativo 2 h depois do primeiro evento abre', () => {
    const i = { ...recente, primeiroEm: antes(3 * HORA), ultimoEm: antes(HORA) }
    expect(decidir({ ...base, issue: i })).toEqual({ tipo: 'abrir', voltou: false })
  })
  test('primeiro evento há 3 h, mas sem evento depois, continua em observação', () => {
    const i = { ...recente, primeiroEm: antes(3 * HORA), ultimoEm: antes(3 * HORA - 60_000) }
    expect(decidir({ ...base, issue: i })).toEqual({ tipo: 'observar' })
  })
  test('persistente com o limite do dia cheio espera', () => {
    expect(decidir({ ...base, issue: issue(), abertasNoDia: 3 })).toEqual({ tipo: 'esperar' })
  })
  test('grupo com demanda aberta liga, mesmo passageiro e com o limite cheio', () => {
    expect(decidir({ ...base, issue: recente, demandaDoGrupo: 'd9', abertasNoDia: 3 })).toEqual({
      tipo: 'ligar',
      demandaId: 'd9',
    })
  })
  test('voltou com um parecido já aberto liga a ele', () => {
    const demanda = { encerrada: 'no_ar', noArEm: noAr }
    expect(decidir({ ...base, issue: recente, demanda, demandaDoGrupo: 'd2' })).toEqual({
      tipo: 'ligar',
      demandaId: 'd2',
    })
  })
  test('com demanda aberta só atualiza', () => {
    expect(
      decidir({ ...base, issue: issue(), demanda: { encerrada: null, noArEm: null } }),
    ).toEqual({ tipo: 'atualizar' })
  })
  test('evento depois de ir ao ar: voltou, dentro do limite do dia', () => {
    const demanda = { encerrada: 'no_ar', noArEm: noAr }
    expect(decidir({ ...base, issue: recente, demanda })).toEqual({ tipo: 'abrir', voltou: true })
    expect(decidir({ ...base, issue: recente, demanda, abertasNoDia: 3 })).toEqual({
      tipo: 'esperar',
    })
  })
  test('sem evento depois de ir ao ar só atualiza', () => {
    expect(
      decidir({
        ...base,
        issue: issue({ ultimoEm: antes(2 * DIA) }),
        demanda: { encerrada: 'no_ar', noArEm: noAr },
      }),
    ).toEqual({ tipo: 'atualizar' })
  })
  test('descartada sem evento depois do descarte só atualiza', () => {
    const demanda = { encerrada: 'descartada', noArEm: null, descartadaEm: antes(30_000) }
    expect(decidir({ ...base, issue: issue(), demanda })).toEqual({ tipo: 'atualizar' })
  })
  test('descartada com evento depois do descarte volta à triagem', () => {
    const demanda = { encerrada: 'descartada', noArEm: null, descartadaEm: antes(HORA) }
    expect(decidir({ ...base, issue: recente, demanda })).toEqual({ tipo: 'observar' })
    expect(decidir({ ...base, issue: issue(), demanda })).toEqual({ tipo: 'abrir', voltou: false })
    expect(decidir({ ...base, issue: recente, demanda, demandaDoGrupo: 'd3' })).toEqual({
      tipo: 'ligar',
      demandaId: 'd3',
    })
  })
})

describe('descrição do erro que voltou', () => {
  test('conta as horas a partir de quando a volta foi vista, não do último evento', () => {
    const noArEm = new Date('2026-11-26T19:48:00.000Z')
    const texto = descricaoDaDemanda(
      issue({ ultimoEm: new Date('2026-11-29T19:48:00.000Z') }),
      { id: 'd1', noArEm, voltouEm: new Date('2026-11-26T21:48:00.000Z') },
      [],
      24,
    )
    expect(texto).toContain('voltou 2 h depois de ir ao ar, antes de contar como corrigido')
  })
})

describe('corrigido só depois do ar e da espera sem o erro', () => {
  // flowia#319: merge às 18h21, no ar (7619719) às 19h48; o último evento foi às 03h00.
  const ultimoEm = new Date('2026-11-26T03:00:04.887Z')
  const noArEm = new Date('2026-11-26T19:48:00.000Z')
  const base = { resolvidoEm: null, esperaDesde: null, ultimoEm, voltou: false }
  const emCorrecao = { encerrada: null, noArEm: null, naPrimeiraEtapa: false }
  const noAr = { encerrada: 'no_ar', noArEm, naPrimeiraEtapa: false }
  const em = (iso: string) => new Date(iso)

  test('o merge não muda nada: a demanda continua em correção até ir ao ar', () => {
    expect(estadoNoQuadro({ ...base, demanda: emCorrecao }, em('2026-11-26T18:22:00Z'), 24)).toBe(
      'em_correcao',
    )
  })
  test('no ar e ainda na espera de 24 h sem o erro', () => {
    expect(estadoNoQuadro({ ...base, demanda: noAr }, em('2026-11-26T19:49:00Z'), 24)).toBe('no_ar')
    expect(estadoNoQuadro({ ...base, demanda: noAr }, em('2026-11-27T19:47:59Z'), 24)).toBe('no_ar')
  })
  test('24 h no ar sem o erro: corrigido por mais 24 h, depois sai', () => {
    expect(estadoNoQuadro({ ...base, demanda: noAr }, em('2026-11-27T19:48:00Z'), 24)).toBe(
      'corrigido',
    )
    expect(estadoNoQuadro({ ...base, demanda: noAr }, em('2026-11-28T19:47:00Z'), 24)).toBe(
      'corrigido',
    )
    expect(estadoNoQuadro({ ...base, demanda: noAr }, em('2026-11-28T19:49:00Z'), 24)).toBe(null)
  })
  test('a espera é configurável', () => {
    expect(estadoNoQuadro({ ...base, demanda: noAr }, em('2026-11-26T21:00:00Z'), 1)).toBe(
      'corrigido',
    )
  })
  test('sem a terceira entrada vale o padrão de 24 h', () => {
    expect(estadoNoQuadro({ ...base, demanda: noAr }, em('2026-11-27T10:00:00Z'))).toBe('no_ar')
  })
  test('evento depois de ir ao ar não é no ar nem corrigido', () => {
    const voltou = { ...base, ultimoEm: em('2026-11-26T20:30:00Z') }
    expect(estadoNoQuadro({ ...voltou, demanda: noAr }, em('2026-11-26T21:00:00Z'), 24)).toBe(null)
  })
  test('corrigidoEm: o fim da espera, ou nada se o erro voltou', () => {
    expect(corrigidoEm({ noArEm, ultimoEm }, 24)).toEqual(em('2026-11-27T19:48:00Z'))
    expect(corrigidoEm({ noArEm: null, ultimoEm }, 24)).toBe(null)
    expect(corrigidoEm({ noArEm, ultimoEm: em('2026-11-26T20:00:00Z') }, 24)).toBe(null)
  })
  test('comoVoltou: na espera a correção falhou; depois dela é regressão', () => {
    expect(comoVoltou(noArEm, em('2026-11-26T22:48:00Z'), 24)).toEqual({
      horas: 3,
      antesDeCorrigir: true,
    })
    expect(comoVoltou(noArEm, em('2026-11-29T19:48:00Z'), 24)).toEqual({
      horas: 72,
      antesDeCorrigir: false,
    })
  })
})

describe('ignorada', () => {
  const ligadaEm = antes(3 * DIA)
  test.each([
    'Error: código ERELATO_TESTE',
    'GlitchTipSmokeTest',
    'Error: smoke test do deploy',
    'Error: teste de instalação',
    'Error: this is a test',
  ])('título de teste fica de fora: %s', (titulo) => {
    expect(ignorada(issue({ titulo }), ligadaEm)).toBe(true)
  })
  test.each([
    'TypeError: testemunha is undefined',
    'Error: falha no contest',
    'TypeError: re.test is not a function',
  ])('palavra que só contém teste entra: %s', (titulo) =>
    expect(ignorada(issue({ titulo }), ligadaEm)).toBe(false),
  )
  test('primeiro evento antes de ligar a fonte fica de fora', () => {
    expect(ignorada(issue({ primeiroEm: antes(4 * DIA) }), ligadaEm)).toBe(true)
  })
})

describe('grupoDoErro', () => {
  test('tabelas diferentes do mesmo erro ficam no mesmo grupo', () => {
    const a = issue({ titulo: 'PostgresError: permission denied for table aviso', onde: null })
    const b = issue({ titulo: 'PostgresError: permission denied for table recebido', onde: null })
    expect(grupoDoErro(a)).toBe(grupoDoErro(b))
  })
  test('ids, números e aspas não separam', () => {
    const a = issue({ titulo: "Error: pedido 123 'abc' a1b2c3d4e5f6 não achado" })
    const b = issue({ titulo: 'Error: pedido 98 "xyz" 0f9e8d7c6b5a não achado' })
    expect(grupoDoErro(a)).toBe(grupoDoErro(b))
  })
  test('e-mail não fica no grupo nem separa o mesmo erro', () => {
    const a = issue({ titulo: 'Usuário joao@x.com não encontrado', onde: null })
    const b = issue({ titulo: 'Usuário maria@y.com não encontrado', onde: null })
    expect(grupoDoErro(a)).toBe(grupoDoErro(b))
    expect(grupoDoErro(a)).not.toContain('@')
  })
  test('byte nulo sai do grupo', () => {
    expect(grupoDoErro(issue({ titulo: 'falhou\u0000aqui', onde: null }))).toBe('falhouaqui|')
  })
  test('lugar diferente separa', () => {
    expect(grupoDoErro(issue({ onde: 'a.ts in x' }))).not.toBe(
      grupoDoErro(issue({ onde: 'b.ts in y' })),
    )
  })
})

describe('ambientesParaLer', () => {
  const aceitos = ['production', 'producao', 'produção', 'prod', 'live']
  test('pega os de produção, sem diferença de maiúsculas', () => {
    expect(ambientesParaLer(['LIVE', 'TEST'], aceitos)).toEqual({ ler: true, filtro: ['LIVE'] })
  })
  test('sem ambiente cadastrado lê sem filtro', () => {
    expect(ambientesParaLer([], aceitos)).toEqual({ ler: true, filtro: [] })
  })
  test('com ambientes e nenhum de produção não lê', () => {
    expect(ambientesParaLer(['development'], aceitos)).toEqual({ ler: false })
  })
})

describe('estadoNoQuadro', () => {
  const base = { resolvidoEm: null, esperaDesde: null, ultimoEm: antes(60_000), voltou: false }
  const aberta = { encerrada: null, noArEm: null, naPrimeiraEtapa: true }
  test('resolvida no GlitchTip sai', () => {
    expect(estadoNoQuadro({ ...base, resolvidoEm: antes(HORA), demanda: aberta }, agora)).toBe(null)
  })
  test('sem demanda e sem espera fica em observação', () => {
    expect(estadoNoQuadro({ ...base, demanda: null }, agora)).toBe('observando')
  })
  test('em observação ou na espera sem evento há mais de 7 dias sai', () => {
    const velho = { ...base, ultimoEm: antes(8 * DIA), demanda: null }
    expect(estadoNoQuadro(velho, agora)).toBe(null)
    expect(estadoNoQuadro({ ...velho, esperaDesde: antes(8 * DIA) }, agora)).toBe(null)
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
  test('no ar há 23 h sem evento posterior está no ar; há 25 h é corrigido; há 49 h sai', () => {
    const ultimoEm = antes(60 * HORA)
    const noAr = (h: number) => ({
      encerrada: 'no_ar',
      noArEm: antes(h * HORA),
      naPrimeiraEtapa: false,
    })
    expect(estadoNoQuadro({ ...base, ultimoEm, demanda: noAr(23) }, agora)).toBe('no_ar')
    expect(estadoNoQuadro({ ...base, ultimoEm, demanda: noAr(25) }, agora)).toBe('corrigido')
    expect(estadoNoQuadro({ ...base, ultimoEm, demanda: noAr(49) }, agora)).toBe(null)
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
  test('descrição lista os erros parecidos ligados', () => {
    const d = descricaoDaDemanda(issue(), null, [
      { titulo: 'PostgresError: permission denied for table aviso', link: 'https://e/x/6' },
    ])
    expect(d).toContain('Erros parecidos nesta demanda')
    expect(d).toContain('PostgresError: permission denied for table aviso — https://e/x/6')
  })
})
