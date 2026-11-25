import { describe, expect, test } from 'vitest'
import {
  demandasQueVemAi,
  avisoDeFabricaSemBuscar,
  avisosDoImpacto,
  cabecalhoDaEntrega,
  ehDeHoje,
  faixaDaEspera,
  linkDoArtefato,
  quadrosDeImpacto,
  fluxoDeEntrada,
  grupoDaDemanda,
  iconeDoTipo,
  montarGrupos,
  rotuloDoEstado,
  textoDoEvento,
  trilho,
  type DemandaNaLista,
} from './apresentacao'
import { MODELO_PADRAO, etapasAplicaveis, type EtapaDefinida } from './model'

const AGORA = new Date('2026-11-20T15:00:00Z') // 12:00 em São Paulo
const MIN = 60_000

function demanda(parcial: Partial<DemandaNaLista> = {}): DemandaNaLista {
  return {
    id: 'd1',
    titulo: 'Tela de funil de vendas',
    tipo: 'funcao_nova',
    projeto: 'Projeto Alfa',
    etapas: [...MODELO_PADRAO],
    temTela: true,
    etapaAtual: 'recebida',
    concluidas: [],
    espera: null,
    encerrada: null,
    destino: null,
    criadaEm: new Date(AGORA.getTime() - 10 * MIN),
    esperaDesde: null,
    atualizadaEm: new Date(AGORA.getTime() - 10 * MIN),
    ...parcial,
  }
}

describe('fluxoDeEntrada', () => {
  test('12 hoje (4 flow, 8 sessao) → "12" / "você 4 · sessões 8"; lote "publica às 22:00"; vagas 3 de 5 → "3 de 5 vagas"; decisão mais antiga há 2 h → "a mais antiga: 2 h"', () => {
    const hoje = [
      ...Array.from({ length: 4 }, () => ({
        origem: 'flow' as const,
        destino: 'urgente' as const,
        encerrada: null,
      })),
      ...Array.from({ length: 3 }, () => ({
        origem: 'sessao' as const,
        destino: 'orientada' as const,
        encerrada: 'orientada',
      })),
      ...Array.from({ length: 2 }, () => ({
        origem: 'sessao' as const,
        destino: 'lote_da_noite' as const,
        encerrada: null,
      })),
      ...Array.from({ length: 2 }, () => ({
        origem: 'sessao' as const,
        destino: 'fila_de_agentes' as const,
        encerrada: null,
      })),
      { origem: 'sessao' as const, destino: null, encerrada: null },
    ]
    const quadros = fluxoDeEntrada({
      hoje,
      decidindo: [
        { esperaDesde: new Date(AGORA.getTime() - 30 * MIN) },
        { esperaDesde: new Date(AGORA.getTime() - 120 * MIN) },
      ],
      horaDoLote: '22:00',
      vagas: { ocupadas: 3, efetivas: 5 },
      agora: AGORA,
    })
    expect(quadros).toEqual([
      {
        chave: 'recebidas',
        n: 12,
        rotulo: 'Recebidas',
        meta: 'você 4 · sessões 8',
        filtro: null,
      },
      {
        chave: 'orientadas',
        n: 3,
        rotulo: 'Orientadas',
        meta: 'sem ir à Fábrica',
        filtro: 'orientada',
      },
      { chave: 'urgente', n: 4, rotulo: 'Urgente', meta: 'na frente da fila', filtro: 'urgente' },
      {
        chave: 'lote',
        n: 2,
        rotulo: 'Lote da noite',
        meta: 'publica às 22:00',
        filtro: 'lote_da_noite',
      },
      {
        chave: 'agentes',
        n: 2,
        rotulo: 'Fila de agentes',
        meta: '3 de 5 vagas',
        filtro: 'fila_de_agentes',
      },
      {
        chave: 'decisao',
        n: 2,
        rotulo: 'Decisão sua',
        meta: 'a mais antiga: 2 h',
        filtro: 'decisao_do_paulo',
      },
    ])
  })

  test('sem retrato e sem decisão: "sem notícias da Fábrica" e "nada esperando"', () => {
    const quadros = fluxoDeEntrada({
      hoje: [],
      decidindo: [],
      horaDoLote: '21:30',
      vagas: null,
      agora: AGORA,
    })
    expect(quadros.find((q) => q.chave === 'agentes')?.meta).toBe('sem notícias da Fábrica')
    expect(quadros.find((q) => q.chave === 'decisao')).toMatchObject({
      n: 0,
      meta: 'nada esperando',
    })
    expect(quadros.find((q) => q.chave === 'lote')?.meta).toBe('publica às 21:30')
  })
})

test('ehDeHoje usa o dia de America/Sao_Paulo', () => {
  // 02:30 UTC de 20/11 ainda é 19/11 em São Paulo.
  const cedo = new Date('2026-11-20T02:30:00Z')
  expect(ehDeHoje(new Date('2026-11-20T04:00:00Z'), AGORA)).toBe(true)
  expect(ehDeHoje(cedo, AGORA)).toBe(false)
})

describe('grupoDaDemanda', () => {
  test('espera aprovar_desenho → espera_voce; atual recebida sem espera → na_fila; atual desenvolvida → em_andamento; encerrada → null', () => {
    expect(grupoDaDemanda(demanda({ etapaAtual: 'desenho', espera: 'aprovar_desenho' }))).toBe(
      'espera_voce',
    )
    expect(grupoDaDemanda(demanda())).toBe('na_fila')
    expect(grupoDaDemanda(demanda({ etapaAtual: 'desenvolvida' }))).toBe('em_andamento')
    expect(grupoDaDemanda(demanda({ encerrada: 'entregue', etapaAtual: 'entregue' }))).toBeNull()
  })
})

describe('rotuloDoEstado', () => {
  test('atual testada sem espera → "Testando no navegador" tom execucao; espera travada → "Travada" tom erro', () => {
    expect(rotuloDoEstado(demanda({ etapaAtual: 'testada' }))).toEqual({
      texto: 'Testando no navegador',
      tom: 'execucao',
    })
    expect(rotuloDoEstado(demanda({ etapaAtual: 'desenvolvida', espera: 'travada' }))).toEqual({
      texto: 'Travada',
      tom: 'erro',
    })
  })

  test('esperas e marcos restantes', () => {
    const r = (p: Partial<DemandaNaLista>) => rotuloDoEstado(demanda(p))
    expect(r({ etapaAtual: 'desenho', espera: 'aprovar_desenho' })).toEqual({
      texto: 'Aprovar desenho',
      tom: 'atencao',
    })
    expect(r({ etapaAtual: 'planejada', espera: 'planejar_comigo' }).texto).toBe('Planejar comigo')
    expect(r({ espera: 'decidir_destino' }).texto).toBe('Decidir destino')
    expect(r({ etapaAtual: 'testada', espera: 'teste_falhou' })).toEqual({
      texto: 'Teste falhou',
      tom: 'erro',
    })
    expect(r({})).toEqual({ texto: 'Triagem', tom: 'neutro' })
    expect(r({ etapaAtual: 'planejada' }).texto).toBe('Planejando')
    expect(r({ etapaAtual: 'desenho' }).texto).toBe('Desenhando')
    expect(r({ etapaAtual: 'desenvolvida' }).texto).toBe('Desenvolvendo')
    expect(r({ etapaAtual: 'entregue' })).toEqual({ texto: 'Entregando', tom: 'execucao' })
    const revisao: EtapaDefinida = {
      chave: 'revisao',
      nome: 'Revisão do Paulo',
      rotulo: 'Revisão',
      marco: null,
      quemConclui: 'paulo',
      puladaSemTela: false,
      esperaEm: [],
    }
    const etapas = [...MODELO_PADRAO.slice(0, 4), revisao, ...MODELO_PADRAO.slice(4)]
    expect(r({ etapas, etapaAtual: 'revisao', espera: 'concluir_etapa' })).toEqual({
      texto: 'Concluir Revisão',
      tom: 'atencao',
    })
    expect(r({ etapas, etapaAtual: 'revisao' })).toEqual({ texto: 'Em Revisão', tom: 'execucao' })
  })
})

describe('trilho', () => {
  test('trilho sem tela tem 5 pontos; com espera aprovar_desenho o ponto de "desenho" é "espera" e os dois anteriores "feito"', () => {
    const semTela = demanda({ temTela: false })
    expect(trilho(etapasAplicaveis(semTela.etapas, false), semTela)).toHaveLength(5)

    const d = demanda({
      etapaAtual: 'desenho',
      concluidas: ['recebida', 'planejada'],
      espera: 'aprovar_desenho',
    })
    expect(trilho(etapasAplicaveis(d.etapas, true), d).map((p) => [p.chave, p.ponto])).toEqual([
      ['recebida', 'feito'],
      ['planejada', 'feito'],
      ['desenho', 'espera'],
      ['desenvolvida', 'futuro'],
      ['testada', 'futuro'],
      ['entregue', 'futuro'],
      ['no_ar', 'futuro'],
    ])
  })

  test('travada e teste_falhou viram "travado"; sem espera o atual é "atual"', () => {
    const d = demanda({ etapaAtual: 'desenvolvida', espera: 'travada' })
    const etapas = etapasAplicaveis(d.etapas, true)
    expect(trilho(etapas, d)[3]).toMatchObject({ chave: 'desenvolvida', ponto: 'travado' })
    expect(trilho(etapas, d)[2]).toMatchObject({ chave: 'desenho', ponto: 'feito' })
    const t = demanda({ etapaAtual: 'testada', espera: 'teste_falhou' })
    expect(trilho(etapas, t)[4]?.ponto).toBe('travado')
    const a = demanda({ etapaAtual: 'testada' })
    expect(trilho(etapas, a)[4]).toEqual({ chave: 'testada', rotulo: 'Testada', ponto: 'atual' })
  })
})

test('iconeDoTipo', () => {
  expect(iconeDoTipo('defeito')).toEqual({ letra: 'B', tom: 'erro' })
  expect(iconeDoTipo('ideia')).toEqual({ letra: 'I', tom: 'atencao' })
  expect(iconeDoTipo('ajuste')).toEqual({ letra: 'A', tom: 'informacao' })
  expect(iconeDoTipo('funcao_nova')).toEqual({ letra: 'F', tom: 'execucao' })
  expect(iconeDoTipo(null)).toEqual({ letra: '?', tom: 'neutro' })
})

describe('montarGrupos', () => {
  test('três grupos na ordem, linhas com link, idade sem "há" e "Na fila" urgente primeiro', () => {
    const grupos = montarGrupos(
      [
        demanda({
          id: 'espera',
          etapaAtual: 'desenho',
          concluidas: ['recebida', 'planejada'],
          espera: 'aprovar_desenho',
          esperaDesde: new Date(AGORA.getTime() - 180 * MIN),
        }),
        demanda({
          id: 'andando',
          etapaAtual: 'desenvolvida',
          atualizadaEm: new Date(AGORA.getTime() - 40 * MIN),
        }),
        demanda({ id: 'velha', criadaEm: new Date(AGORA.getTime() - 30 * MIN) }),
        demanda({
          id: 'urgente',
          destino: 'urgente',
          criadaEm: new Date(AGORA.getTime() - 5 * MIN),
        }),
        demanda({ id: 'fim', encerrada: 'entregue', etapaAtual: 'entregue' }),
      ],
      AGORA,
    )
    expect(grupos.map((g) => [g.chave, g.titulo, g.contagem])).toEqual([
      ['espera_voce', 'Espera você', '1'],
      ['em_andamento', 'Em andamento', '1'],
      ['na_fila', 'Na fila', 'entram na ordem'],
    ])
    expect(grupos[0]?.linhas[0]).toMatchObject({
      id: 'espera',
      href: '/demandas/espera',
      titulo: 'Tela de funil de vendas',
      projeto: 'Projeto Alfa',
      icone: { letra: 'F', tom: 'execucao' },
      estado: { texto: 'Aprovar desenho', tom: 'atencao' },
      idade: '3 h',
    })
    expect(grupos[1]?.linhas[0]?.idade).toBe('40 min')
    expect(grupos[2]?.linhas.map((l) => l.id)).toEqual(['urgente', 'velha'])
  })
})

describe('montarGrupos com o filtro "orientada"', () => {
  test('quarto grupo "Orientadas hoje" com as orientadas, estado "Orientada" e o ponto da triagem feito', () => {
    const orientada = demanda({
      id: 'ori',
      titulo: 'Como exportar o relatório',
      tipo: 'ideia',
      destino: 'orientada',
      encerrada: 'orientada',
      atualizadaEm: new Date(AGORA.getTime() - 20 * MIN),
    })
    const grupos = montarGrupos([], AGORA, [orientada])
    expect(grupos.map((g) => [g.chave, g.titulo, g.contagem])).toEqual([
      ['espera_voce', 'Espera você', '0'],
      ['em_andamento', 'Em andamento', '0'],
      ['na_fila', 'Na fila', 'entram na ordem'],
      ['orientadas_hoje', 'Orientadas hoje', '1'],
    ])
    expect(grupos[3]?.linhas[0]).toMatchObject({
      id: 'ori',
      href: '/demandas/ori',
      estado: { texto: 'Orientada', tom: 'neutro' },
      idade: '20 min',
    })
    expect(grupos[3]?.linhas[0]?.trilho[0]?.ponto).toBe('feito')
    expect(montarGrupos([], AGORA)).toHaveLength(3)
  })
})

describe('avisoDeFabricaSemBuscar', () => {
  test('recebida parada e Fábrica sem buscar há 12 min → "a Fábrica não busca há 12 min"', () => {
    expect(
      avisoDeFabricaSemBuscar(
        {
          buscouEm: new Date(AGORA.getTime() - 12 * MIN),
          recebidasParadas: 1,
          recebidaMaisAntigaDesde: new Date(AGORA.getTime() - 15 * MIN),
        },
        AGORA,
      ),
    ).toBe('a Fábrica não busca há 12 min')
  })

  test('nunca buscou → "a Fábrica nunca buscou demandas"; recebida recente ou nenhuma → null', () => {
    const antiga = new Date(AGORA.getTime() - 15 * MIN)
    expect(
      avisoDeFabricaSemBuscar(
        { buscouEm: null, recebidasParadas: 2, recebidaMaisAntigaDesde: antiga },
        AGORA,
      ),
    ).toBe('a Fábrica nunca buscou demandas')
    expect(
      avisoDeFabricaSemBuscar(
        {
          buscouEm: null,
          recebidasParadas: 1,
          recebidaMaisAntigaDesde: new Date(AGORA.getTime() - 2 * MIN),
        },
        AGORA,
      ),
    ).toBeNull()
    expect(
      avisoDeFabricaSemBuscar(
        { buscouEm: null, recebidasParadas: 0, recebidaMaisAntigaDesde: null },
        AGORA,
      ),
    ).toBeNull()
  })
})

const TRIAGEM = {
  tamanho: 'medio' as const,
  mexeEm: '2 telas, 1 rota',
  risco: 'baixo' as const,
  dados: 'so_leitura' as const,
  impacto: {
    podeQuebrar: ['a exportação do funil'],
    autorizacao: true,
    caminhoProtegido: false,
  },
}

describe('quadrosDeImpacto', () => {
  test('quadrosDeImpacto: medio, "2 telas, 1 rota", baixo, so_leitura → Médio / 2 telas, 1 rota / Baixo / Só leitura', () => {
    expect(quadrosDeImpacto(TRIAGEM)).toEqual([
      { rotulo: 'Tamanho', valor: 'Médio' },
      { rotulo: 'Mexe em', valor: '2 telas, 1 rota' },
      { rotulo: 'Risco', valor: 'Baixo' },
      { rotulo: 'Dados', valor: 'Só leitura' },
    ])
  })

  test('os outros valores e sem triagem → []', () => {
    expect(
      quadrosDeImpacto({ ...TRIAGEM, tamanho: 'grande', risco: 'alto', dados: 'migracao' }).map(
        (q) => q.valor,
      ),
    ).toEqual(['Grande', '2 telas, 1 rota', 'Alto', 'Migração'])
    expect(
      quadrosDeImpacto({ ...TRIAGEM, tamanho: 'pequeno', risco: 'medio', dados: 'nenhum' }).map(
        (q) => q.valor,
      ),
    ).toEqual(['Pequeno', '2 telas, 1 rota', 'Médio', 'Nenhum'])
    expect(quadrosDeImpacto({ ...TRIAGEM, dados: 'escrita' })[3]?.valor).toBe('Escrita')
    expect(quadrosDeImpacto(null)).toEqual([])
  })

  test('avisosDoImpacto: pode quebrar e as pílulas de autorização e caminho protegido', () => {
    expect(avisosDoImpacto(TRIAGEM)).toEqual({
      podeQuebrar: ['a exportação do funil'],
      pilulas: ['mexe em autorização'],
    })
    expect(
      avisosDoImpacto({
        ...TRIAGEM,
        impacto: { podeQuebrar: [], autorizacao: true, caminhoProtegido: true },
      }).pilulas,
    ).toEqual(['mexe em autorização', 'caminho protegido'])
    expect(avisosDoImpacto(null)).toEqual({ podeQuebrar: [], pilulas: [] })
  })
})

describe('faixaDaEspera', () => {
  const base = {
    id: '6f1c2b8e-0000-4000-8000-000000000001',
    espera: null,
    esperaMotivo: null,
    versaoDoDesenho: 2,
    ultimoAjuste: null,
    urlDaTrava: null,
    etapaAtual: 'desenho',
    etapas: [...MODELO_PADRAO],
  }

  test('travada por pergunta do orquestrador → campo de resposta e contexto', () => {
    const motivo = 'o orquestrador perguntou (responda ao tentar de novo): Pergunta ao Paulo'
    expect(faixaDaEspera({ ...base, espera: 'travada', esperaMotivo: motivo }, AGORA)).toEqual({
      titulo: motivo,
      contexto:
        'Leia a pergunta no PR e responda abaixo. Sem resposta, ele segue o caminho padrão que propôs.',
      acoes: ['retomar'],
      responder: true,
    })
    expect(
      faixaDaEspera({ ...base, espera: 'travada', esperaMotivo: 'CI vermelho' }, AGORA)?.responder,
    ).toBeUndefined()
  })

  test('travada com url do GitHub → prUrl; url de fora do GitHub ou sem https → sem link', () => {
    const pr = 'https://github.com/kustertech-exemplo/alfa/pull/7'
    expect(
      faixaDaEspera(
        { ...base, espera: 'travada', esperaMotivo: 'CI vermelho', urlDaTrava: pr },
        AGORA,
      ),
    ).toEqual({ titulo: 'CI vermelho', contexto: '', acoes: ['retomar'], prUrl: pr })
    for (const url of [
      'http://github.com/a/b/pull/1',
      'https://github.com.mal.io/a/b/pull/1',
      'https://evil.com/a',
      'javascript:alert(1)',
      'https://user:x@github.com/a/b/pull/1',
    ]) {
      expect(
        faixaDaEspera({ ...base, espera: 'travada', urlDaTrava: url }, AGORA)?.prUrl,
      ).toBeUndefined()
    }
    // Só a travada mostra o link.
    expect(
      faixaDaEspera({ ...base, espera: 'teste_falhou', urlDaTrava: pr }, AGORA)?.prUrl,
    ).toBeUndefined()
  })

  test('faixaDaEspera aprovar_desenho com ajuste ontem → contexto "versão 2 · ajuste pedido ontem: \"menos texto no topo\"" e ações aprovar e ajuste', () => {
    const faixa = faixaDaEspera(
      {
        ...base,
        espera: 'aprovar_desenho',
        ultimoAjuste: { texto: 'menos texto no topo', em: new Date('2026-11-19T18:00:00Z') },
      },
      AGORA,
    )
    expect(faixa).toEqual({
      titulo: 'O desenho está pronto para você aprovar',
      contexto: 'versão 2 · ajuste pedido ontem: "menos texto no topo"',
      acoes: ['aprovar', 'ajuste'],
    })
  })

  test('aprovar_desenho sem ajuste → "versão N"; ajuste hoje → "há 2 h"', () => {
    expect(faixaDaEspera({ ...base, espera: 'aprovar_desenho' }, AGORA)?.contexto).toBe('versão 2')
    expect(
      faixaDaEspera(
        {
          ...base,
          espera: 'aprovar_desenho',
          ultimoAjuste: { texto: 'mais contraste', em: new Date(AGORA.getTime() - 120 * MIN) },
        },
        AGORA,
      )?.contexto,
    ).toBe('versão 2 · ajuste pedido há 2 h: "mais contraste"')
  })

  test('as outras esperas: textos e ações; sem espera → null', () => {
    expect(faixaDaEspera({ ...base, espera: 'planejar_comigo' }, AGORA)).toEqual({
      titulo: 'Esta demanda espera uma sessão de planejamento com você',
      contexto: `Na sessão do Claude Code do projeto, use o id ${base.id}`,
      acoes: [],
    })
    expect(
      faixaDaEspera({ ...base, espera: 'decidir_destino', esperaMotivo: 'pode ir de dia' }, AGORA),
    ).toEqual({
      titulo: 'A triagem deixou o destino com você',
      contexto: 'pode ir de dia',
      acoes: ['destino'],
    })
    expect(
      faixaDaEspera({ ...base, espera: 'travada', esperaMotivo: 'CI vermelho no PR' }, AGORA),
    ).toEqual({ titulo: 'CI vermelho no PR', contexto: '', acoes: ['retomar'] })
    expect(
      faixaDaEspera({ ...base, espera: 'teste_falhou', esperaMotivo: 'botão sumiu' }, AGORA),
    ).toEqual({
      titulo: 'O teste no navegador falhou duas vezes',
      contexto: 'botão sumiu',
      acoes: ['retomar'],
    })
    const extra: EtapaDefinida = {
      chave: 'revisao',
      nome: 'Revisão do Paulo',
      rotulo: 'Revisão',
      marco: null,
      quemConclui: 'paulo',
      puladaSemTela: false,
      esperaEm: ['planejar_comigo', 'aprovar_desenho', 'vai_sozinho'],
    }
    expect(
      faixaDaEspera(
        {
          ...base,
          espera: 'concluir_etapa',
          etapaAtual: 'revisao',
          etapas: [...MODELO_PADRAO, extra],
        },
        AGORA,
      ),
    ).toEqual({
      titulo: 'Conclua Revisão quando estiver pronto',
      contexto: '',
      acoes: ['concluir'],
    })
    expect(faixaDaEspera(base, AGORA)).toBeNull()
  })
})

describe('cabecalhoDaEntrega', () => {
  test('cabecalhoDaEntrega: publicado há 2 h → "✓ Entregue · no ar há 2 h"', () => {
    expect(
      cabecalhoDaEntrega(
        {
          estado: 'publicado',
          commit: '9d2e41b0',
          noArDesde: new Date(AGORA.getTime() - 120 * MIN),
        },
        AGORA,
      ),
    ).toBe('✓ Entregue · no ar há 2 h')
  })

  test('na fila ou publicando → "publicação na fila"; sem pedido → "✓ Entregue"', () => {
    for (const estado of ['na_fila', 'verificando', 'publicando'] as const) {
      expect(cabecalhoDaEntrega({ estado, commit: null, noArDesde: null }, AGORA)).toBe(
        '✓ Entregue · publicação na fila',
      )
    }
    expect(cabecalhoDaEntrega(null, AGORA)).toBe('✓ Entregue')
    expect(cabecalhoDaEntrega({ estado: 'falhou', commit: null, noArDesde: null }, AGORA)).toBe(
      '✓ Entregue',
    )
  })
})

describe('linkDoArtefato', () => {
  test('só https de claude.ai passa; o resto vira null', () => {
    expect(linkDoArtefato('https://claude.ai/public/artifacts/abc')).toBe(
      'https://claude.ai/public/artifacts/abc',
    )
    for (const url of [
      null,
      'http://claude.ai/x',
      'https://claude.ai.exemplo.test/x',
      'https://user@claude.ai/x',
      'javascript:alert(1)',
      'https://claude.ai:8443/x',
      'https://exemplo.test/claude.ai/',
    ]) {
      expect(linkDoArtefato(url)).toBeNull()
    }
  })
})

describe('artefato do Claude e demanda encerrada (C1 e I3)', () => {
  test('aprovar_desenho na versão 0 é o artefato: título e contexto próprios, com aprovar e ajuste', () => {
    expect(
      faixaDaEspera(
        {
          id: '6f1c2b8e-0000-4000-8000-000000000001',
          espera: 'aprovar_desenho',
          esperaMotivo: null,
          versaoDoDesenho: 0,
          ultimoAjuste: null,
          urlDaTrava: null,
          etapaAtual: 'desenho',
          etapas: [...MODELO_PADRAO],
        },
        new Date('2026-11-20T12:00:00Z'),
      ),
    ).toEqual({
      titulo: 'O artefato do Claude está pronto para você aprovar',
      contexto: 'O desenho é o artefato da sessão: abra o link abaixo',
      acoes: ['aprovar', 'ajuste'],
    })
  })

  test('histórico: aprovação e ajuste do artefato e o encerramento', () => {
    expect(textoDoEvento('desenho_aprovado', { versao: 0, peloArtefato: true })).toBe(
      'Desenho aprovado (artefato do Claude)',
    )
    expect(textoDoEvento('ajuste_pedido', { versao: 0, texto: 'x' })).toBe(
      'Ajuste pedido (artefato do Claude)',
    )
    expect(textoDoEvento('desenho_aprovado', { versao: 2 })).toBe('Desenho aprovado (versão 2)')
    expect(textoDoEvento('encerrada_pelo_paulo', {})).toBe('Demanda encerrada')
  })

  test('histórico: retomada com resposta mostra o texto, truncado em 120', () => {
    expect(textoDoEvento('retomada', {})).toBe('Retomada')
    expect(textoDoEvento('retomada', { resposta: 'use o token novo' })).toBe(
      'Retomada com resposta: use o token novo',
    )
    const longa = textoDoEvento('retomada', { resposta: 'a'.repeat(300) })
    expect(longa).toBe(`Retomada com resposta: ${'a'.repeat(120)}…`)
  })

  test('descartada: rótulo "Encerrada" neutro e fora dos grupos', () => {
    const d = demanda({ etapaAtual: 'desenvolvida', encerrada: 'descartada' })
    expect(rotuloDoEstado(d)).toEqual({ texto: 'Encerrada', tom: 'neutro' })
    expect(grupoDaDemanda(d)).toBeNull()
  })
})

describe('demandasQueVemAi', () => {
  // A tela Publicação mostra o que a Fábrica ainda está fazendo: o que espera você primeiro, depois o que anda.
  test('só as abertas; espera você, depois em andamento, depois triagem; cada uma com o estado', () => {
    const lista = demandasQueVemAi([
      demanda({ id: 'triagem', titulo: 'Nova', etapaAtual: 'recebida' }),
      demanda({
        id: 'andando',
        titulo: 'Bot de áudio',
        etapaAtual: 'desenvolvida',
        concluidas: ['recebida', 'planejada', 'desenho'],
      }),
      demanda({ id: 'entregue', encerrada: 'entregue', etapaAtual: 'entregue' }),
      demanda({
        id: 'espera',
        titulo: 'CRM',
        etapaAtual: 'desenho',
        espera: 'aprovar_desenho',
        concluidas: ['recebida', 'planejada'],
      }),
    ])
    expect(lista.map((d) => [d.id, d.estado.texto])).toEqual([
      ['espera', 'Aprovar desenho'],
      ['andando', 'Desenvolvendo'],
      ['triagem', 'Triagem'],
    ])
    expect(lista[1]).toMatchObject({ titulo: 'Bot de áudio', projeto: 'Projeto Alfa' })
  })
})
