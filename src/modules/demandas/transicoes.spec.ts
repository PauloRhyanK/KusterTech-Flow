import { describe, expect, test } from 'vitest'
import {
  CONTEUDOS_ACEITOS,
  avaliarArquivo,
  aplicarEvento,
  capturaVencida,
  compararEvento,
  dadosDaRetomada,
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
  test('com nivel "vai_sozinho" numa demanda aprovar_desenho com tela: nivel trocado e recebida concluída sem espera', () => {
    const base = est({ espera: 'decidir_destino', destino: 'decisao_do_paulo' }, 'aprovar_desenho')
    const e = ok(
      ap(
        base,
        {
          tipo: 'destino_decidido',
          dados: { destino: 'urgente', nivel: 'vai_sozinho', escopo: 'x' },
        } as EventoAplicavel,
        'paulo',
      ),
    )
    expect(e.nivel).toBe('vai_sozinho')
    expect(e.etapaAtual).toBe('planejada')
    expect(e.espera).toBeNull()
  })
  test('sem nivel mantém o nível de antes (regressão)', () => {
    const base = est({ espera: 'decidir_destino', destino: 'decisao_do_paulo' }, 'aprovar_desenho')
    expect(ok(ap(base, decisao('urgente'), 'paulo')).nivel).toBe('aprovar_desenho')
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
    expect(
      ok(
        ap(
          e,
          { tipo: 'desenho_aprovado', dados: { versao: 0, peloArtefato: true } },
          'paulo',
          ctx({ artefato: 'https://claude.ai/x' }),
        ),
      ).etapaAtual,
    ).toBe('desenvolvida')
  })

  describe('planejar comigo com o artefato do Claude', () => {
    const ARTEFATO = 'https://claude.ai/a/1'
    const comArtefato = {
      tipo: 'plano_entregue',
      dados: { plano: '.fabrica/planos/a.json', resumo: null, artefato: ARTEFATO },
    } as EventoAplicavel
    const noArtefato = () => ok(ap(naPlanejada('planejar_comigo'), comArtefato, 'sessao'))
    const c = ctx({ artefato: ARTEFATO })

    test('o plano com artefato entra no desenho esperando a aprovação, na versão 0', () => {
      const e = noArtefato()
      expect(e.etapaAtual).toBe('desenho')
      expect(e.espera).toBe('aprovar_desenho')
      expect(e.versaoDoDesenho).toBe(0)
    })

    test('sem artefato o desenho é da Fábrica: entra sem espera', () => {
      const e = ok(ap(naPlanejada('planejar_comigo'), entregue as EventoAplicavel, 'sessao'))
      expect(e.etapaAtual).toBe('desenho')
      expect(e.espera).toBeNull()
    })

    test('sem tela não há desenho: o plano com artefato vai ao desenvolvimento', () => {
      const base = { ...naPlanejada('planejar_comigo') }
      const e = ok(ap(base, comArtefato, 'sessao', ctx({ temTela: false })))
      expect(e.etapaAtual).toBe('desenvolvida')
      expect(e.espera).toBeNull()
    })

    test('aprovar o artefato (versão 0) conclui o desenho e vai ao desenvolvimento', () => {
      const e = ok(
        ap(
          noArtefato(),
          { tipo: 'desenho_aprovado', dados: { versao: 0, peloArtefato: true } },
          'paulo',
          c,
        ),
      )
      expect(e.etapaAtual).toBe('desenvolvida')
      expect(e.concluidas).toContain('desenho')
      expect(e.desenhoAprovado).toBe(0)
      expect(e.espera).toBeNull()
    })

    test('a versão 0 só se aprova com o artefato', () => {
      const semArtefato = est(
        { etapaAtual: 'desenho', espera: 'aprovar_desenho', versaoDoDesenho: 0 },
        'planejar_comigo',
      )
      expect(
        recusa(ap(semArtefato, { tipo: 'desenho_aprovado', dados: { versao: 0 } }, 'paulo')),
      ).toBe('O desenho ainda não tem versão para aprovar.')
      expect(
        recusa(
          ap(semArtefato, { tipo: 'ajuste_pedido', dados: { versao: 0, texto: 'x' } }, 'paulo'),
        ),
      ).toBe('O desenho ainda não tem versão para aprovar.')
    })

    test('pedir ajuste no artefato volta a esperar a sessão, com o texto no motivo', () => {
      const e = ok(
        ap(
          noArtefato(),
          { tipo: 'ajuste_pedido', dados: { versao: 0, texto: 'botão embaixo' } },
          'paulo',
          c,
        ),
      )
      expect(e.etapaAtual).toBe('desenho')
      expect(e.espera).toBe('planejar_comigo')
      expect(e.esperaMotivo).toBe('ajuste pedido no artefato: botão embaixo')
      // a sessão entrega de novo: volta a esperar a aprovação
      const f = ok(ap(e, comArtefato, 'sessao', c))
      expect(f.espera).toBe('aprovar_desenho')
      expect(f.etapaAtual).toBe('desenho')
    })
  })
})

describe('encerrar demanda (descartada pelo Paulo)', () => {
  const encerrar = { tipo: 'encerrada_pelo_paulo', dados: {} } as EventoAplicavel

  test('em qualquer etapa aberta, o Paulo encerra como descartada e limpa a espera', () => {
    for (const base of [
      est(),
      est({ etapaAtual: 'desenho', espera: 'aprovar_desenho', versaoDoDesenho: 2 }),
      est({ etapaAtual: 'desenvolvida', espera: 'travada', esperaMotivo: 'CI' }),
    ]) {
      const e = ok(ap(base, encerrar, 'paulo'))
      expect(e.encerrada).toBe('descartada')
      expect(e.espera).toBeNull()
      expect(e.esperaMotivo).toBeNull()
      expect(e.etapaAtual).toBe(base.etapaAtual)
    }
  })

  test('só o Paulo encerra; encerrada não encerra de novo', () => {
    expect(recusa(ap(est(), encerrar, 'fabrica'))).toBe('Este evento não pode vir deste ator.')
    expect(recusa(ap(est(), encerrar, 'sessao'))).toBe('Este evento não pode vir deste ator.')
    const e = ok(ap(est(), encerrar, 'paulo'))
    expect(recusa(ap(e, encerrar, 'paulo'))).toBe('A demanda já foi encerrada.')
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

  test('retomada com resposta destrava igual à sem resposta', () => {
    const parada = { ...est(), espera: 'teste_falhou' as const, esperaMotivo: 'r' }
    const r = ok(
      ap(parada, { tipo: 'retomada', dados: { resposta: 'use o seletor novo' } }, 'paulo'),
    )
    expect(r.espera).toBeNull()
  })
})

describe('entrega parcial (o Paulo entrega o que funciona)', () => {
  const filha = { tipo: 'entrega_parcial', dados: { filha: A } } as EventoAplicavel
  const parada = () =>
    est({
      etapaAtual: 'testada',
      concluidas: ['recebida', 'planejada', 'desenho', 'desenvolvida'],
      espera: 'teste_falhou',
      esperaMotivo: 'r',
      falhasDoTeste: 2,
    })

  test('em teste_falhou conclui a testada como o teste que passa: etapa entregue, sem espera', () => {
    const e = ok(ap(parada(), filha, 'paulo'))
    expect(e.etapaAtual).toBe('entregue')
    expect(e.concluidas).toContain('testada')
    expect(e.espera).toBeNull()
    expect(e.esperaMotivo).toBeNull()
    expect(e.encerrada).toBeNull()
  })

  test('fora de teste_falhou é recusada (o segundo clique não passa)', () => {
    const entregue = ok(ap(parada(), filha, 'paulo'))
    expect(recusa(ap(entregue, filha, 'paulo'))).toBe(
      'A demanda não espera mais a decisão do teste.',
    )
    expect(ap(est({ etapaAtual: 'testada', espera: 'travada' }), filha, 'paulo').ok).toBe(false)
    expect(ap(est({ etapaAtual: 'testada' }), filha, 'paulo').ok).toBe(false)
  })

  test('só o Paulo entrega em parte', () => {
    expect(ap(parada(), filha, 'fabrica').ok).toBe(false)
    expect(ap(parada(), filha, 'sessao').ok).toBe(false)
  })
})

describe('entregue e encerrada', () => {
  test('entregue só na etapa entregue; depois de encerrada tudo é recusado', () => {
    const ev = { tipo: 'entregue', dados: { prs: [] } } as EventoAplicavel
    expect(ap(est(), ev, 'fabrica').ok).toBe(false)
    const e = ok(ap(est({ etapaAtual: 'entregue' }), ev, 'fabrica'))
    expect(e.encerrada).toBeNull()
    expect(e.etapaAtual).toBe('no_ar')
    const fim = ok(ap(e, { tipo: 'no_ar', dados: {} }, 'flow'))
    expect(fim.encerrada).toBe('no_ar')
    expect(recusa(ap(fim, { tipo: 'destravada', dados: {} }, 'fabrica'))).toBe(
      'A demanda já foi encerrada.',
    )
  })

  test('modelo sem no_ar: entregue na última etapa é recusado', () => {
    const modelo = MODELO_PADRAO.slice(0, 6)
    const ev = { tipo: 'entregue', dados: { prs: [] } } as EventoAplicavel
    expect(ap(est({ etapaAtual: 'entregue' }), ev, 'fabrica', ctx({ etapas: modelo })).ok).toBe(
      false,
    )
  })

  test('no_ar: só o Flow, e só na etapa no_ar', () => {
    const ev = { tipo: 'no_ar', dados: {} } as EventoAplicavel
    const naEtapa = est({ etapaAtual: 'no_ar' })
    expect(ap(naEtapa, ev, 'fabrica').ok).toBe(false)
    expect(ap(naEtapa, ev, 'paulo').ok).toBe(false)
    expect(ap(est({ etapaAtual: 'entregue' }), ev, 'flow').ok).toBe(false)
    expect(ok(ap(naEtapa, ev, 'flow')).encerrada).toBe('no_ar')
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

describe('esperas do Paulo e trava', () => {
  const passou = {
    tipo: 'teste',
    dados: { resultado: 'passou', resumo: 'r', capturas: [A, B] },
  } as EventoAplicavel
  const duas = ctx({
    capturas: [
      { id: A, tela: 'desktop' },
      { id: B, tela: 'celular' },
    ],
  })

  test('teste passou com a demanda em teste_falhou é recusado até a retomada', () => {
    const parada = est({ etapaAtual: 'testada', espera: 'teste_falhou', esperaMotivo: 'r' })
    expect(ap(parada, passou, 'fabrica', duas).ok).toBe(false)
    const livre = ok(ap(parada, { tipo: 'retomada', dados: {} }, 'paulo'))
    expect(ok(ap(livre, passou, 'fabrica', duas)).etapaAtual).toBe('entregue')
  })

  test.each([
    'decidir_destino',
    'aprovar_desenho',
    'planejar_comigo',
    'concluir_etapa',
    'travada',
  ] as const)('eventos da Fábrica que avançam são recusados em %s', (espera) => {
    const e = est({ etapaAtual: 'desenvolvida', espera })
    expect(ap(e, { tipo: 'etapa_concluida', dados: { marco: 'desenvolvida' } }, 'fabrica').ok).toBe(
      false,
    )
  })

  test('desenho_pronto segue permitido enquanto espera aprovar_desenho', () => {
    const e = est(
      { etapaAtual: 'desenho', espera: 'aprovar_desenho', versaoDoDesenho: 1 },
      'aprovar_desenho',
    )
    expect(
      ok(ap(e, { tipo: 'desenho_pronto', dados: { arquivoId: A } }, 'fabrica')).versaoDoDesenho,
    ).toBe(2)
  })

  test('travada guarda a espera e destravada devolve', () => {
    const e = est({ etapaAtual: 'testada', espera: 'teste_falhou', esperaMotivo: 'resumo' })
    const t = ok(ap(e, { tipo: 'travada', dados: { motivo: 'CI', url: null } }, 'fabrica'))
    expect(t.espera).toBe('travada')
    const t2 = ok(ap(t, { tipo: 'travada', dados: { motivo: 'CI de novo', url: null } }, 'fabrica'))
    expect(t2.antesDaTrava).toEqual(t.antesDaTrava)
    const d = ok(ap(t2, { tipo: 'destravada', dados: {} }, 'fabrica'))
    expect(d.espera).toBe('teste_falhou')
    expect(d.esperaMotivo).toBe('resumo')
    expect(d.antesDaTrava).toBeNull()
    const r = ok(ap(t, { tipo: 'retomada', dados: {} }, 'paulo'))
    expect(r.espera).toBe('teste_falhou')
  })

  test('o Paulo não conclui por chave uma etapa com marco', () => {
    const e = est({ etapaAtual: 'desenho' }, 'aprovar_desenho')
    expect(
      ap(e, { tipo: 'etapa_concluida_pelo_paulo', dados: { chave: 'desenho' } }, 'paulo').ok,
    ).toBe(false)
  })
})

describe('dadosDaRetomada', () => {
  test('sem resposta ou só espaços → {} (sem a chave)', () => {
    expect(dadosDaRetomada(undefined)).toEqual({ ok: true, dados: {} })
    expect(dadosDaRetomada('   ')).toEqual({ ok: true, dados: {} })
    const r = dadosDaRetomada('')
    expect(r.ok && 'resposta' in r.dados).toBe(false)
  })

  test('com resposta → aparada; acima de 2000 → recusa', () => {
    expect(dadosDaRetomada('  tente com o token novo  ')).toEqual({
      ok: true,
      dados: { resposta: 'tente com o token novo' },
    })
    expect(dadosDaRetomada('a'.repeat(2000)).ok).toBe(true)
    expect(dadosDaRetomada('a'.repeat(2001))).toEqual({
      ok: false,
      motivo: 'A resposta pode ter até 2000 caracteres.',
    })
  })

  test('a mesma resposta é repetida; outra é conflito', () => {
    const a = { tipo: 'retomada', dados: { resposta: 'x' } }
    expect(compararEvento(a, { tipo: 'retomada', dados: { resposta: 'x' } })).toBe('repetido')
    expect(compararEvento(a, { tipo: 'retomada', dados: {} })).toBe('conflito')
  })
})
