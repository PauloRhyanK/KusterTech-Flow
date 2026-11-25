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
  grupoDaDemanda,
  iconeDoTipo,
  cartoesDasPartes,
  chipsDasPartes,
  faixaDoQueFalta,
  montarGrupos,
  ordemDePublicacao,
  quadrosAteOAr,
  trilhoDaDemanda,
  rotuloDoEstado,
  textoDoEvento,
  type DemandaNaLista,
} from './apresentacao'
import { MODELO_PADRAO, type EtapaDefinida } from './model'
import type { Parte } from './partes'

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
    partes: [],
    naoChegouDesde: null,
    noArEm: null,
    desenhoAprovado: null,
    ...parcial,
  }
}

function parte(chave: string, parcial: Partial<Parte> = {}): Parte {
  return {
    chave,
    repositorio: `exemplo/alfa-${chave}`,
    objetivo: '',
    ordem: 1,
    dependeDe: [],
    chegaAoAr: 'publicacao',
    estado: 'planejando',
    prs: [],
    commitAlvo: null,
    commitNoAr: null,
    motivo: null,
    feitaEm: null,
    noArEm: null,
    temPedido: false,
    ...parcial,
  }
}

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

test('iconeDoTipo', () => {
  expect(iconeDoTipo('defeito')).toEqual({ letra: 'B', tom: 'erro' })
  expect(iconeDoTipo('ideia')).toEqual({ letra: 'I', tom: 'atencao' })
  expect(iconeDoTipo('ajuste')).toEqual({ letra: 'A', tom: 'informacao' })
  expect(iconeDoTipo('funcao_nova')).toEqual({ letra: 'F', tom: 'execucao' })
  expect(iconeDoTipo(null)).toEqual({ letra: '?', tom: 'neutro' })
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

describe('montarGrupos até o ar', () => {
  const triada = {
    etapaAtual: 'entregue',
    concluidas: ['recebida', 'planejada', 'desenho', 'desenvolvida', 'testada'],
  }
  const lista = () => [
    demanda({
      id: 'espera',
      etapaAtual: 'desenho',
      concluidas: ['recebida', 'planejada'],
      espera: 'aprovar_desenho',
      esperaDesde: new Date(AGORA.getTime() - 4 * 24 * 60 * MIN),
      partes: [parte('alfa')],
    }),
    demanda({
      id: 'falta',
      titulo: 'Modo editor com IA',
      ...triada,
      naoChegouDesde: new Date(AGORA.getTime() - 24 * 60 * MIN),
      partes: [
        parte('front', {
          ordem: 2,
          dependeDe: ['back'],
          estado: 'nao_chegou',
          motivo: 'Publicação dispensada',
        }),
        parte('back', { ordem: 1 }),
      ],
    }),
    demanda({
      id: 'andando',
      ...triada,
      atualizadaEm: new Date(AGORA.getTime() - 2 * MIN),
      partes: [parte('back', { estado: 'publicando', motivo: 'Conferindo o site' })],
    }),
    demanda({
      id: 'triagem',
      partes: [parte('alfa')],
    }),
    demanda({
      id: 'noar',
      ...triada,
      encerrada: 'no_ar',
      noArEm: new Date(AGORA.getTime() - 60 * MIN),
      partes: [parte('front', { estado: 'no_ar', commitNoAr: 'c5c01ba9f00', noArEm: AGORA })],
    }),
    demanda({ id: 'velha', encerrada: 'no_ar', noArEm: new Date('2026-10-01T12:00:00Z') }),
    demanda({ id: 'orientada', encerrada: 'orientada' }),
  ]

  test('Espera você no topo, depois Não chegou ao ar, A caminho e No ar; no ar há mais de 30 dias e orientada ficam fora', () => {
    const grupos = montarGrupos(lista(), AGORA)
    expect(grupos.map((g) => [g.chave, g.titulo, g.contagem])).toEqual([
      ['espera_voce', 'Espera você', '1'],
      ['nao_chegou', 'Não chegou ao ar', '1'],
      ['a_caminho', 'A caminho', '2'],
      ['no_ar', 'No ar', '1'],
    ])
    expect(grupos[2]?.linhas.map((l) => l.id)).toEqual(['andando', 'triagem'])
  })

  test('linha: chips das partes na ordem de publicação, trilho de 4 pontos, frase e idade', () => {
    const grupos = montarGrupos(lista(), AGORA)
    expect(grupos[1]?.linhas[0]).toEqual({
      id: 'falta',
      href: '/demandas/falta',
      titulo: 'Modo editor com IA',
      projeto: 'Projeto Alfa',
      partes: [
        { chave: 'back', texto: 'planejando', tom: 'neutro' },
        { chave: 'front', texto: 'dispensada', tom: 'nao' },
      ],
      trilho: ['cheio', 'cheio', 'andando', 'vermelho'],
      estado: { texto: 'Falta a parte do back', tom: 'erro' },
      idade: '1 d',
    })
    expect(grupos[2]?.linhas[0]).toMatchObject({
      estado: { texto: 'Conferindo o site', tom: 'execucao' },
      trilho: ['cheio', 'cheio', 'cheio', 'andando'],
      idade: '2 min',
    })
    // Sem motivo, a caminho fala da etapa, não de "falta".
    expect(grupos[2]?.linhas[1]?.estado).toEqual({ texto: 'Triagem', tom: 'neutro' })
    expect(
      montarGrupos([demanda({ id: 'nova', atualizadaEm: AGORA })], AGORA)[2]?.linhas[0]?.idade,
    ).toBe('agora')
    expect(grupos[2]?.linhas[1]?.trilho).toEqual(['andando', 'vazio', 'vazio', 'vazio'])
    expect(grupos[3]?.linhas[0]).toMatchObject({
      estado: { texto: 'No ar · c5c01ba', tom: 'sucesso' },
      partes: [{ chave: 'front', texto: 'no ar', tom: 'ok' }],
      trilho: ['cheio', 'cheio', 'cheio', 'verde'],
      idade: 'hoje',
    })
    expect(grupos[0]?.linhas[0]).toMatchObject({
      estado: { texto: 'Aprovar desenho', tom: 'atencao' },
      idade: '4 d',
    })
  })

  test('com o filtro "orientada": grupo "Orientadas hoje" no fim', () => {
    const orientada = demanda({
      id: 'ori',
      destino: 'orientada',
      encerrada: 'orientada',
      atualizadaEm: new Date(AGORA.getTime() - 20 * MIN),
    })
    const grupos = montarGrupos([], AGORA, [orientada])
    expect(grupos.map((g) => g.chave)).toEqual([
      'espera_voce',
      'nao_chegou',
      'a_caminho',
      'no_ar',
      'orientadas_hoje',
    ])
    expect(grupos[4]?.linhas[0]).toMatchObject({
      id: 'ori',
      estado: { texto: 'Orientada', tom: 'neutro' },
      idade: '20 min',
    })
  })
})

test('trilhoDaDemanda: orientada para na triagem; entregue antiga tem tudo feito, sem o verde', () => {
  expect(trilhoDaDemanda(demanda({ encerrada: 'orientada' }))).toEqual([
    'cheio',
    'vazio',
    'vazio',
    'vazio',
  ])
  expect(trilhoDaDemanda(demanda({ encerrada: 'entregue', etapaAtual: 'entregue' }))).toEqual([
    'cheio',
    'cheio',
    'cheio',
    'cheio',
  ])
})

describe('quadrosAteOAr', () => {
  test('quatro números na ordem do desenho, com as metas; Espera você conta a mais antiga', () => {
    const grupos = montarGrupos(
      [
        demanda({
          id: 'e',
          espera: 'travada',
          esperaDesde: new Date(AGORA.getTime() - 4 * 24 * 60 * MIN),
        }),
        demanda({ id: 'a' }),
        demanda({ id: 'b' }),
      ],
      AGORA,
    )
    expect(quadrosAteOAr(grupos)).toEqual([
      { chave: 'no_ar', numero: 0, rotulo: 'No ar', meta: 'conferidas no site' },
      { chave: 'a_caminho', numero: 2, rotulo: 'A caminho', meta: 'Fábrica trabalhando' },
      { chave: 'nao_chegou', numero: 0, rotulo: 'Não chegou ao ar', meta: 'feita, mas falta algo' },
      { chave: 'espera_voce', numero: 1, rotulo: 'Espera você', meta: 'há 4 d' },
    ])
    expect(quadrosAteOAr(montarGrupos([], AGORA))[3]?.meta).toBe('nada esperando')
  })
})

describe('chipsDasPartes', () => {
  test('estado curto por parte; descartada some; dependência fora do ar não muda o chip', () => {
    expect(
      chipsDasPartes([
        parte('a', { estado: 'em_curso' }),
        parte('b', { estado: 'feita' }),
        parte('c', { estado: 'nao_chegou', motivo: 'Nunca foi publicada' }),
        parte('d', { estado: 'nao_chegou', motivo: 'PR aberto há 1 d' }),
        parte('e', { estado: 'nao_chegou', motivo: 'Publicada sem conferir o site' }),
        parte('f', { estado: 'nao_chegou', motivo: 'Publicação falhou' }),
        parte('g', { estado: 'descartada' }),
      ]),
    ).toEqual([
      { chave: 'a', texto: 'em curso', tom: 'andando' },
      { chave: 'b', texto: 'feita', tom: 'neutro' },
      { chave: 'c', texto: 'sem publicação', tom: 'nao' },
      { chave: 'd', texto: 'PR aberto', tom: 'nao' },
      { chave: 'e', texto: 'sem conferir', tom: 'nao' },
      { chave: 'f', texto: 'falhou', tom: 'nao' },
    ])
  })
})

describe('ordemDePublicacao', () => {
  test('segue dependeDe, desempata pela ordem; uma parte só → null', () => {
    const back = parte('back', { ordem: 2 })
    const front = parte('front', { ordem: 1, dependeDe: ['back'] })
    expect(ordemDePublicacao([front, back]).map((p) => p.chave)).toEqual(['back', 'front'])
    expect(
      ordemDePublicacao([parte('z', { ordem: 2 }), parte('y', { ordem: 1 })]).map((p) => p.chave),
    ).toEqual(['y', 'z'])
  })
})

describe('faixaDoQueFalta', () => {
  test('só com a demanda em "não chegou ao ar": a parte mais atrasada e o que a Fábrica faz', () => {
    const partes = [
      parte('back', { ordem: 1, objetivo: 'aba, IA e envio' }),
      parte('front', {
        ordem: 2,
        dependeDe: ['back'],
        estado: 'nao_chegou',
        motivo: 'Publicação dispensada',
      }),
    ]
    expect(faixaDoQueFalta({ grupo: 'nao_chegou', partes, podeConferir: true })).toEqual({
      titulo: 'Falta: a parte do back (aba, IA e envio)',
      contexto: 'A Fábrica está planejando essa parte. A demanda só fecha com as 2 partes no ar.',
      conferir: null,
    })
    expect(faixaDoQueFalta({ grupo: 'a_caminho', partes, podeConferir: true })).toBeNull()
  })

  test('parte publicada sem conferir: o motivo e a ação "Conferi no ar" (só uma, e só quem pode)', () => {
    const partes = [
      parte('alfa', { estado: 'nao_chegou', motivo: 'Publicada sem conferir o site' }),
    ]
    expect(faixaDoQueFalta({ grupo: 'nao_chegou', partes, podeConferir: true })).toEqual({
      titulo: 'Falta: a parte do alfa',
      contexto: 'Publicada sem conferir o site.',
      conferir: 'alfa',
    })
    expect(faixaDoQueFalta({ grupo: 'nao_chegou', partes, podeConferir: false })?.conferir).toBe(
      null,
    )
    const versao = [parte('nucleo', { estado: 'nao_chegou', chegaAoAr: 'versao', motivo: 'x' })]
    expect(
      faixaDoQueFalta({ grupo: 'nao_chegou', partes: versao, podeConferir: true })?.conferir,
    ).toBe('nucleo')
  })
})

describe('cartoesDasPartes', () => {
  test('um cartão por parte na ordem de publicação, com os passos e os links do GitHub', () => {
    const cartoes = cartoesDasPartes(
      [
        parte('front', {
          ordem: 1,
          dependeDe: ['back'],
          estado: 'nao_chegou',
          motivo: 'Publicação dispensada',
          prs: [
            {
              url: 'https://github.com/exemplo/alfa-front/pull/12',
              repositorio: 'exemplo/alfa-front',
              numero: 12,
              estado: 'mergeado',
              mergeCommit: null,
            },
          ],
        }),
        parte('back', { ordem: 2 }),
      ],
      { planos: {}, consertos: {}, pedidos: {}, conferidas: {} },
    )
    expect(cartoes.map((c) => [c.titulo, c.repositorio, c.estado])).toEqual([
      ['1 · Back', 'alfa-back', { texto: 'planejando', tom: 'neutro' }],
      ['2 · Front', 'alfa-front', { texto: 'espera o back', tom: 'andando' }],
    ])
    expect(cartoes[0]?.passos.map((p) => [p.rotulo, p.ponto])).toEqual([
      ['Plano da parte', 'andando'],
      ['PRs mergeados', 'vazio'],
      ['Publicada e conferida no site', 'vazio'],
    ])
    expect(cartoes[1]?.passos.map((p) => [p.rotulo, p.ponto])).toEqual([
      ['Plano da parte', 'cheio'],
      ['PRs mergeados', 'cheio'],
      ['Publicação dispensada', 'vermelho'],
    ])
    expect(cartoes[1]?.passos[1]?.links).toEqual([
      { texto: '#12', href: 'https://github.com/exemplo/alfa-front/pull/12' },
    ])
  })

  test('publicando com conserto: "Consertando a publicação" e o PR do conserto; no ar conferida por você', () => {
    const [cartao] = cartoesDasPartes(
      [parte('back', { estado: 'publicando', motivo: 'Consertando a publicação' })],
      {
        planos: { back: 'https://github.com/exemplo/alfa-back/pull/3' },
        consertos: { back: 'https://github.com/exemplo/alfa-back/pull/9' },
        pedidos: { back: 'publicando' },
        conferidas: {},
      },
    )
    expect(cartao?.passos[0]?.links).toEqual([
      { texto: 'plano', href: 'https://github.com/exemplo/alfa-back/pull/3' },
    ])
    expect(cartao?.passos[2]).toEqual({
      rotulo: 'Consertando a publicação',
      ponto: 'andando',
      detalhe: 'publicando',
      links: [{ texto: 'conserto', href: 'https://github.com/exemplo/alfa-back/pull/9' }],
    })
    const [noAr] = cartoesDasPartes(
      [
        parte('back', {
          estado: 'no_ar',
          commitNoAr: 'abcdef1234',
          noArEm: new Date('2026-11-24T15:00:00Z'),
        }),
      ],
      { planos: {}, consertos: {}, pedidos: {}, conferidas: { back: true } },
    )
    expect(noAr?.passos[2]).toEqual({
      rotulo: 'No ar · abcdef1',
      ponto: 'verde',
      detalhe: 'conferida por você · 24/11',
      links: [],
    })
  })
})

test('histórico: eventos das partes e "conferida pelo Paulo"', () => {
  expect(textoDoEvento('no_ar', {})).toBe('No ar')
  expect(textoDoEvento('parte_feita', { chave: 'back' })).toBe('Parte back feita')
  expect(textoDoEvento('parte_conferida_pelo_paulo', { chave: 'back' })).toBe(
    'Parte back conferida pelo Paulo',
  )
})
