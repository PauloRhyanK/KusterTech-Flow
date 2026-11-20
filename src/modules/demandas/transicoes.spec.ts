import { describe, expect, test } from 'vitest'
import {
  CONTEUDOS_ACEITOS,
  avaliarArquivo,
  aplicarEvento,
  capturaVencida,
  compararEvento,
  jsonCanonico,
  type EventoAplicavel,
} from './transicoes'
import { MODELO_PADRAO, estadoInicial, type Ator, type EstadoDaDemanda, type Nivel } from './model'

const triagemDados = (destino: string, extra: object = {}) => ({
  tipo: 'ajuste',
  destino,
  tamanho: 'pequeno',
  mexeEm: 'x',
  risco: 'baixo',
  dados: 'nenhum',
  impacto: { toca: [], podeQuebrar: [], autorizacao: false, caminhoProtegido: false },
  resposta: null,
  motivo: 'porque sim',
  ...extra,
})

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

type Ctx = Parameters<typeof aplicarEvento>[1]
const ctx = (o: Partial<Ctx> = {}): Ctx => ({
  etapas: MODELO_PADRAO,
  temTela: true,
  capturas: [],
  ...o,
})
const est = (o: Partial<EstadoDaDemanda> = {}, nivel: Nivel = 'vai_sozinho'): EstadoDaDemanda => ({
  ...estadoInicial(MODELO_PADRAO, true, nivel),
  ...o,
})
const ap = (
  estado: EstadoDaDemanda,
  e: EventoAplicavel,
  ator: Ator,
  c: Ctx = ctx(),
): ReturnType<typeof aplicarEvento> => aplicarEvento(estado, c, { ...e, ator })
const ok = (r: ReturnType<typeof aplicarEvento>): EstadoDaDemanda => {
  if (!r.ok) throw new Error(r.motivo)
  return r.estado
}
const recusa = (r: ReturnType<typeof aplicarEvento>): string => {
  if (r.ok) throw new Error('esperava recusa')
  return r.motivo
}
const tri = (destino: string, extra: object = {}) =>
  ({ tipo: 'triagem', dados: triagemDados(destino, extra) }) as EventoAplicavel

describe('triagem', () => {
  test('fila_de_agentes em aprovar_desenho conclui a recebida e vai a planejada sem espera', () => {
    const e = ok(ap(est({}, 'aprovar_desenho'), tri('fila_de_agentes'), 'fabrica'))
    expect(e.concluidas).toEqual(['recebida'])
    expect(e.etapaAtual).toBe('planejada')
    expect(e.espera).toBeNull()
    expect(e.destino).toBe('fila_de_agentes')
  })

  test('orientada com resposta encerra; sem resposta recusa', () => {
    const e = ok(ap(est(), tri('orientada', { resposta: 'faça assim' }), 'fabrica'))
    expect(e.encerrada).toBe('orientada')
    expect(recusa(ap(est(), tri('orientada'), 'fabrica'))).toMatch(/resposta/)
  })

  test('decisao_do_paulo espera decidir_destino com o motivo; só a Fábrica na recebida', () => {
    const e = ok(ap(est(), tri('decisao_do_paulo'), 'fabrica'))
    expect(e.espera).toBe('decidir_destino')
    expect(e.esperaMotivo).toBe('porque sim')
    expect(e.destino).toBe('decisao_do_paulo')
    expect(ap(est(), tri('urgente'), 'paulo').ok).toBe(false)
    expect(ap(est({ etapaAtual: 'planejada' }), tri('urgente'), 'fabrica').ok).toBe(false)
  })

  test('triagem_falhou', () => {
    const e = ok(ap(est(), { tipo: 'triagem_falhou', dados: { motivo: 'sem rede' } }, 'fabrica'))
    expect(e.destino).toBe('decisao_do_paulo')
    expect(e.espera).toBe('decidir_destino')
    expect(e.esperaMotivo).toBe('sem rede')
  })
})

describe('destino_decidido', () => {
  const decisao = (destino: 'urgente' | 'orientada') =>
    ({ tipo: 'destino_decidido', dados: { destino } }) as EventoAplicavel
  test('fora de decidir_destino recusa', () => {
    expect(recusa(ap(est(), decisao('urgente'), 'paulo'))).toBe(
      'A demanda não espera uma decisão de destino.',
    )
  })
  test('decide e conclui a recebida; orientada encerra', () => {
    const base = est({ espera: 'decidir_destino', destino: 'decisao_do_paulo' })
    const e = ok(ap(base, decisao('urgente'), 'paulo'))
    expect(e.destino).toBe('urgente')
    expect(e.etapaAtual).toBe('planejada')
    expect(e.espera).toBeNull()
    expect(ok(ap(base, decisao('orientada'), 'paulo')).encerrada).toBe('orientada')
  })
})

describe('plano', () => {
  const criado = { tipo: 'plano_criado', dados: { plano: '.fabrica/planos/a.json', prUrl: null } }
  const entregue = {
    tipo: 'plano_entregue',
    dados: { plano: '.fabrica/planos/a.json', resumo: null, artefato: null },
  }
  const naPlanejada = (nivel: Nivel) =>
    est(
      {
        etapaAtual: 'planejada',
        concluidas: ['recebida'],
        espera: nivel === 'planejar_comigo' ? 'planejar_comigo' : null,
      },
      nivel,
    )

  test('plano_criado em planejar_comigo recusa; plano_entregue pela sessão conclui', () => {
    const base = naPlanejada('planejar_comigo')
    expect(recusa(ap(base, criado as EventoAplicavel, 'fabrica'))).toBe(
      'A etapa de planejamento espera o Paulo.',
    )
    const e = ok(ap(base, entregue as EventoAplicavel, 'sessao'))
    expect(e.concluidas).toContain('planejada')
    expect(e.etapaAtual).toBe('desenho')
  })

  test('plano_criado da Fábrica em vai_sozinho conclui', () => {
    expect(
      ok(ap(naPlanejada('vai_sozinho'), criado as EventoAplicavel, 'fabrica')).etapaAtual,
    ).toBe('desenho')
  })

  test('plano_entregue em planejar_comigo na etapa desenho passa a aprovar_desenho', () => {
    const base = est(
      { etapaAtual: 'desenho', espera: 'planejar_comigo', versaoDoDesenho: 0 },
      'planejar_comigo',
    )
    const e = ok(
      ap(
        base,
        {
          tipo: 'plano_entregue',
          dados: { plano: '.fabrica/planos/a.json', resumo: null, artefato: 'https://claude.ai/x' },
        },
        'sessao',
      ),
    )
    expect(e.espera).toBe('aprovar_desenho')
    expect(e.etapaAtual).toBe('desenho')
    expect(ok(ap(e, { tipo: 'desenho_aprovado', dados: { versao: 0 } }, 'paulo')).etapaAtual).toBe(
      'desenvolvida',
    )
  })
})

describe('desenho', () => {
  const pronto = { tipo: 'desenho_pronto', dados: { arquivoId: A } } as EventoAplicavel
  const noDesenho = (nivel: Nivel, o: Partial<EstadoDaDemanda> = {}) =>
    est({ etapaAtual: 'desenho', concluidas: ['recebida', 'planejada'], ...o }, nivel)

  test('vai_sozinho: aprova a versão 1 e segue', () => {
    const e = ok(ap(noDesenho('vai_sozinho'), pronto, 'fabrica'))
    expect(e.desenhoAprovado).toBe(1)
    expect(e.etapaAtual).toBe('desenvolvida')
    expect(e.espera).toBeNull()
  })

  test('aprovar_desenho: versão 1 espera o Paulo; aprovar conclui', () => {
    const e = ok(ap(noDesenho('aprovar_desenho'), pronto, 'fabrica'))
    expect(e.versaoDoDesenho).toBe(1)
    expect(e.espera).toBe('aprovar_desenho')
    const f = ok(ap(e, { tipo: 'desenho_aprovado', dados: { versao: 1 } }, 'paulo'))
    expect(f.desenhoAprovado).toBe(1)
    expect(f.etapaAtual).toBe('desenvolvida')
  })

  test('Review Focus 2: aprovar a versão velha é recusado', () => {
    const base = noDesenho('aprovar_desenho', { versaoDoDesenho: 3, espera: 'aprovar_desenho' })
    expect(recusa(ap(base, { tipo: 'desenho_aprovado', dados: { versao: 2 } }, 'paulo'))).toBe(
      'Há uma versão mais nova do desenho.',
    )
  })

  test('terceiro ajuste leva a planejar_comigo e o desenho_pronto depois é recusado', () => {
    let e = noDesenho('aprovar_desenho')
    for (let i = 1; i <= 3; i++) {
      e = ok(ap(e, pronto, 'fabrica'))
      e = ok(ap(e, { tipo: 'ajuste_pedido', dados: { versao: i, texto: 'mude' } }, 'paulo'))
      if (i < 3) {
        expect(e.espera).toBeNull()
        expect(e.recusasDoDesenho).toBe(i)
      }
    }
    expect(e.nivel).toBe('planejar_comigo')
    expect(e.espera).toBe('planejar_comigo')
    expect(e.esperaMotivo).toBe('desenho recusado 3 vezes')
    expect(recusa(ap(e, pronto, 'fabrica'))).toBe('O desenho agora é planejado com o Paulo.')
  })

  test('desenho_pronto fora da etapa desenho recusa', () => {
    expect(ap(est(), pronto, 'fabrica').ok).toBe(false)
  })
})

describe('etapa_concluida, travada e retomada', () => {
  test('etapa_concluida exige o marco da atual', () => {
    const base = est({ etapaAtual: 'desenvolvida' })
    expect(
      ok(ap(base, { tipo: 'etapa_concluida', dados: { marco: 'desenvolvida' } }, 'fabrica'))
        .etapaAtual,
    ).toBe('testada')
    expect(
      recusa(ap(base, { tipo: 'etapa_concluida', dados: { marco: 'entregue' } }, 'fabrica')),
    ).toBe('A etapa atual não é entregue.')
  })

  test('travada e destravada', () => {
    const t = ok(ap(est(), { tipo: 'travada', dados: { motivo: 'CI', url: null } }, 'fabrica'))
    expect(t.espera).toBe('travada')
    expect(t.esperaMotivo).toBe('CI')
    expect(ok(ap(t, { tipo: 'destravada', dados: {} }, 'fabrica')).espera).toBeNull()
    const d = est({ espera: 'decidir_destino' })
    expect(ok(ap(d, { tipo: 'destravada', dados: {} }, 'fabrica')).espera).toBe('decidir_destino')
  })

  test('etapa_concluida_pelo_paulo', () => {
    const modelo = [
      MODELO_PADRAO[0]!,
      {
        chave: 'revisao',
        nome: 'Revisão',
        rotulo: 'Revisão',
        marco: null,
        quemConclui: 'paulo' as const,
        puladaSemTela: false,
        esperaEm: [],
      },
      ...MODELO_PADRAO.slice(1),
    ]
    const base = est({ etapaAtual: 'revisao', espera: 'concluir_etapa' })
    const c = ctx({ etapas: modelo })
    const e = ok(
      ap(base, { tipo: 'etapa_concluida_pelo_paulo', dados: { chave: 'revisao' } }, 'paulo', c),
    )
    expect(e.etapaAtual).toBe('planejada')
    expect(
      ap(base, { tipo: 'etapa_concluida_pelo_paulo', dados: { chave: 'outra' } }, 'paulo', c).ok,
    ).toBe(false)
    expect(
      ap(base, { tipo: 'etapa_concluida_pelo_paulo', dados: { chave: 'revisao' } }, 'fabrica', c)
        .ok,
    ).toBe(false)
  })
})

describe('teste', () => {
  const naTestada = () => est({ etapaAtual: 'testada' })
  const teste = (resultado: 'passou' | 'falhou', capturas: string[] = []) =>
    ({ tipo: 'teste', dados: { resultado, resumo: 'r', capturas } }) as EventoAplicavel

  test('passou exige captura de desktop e de celular', () => {
    const so = ctx({ capturas: [{ id: A, tela: 'desktop' }] })
    expect(recusa(ap(naTestada(), teste('passou', [A]), 'fabrica', so))).toBe(
      'O teste precisa de capturas de desktop e celular.',
    )
    const duas = ctx({
      capturas: [
        { id: A, tela: 'desktop' },
        { id: B, tela: 'celular' },
      ],
    })
    expect(ok(ap(naTestada(), teste('passou', [A, B]), 'fabrica', duas)).etapaAtual).toBe(
      'entregue',
    )
    // capturas que o evento não cita não valem
    expect(ap(naTestada(), teste('passou', [A]), 'fabrica', duas).ok).toBe(false)
  })

  test('falhas: volta a desenvolvida, depois espera teste_falhou; retomada limpa', () => {
    const a = ok(ap(naTestada(), teste('falhou'), 'fabrica'))
    expect(a.etapaAtual).toBe('desenvolvida')
    expect(a.concluidas).not.toContain('desenvolvida')
    expect(a.falhasDoTeste).toBe(1)
    const b0 = ok(
      ap({ ...a, etapaAtual: 'testada', concluidas: ['desenvolvida'] }, teste('falhou'), 'fabrica'),
    )
    expect(b0.espera).toBe('teste_falhou')
    expect(b0.esperaMotivo).toBe('r')
    const r = ok(ap(b0, { tipo: 'retomada', dados: {} }, 'paulo'))
    expect(r.espera).toBeNull()
    expect(r.falhasDoTeste).toBe(2)
    expect(ap(est(), { tipo: 'retomada', dados: {} }, 'paulo').ok).toBe(false)
  })
})

describe('entregue e encerrada', () => {
  test('entregue só na etapa entregue; depois de encerrada tudo é recusado', () => {
    const ev = { tipo: 'entregue', dados: { prs: [] } } as EventoAplicavel
    expect(ap(est(), ev, 'fabrica').ok).toBe(false)
    const e = ok(ap(est({ etapaAtual: 'entregue' }), ev, 'fabrica'))
    expect(e.encerrada).toBe('entregue')
    expect(recusa(ap(e, { tipo: 'destravada', dados: {} }, 'fabrica'))).toBe(
      'A demanda já foi encerrada.',
    )
  })
})

describe('idempotência', () => {
  test('compararEvento e jsonCanonico', () => {
    expect(jsonCanonico({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[1,{"y":2,"z":1}],"d":2},"b":1}',
    )
    const g = { tipo: 'teste', dados: { a: 1, b: 2 } }
    expect(compararEvento(g, { tipo: 'teste', dados: { b: 2, a: 1 } })).toBe('repetido')
    expect(compararEvento(g, { tipo: 'teste', dados: { a: 1, b: 3 } })).toBe('conflito')
    expect(compararEvento(g, { tipo: 'outro', dados: { a: 1, b: 2 } })).toBe('conflito')
  })
})

describe('arquivos', () => {
  const MB = 1024 * 1024
  const base = { tipo: 'captura' as const, conteudo: 'image/png', usadoNaDemanda: 0 }
  test('limites e tipos', () => {
    expect(avaliarArquivo({ ...base, tamanho: 10 * MB }).ok).toBe(true)
    expect(avaliarArquivo({ ...base, tamanho: 10 * MB + 1 })).toEqual({
      ok: false,
      status: 413,
      erro: 'Arquivo maior que 10 MB.',
    })
    expect(avaliarArquivo({ ...base, tamanho: 6 * MB, usadoNaDemanda: 95 * MB })).toEqual({
      ok: false,
      status: 413,
      erro: 'A demanda passaria de 100 MB.',
    })
    expect(avaliarArquivo({ ...base, tipo: 'anexo', conteudo: 'text/html', tamanho: 1 })).toEqual({
      ok: false,
      status: 415,
      erro: 'Tipo de arquivo não aceito.',
    })
    expect(CONTEUDOS_ACEITOS.desenho).toContain('text/html')
  })

  test('capturaVencida', () => {
    const entrega = new Date('2026-01-01T00:00:00Z')
    const dias90 = 90 * 24 * 60 * 60_000
    const cap = { tipo: 'captura', apagadoEm: null }
    expect(capturaVencida(cap, entrega, new Date(entrega.getTime() + dias90))).toBe(false)
    expect(capturaVencida(cap, entrega, new Date(entrega.getTime() + dias90 + 1000))).toBe(true)
    expect(
      capturaVencida(
        { tipo: 'desenho', apagadoEm: null },
        entrega,
        new Date(entrega.getTime() + 2 * dias90),
      ),
    ).toBe(false)
    expect(capturaVencida(cap, null, new Date(entrega.getTime() + 2 * dias90))).toBe(false)
  })
})
