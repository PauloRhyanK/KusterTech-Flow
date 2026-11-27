import { describe, expect, it } from 'vitest'
import {
  pedidoDaDemanda,
  amanhaAsSeis,
  chaveDaDemanda,
  chaveDaIssue,
  chaveDaPublicacao,
  chaveValida,
  montarPilha,
  numeroDoPrDaTrava,
  travaDeCorrecao,
  motivosDaIssue,
  respostasDoItem,
  textoDaTrava,
  trechosComLink,
  tipoDaDecisao,
  tipoDaDemanda,
  type DecisaoDoRetrato,
  type AvisoDaPublicacaoNaPilha,
  type DemandaEsperando,
  type MarcaDaConversa,
} from './model'

const AGORA = new Date('2026-11-21T15:00:00Z')

function demanda(o: Partial<DemandaEsperando> = {}): DemandaEsperando {
  return {
    id: 'd1',
    titulo: 'Corrigir o cadastro',
    projeto: 'Projeto Alfa',
    repositorio: 'kustertech-exemplo/alfa',
    tipo: 'defeito',
    origem: 'flow',
    nivel: 'vai_sozinho',
    espera: 'decidir_destino',
    esperaMotivo: null,
    urlDaTrava: null,
    desfecho: null,
    esperaDesde: new Date('2026-11-21T12:00:00Z'),
    versaoDoDesenho: 0,
    etapaAtual: 'triagem',
    rotuloDaEtapa: 'Triagem',
    descricao: null,
    anexos: 0,
    triagem: { tamanho: 'Pequeno', mexeEm: 'Cadastro', motivo: 'm', destino: 'fila' },
    ...o,
  }
}

function decisao(o: Partial<DecisaoDoRetrato> = {}): DecisaoDoRetrato {
  return {
    titulo: '[fábrica] orquestrador: pergunta para o Paulo',
    url: 'https://github.com/kustertech-exemplo/alfa/issues/7',
    planoId: 'p1',
    repo: 'kustertech-exemplo/alfa',
    feature: 'cadastro',
    faseAtual: null,
    raias: { concluidas: 0, total: 0 },
    ...o,
  }
}

function marca(chave: string, o: Partial<MarcaDaConversa> = {}): MarcaDaConversa {
  return { chave, encerrada: false, guardadaEm: null, adiadaAte: null, puladaEm: null, ...o }
}

const nomeDoProjeto = () => 'Projeto Alfa'
const pilha = (e: Partial<Parameters<typeof montarPilha>[0]>) =>
  montarPilha({ demandas: [], decisoes: [], marcas: [], agora: AGORA, nomeDoProjeto, ...e })

describe('tipoDaDemanda', () => {
  it('mapeia as esperas', () => {
    expect(tipoDaDemanda(demanda({ espera: 'travada' }))).toBe('trava')
    expect(tipoDaDemanda(demanda({ espera: 'teste_falhou' }))).toBe('trava')
    expect(tipoDaDemanda(demanda({ espera: 'aprovar_desenho' }))).toBe('desenho')
    expect(tipoDaDemanda(demanda({ espera: 'concluir_etapa' }))).toBe('concluir_etapa')
    expect(tipoDaDemanda(demanda())).toBe('pedido')
    expect(tipoDaDemanda(demanda({ triagem: null }))).toBe('nao_classificada')
    expect(tipoDaDemanda(demanda({ tipo: null }))).toBe('nao_classificada')
    expect(tipoDaDemanda(demanda({ espera: 'planejar_comigo' }))).toBeNull()
  })
})

describe('tipoDaDecisao', () => {
  it('reconhece o fim de fase pelo título', () => {
    for (const t of [
      'aprovar fase',
      'aprovar mudança de fase',
      'PR do orquestrador precisa de aprovação',
    ]) {
      expect(tipoDaDecisao(`[fábrica] orquestrador: ${t}`)).toBe('fim_de_fase')
    }
    expect(tipoDaDecisao('[fábrica] orquestrador: pergunta para o Paulo')).toBe(
      'decisao_da_fabrica',
    )
    expect(tipoDaDecisao('Pausa: x')).toBe('decisao_da_fabrica')
  })
})

describe('pedido e plano no cartão', () => {
  it('o cartão do pedido traz a descrição como foi escrita e o plano da triagem', () => {
    const plano = {
      pedido: 'Quer um texto pronto para conversar com o lead.',
      muda: ['Meu dia: aba de sugestões'],
      opcoes: [
        { nome: 'Texto fixo', tamanho: 'pequeno' as const, descricao: 'Escrito pela equipe.' },
      ],
      conflitos: [],
      recomendacao: 'Texto fixo.',
    }
    const base = demanda()
    const { itens } = pilha({
      demandas: [
        demanda({
          descricao: 'Vi que a aba sugere ações.\n\nPelo WhatsApp de Sistema Alfa · ticket R-0001',
          triagem: { ...base.triagem!, plano },
        }),
      ],
    })
    expect(itens[0]!.pedido).toBe(
      'Vi que a aba sugere ações.\n\nPelo WhatsApp de Sistema Alfa · ticket R-0001',
    )
    expect(itens[0]!.plano).toEqual(plano)
  })

  it('pedidoDaDemanda: vazia → null; longa é cortada com reticências', () => {
    expect(pedidoDaDemanda('  ')).toBeNull()
    const longa = pedidoDaDemanda('x'.repeat(3000))!
    expect(longa).toHaveLength(1500)
    expect(longa.endsWith('…')).toBe(true)
  })
})

describe('montarPilha', () => {
  it('ordena por tipo e, no mesmo tipo, a mais antiga primeiro', () => {
    const { itens } = pilha({
      demandas: [
        demanda({ id: 'a', espera: 'concluir_etapa' }),
        demanda({ id: 'b', esperaDesde: new Date('2026-11-21T13:00:00Z') }),
        demanda({ id: 'c', esperaDesde: new Date('2026-11-21T10:00:00Z') }),
        demanda({ id: 'd', triagem: null }),
        demanda({ id: 'e', espera: 'aprovar_desenho' }),
        demanda({ id: 'f', espera: 'travada' }),
        demanda({ id: 'g', espera: 'planejar_comigo' }),
      ],
      decisoes: [
        decisao({
          url: 'https://github.com/x/y/issues/1',
          titulo: '[fábrica] orquestrador: aprovar fase',
        }),
        decisao({ url: 'https://github.com/x/y/issues/2' }),
      ],
    })
    expect(itens.map((i) => i.tipo)).toEqual([
      'trava',
      'fim_de_fase',
      'decisao_da_fabrica',
      'desenho',
      'nao_classificada',
      'pedido',
      'pedido',
      'concluir_etapa',
    ])
    const pedidos = itens.filter((i) => i.tipo === 'pedido').map((i) => i.ref)
    expect(pedidos.map((r) => (r.tipo === 'demanda' ? r.demandaId : ''))).toEqual(['c', 'b'])
  })

  it('mesma URL em dois planos vira um item; URL que não é issue fica de fora', () => {
    const { itens } = pilha({
      decisoes: [
        decisao({ planoId: 'p1' }),
        decisao({ planoId: 'p2' }),
        decisao({ url: 'https://github.com/a/b/pull/1' }),
        decisao({ url: 'https://exemplo.com/a/b/issues/1' }),
      ],
    })
    expect(itens).toHaveLength(1)
    expect(itens[0]!.ref).toMatchObject({ tipo: 'issue', numero: 7, planoId: 'p1' })
  })

  it('encerrada sai, adiada no futuro sai, no passado volta, guardada vai para guardados, pulada vai para o fim', () => {
    const ds = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
      demanda({ id, esperaDesde: new Date(Date.UTC(2026, 10, 21, 1 + i)) }),
    )
    const k = (i: number) => chaveDaDemanda(ds[i]!.id, ds[i]!.espera, ds[i]!.esperaDesde)
    const { itens, guardados } = pilha({
      demandas: ds,
      marcas: [
        marca(k(0), { encerrada: true }),
        marca(k(1), { adiadaAte: new Date('2026-11-22T09:00:00Z') }),
        marca(k(2), {
          adiadaAte: new Date('2026-11-21T14:00:00Z'),
          puladaEm: new Date('2026-11-21T14:30:00Z'),
        }),
        marca(k(3), { guardadaEm: new Date('2026-11-21T14:00:00Z') }),
      ],
    })
    expect(guardados.map((i) => i.chave)).toEqual([k(3)])
    expect(itens.map((i) => i.chave)).toEqual([k(4), k(2)])
  })

  it('fim de fase com fase atual: título, fato e pergunta', () => {
    const { itens } = pilha({
      decisoes: [
        decisao({
          titulo: '[fábrica] orquestrador: aprovar fase',
          faseAtual: '2',
          raias: { concluidas: 6, total: 6 },
        }),
        decisao({
          url: 'https://github.com/x/y/issues/9',
          titulo: '[fábrica] orquestrador: aprovar fase',
        }),
      ],
    })
    const com = itens.find((i) => i.chave.endsWith('/7'))!
    expect(com.titulo).toBe('Fase 2 concluída: cadastro')
    expect(com.fatos).toEqual([{ rotulo: 'Raias', valor: '6 de 6' }])
    expect(com.pergunta).toBe('Aprovo a fase e sigo para a próxima?')
    expect(itens.find((i) => i.chave.endsWith('/9'))!.titulo).toBe('Fim de fase: cadastro')
  })

  it('decisão da Fábrica usa o título sem o prefixo como pergunta', () => {
    const { itens } = pilha({ decisoes: [decisao()] })
    expect(itens[0]!.pergunta).toBe('orquestrador: pergunta para o Paulo')
    expect(itens[0]!.linha).toBe('Fábrica · cadastro')
    expect(itens[0]!.relato).toEqual({
      resumo: 'Issue da Fábrica no GitHub',
      href: 'https://github.com/kustertech-exemplo/alfa/issues/7',
      externo: true,
    })
  })

  it('demanda: o tamanho da triagem aparece com acento ("medio" → "médio")', () => {
    const base = demanda()
    const { itens } = pilha({
      demandas: [{ ...base, triagem: { ...base.triagem!, tamanho: 'medio' } }],
    })
    expect(itens[0]!.fatos[0]).toEqual({ rotulo: 'Tamanho', valor: 'médio' })
  })

  it('demanda: linha, fatos e relato', () => {
    const { itens } = pilha({ demandas: [demanda({ descricao: 'texto', anexos: 2 })] })
    expect(itens[0]!.linha).toBe('Defeito · Flow · há 3 h')
    expect(itens[0]!.fatos).toEqual([
      { rotulo: 'Tamanho', valor: 'Pequeno' },
      { rotulo: 'Mexe em', valor: 'Cadastro' },
    ])
    expect(itens[0]!.relato).toEqual({
      resumo: 'Relato original: texto e 2 anexos',
      href: '/demandas/d1',
      externo: false,
    })
    expect(pilha({ demandas: [demanda()] }).itens[0]!.relato).toBeNull()
  })

  it('demanda: o resumo do relato diz só o que existe', () => {
    const resumo = (o: Partial<DemandaEsperando>) =>
      pilha({ demandas: [demanda(o)] }).itens[0]!.relato?.resumo
    expect(resumo({ descricao: 'texto', anexos: 0 })).toBe('Relato original: texto')
    expect(resumo({ descricao: '   ', anexos: 2 })).toBe('Relato original: 2 anexos')
    expect(resumo({ descricao: null, anexos: 1 })).toBe('Relato original: 1 anexo')
    expect(resumo({ descricao: 'texto', anexos: 1 })).toBe('Relato original: texto e 1 anexo')
  })
})

describe('chaves', () => {
  it('chaveValida aceita só os dois formatos', () => {
    expect(chaveValida(chaveDaDemanda('d1', 'travada', new Date(1000)))).toBe(true)
    expect(chaveValida(chaveDaIssue('https://github.com/a/b/issues/3'))).toBe(true)
    expect(chaveValida('issue:https://github.com/a/b/pull/1')).toBe(false)
    expect(chaveValida('demanda:x')).toBe(false)
    expect(
      chaveValida(chaveDaPublicacao('parado-0b7f6c1e-1111-4111-8111-111111111111', new Date(5))),
    ).toBe(true)
    expect(chaveValida('publicacao:parado r1:5')).toBe(false)
    expect(chaveValida('publicacao:parado-r1')).toBe(false)
  })
})

describe('avisos da publicação na pilha', () => {
  const RUN = 'https://github.com/kustertech-exemplo/cais/actions/runs/88'
  function aviso(o: Partial<AvisoDaPublicacaoNaPilha> = {}): AvisoDaPublicacaoNaPilha {
    return {
      id: 'parado-r1',
      repositorioId: 'r1',
      titulo:
        'CAIS parou: o deploy terminou, mas o site no ar mostra a versão 1111111, não 2222222',
      contexto:
        'o workflow ficou verde, mas o site não trocou de versão; confira o servidor e retome a fila',
      href: RUN,
      externo: true,
      tom: 'erro',
      desde: new Date('2026-11-21T14:50:00Z'),
      projeto: 'CAIS',
      repositorio: 'kustertech-exemplo/cais',
      ...o,
    }
  }

  it('cada aviso vira um item "publicacao" com o run como relato e sem respostas rápidas', () => {
    const { itens } = pilha({ publicacoes: [aviso()] })
    expect(itens).toEqual([
      {
        chave: chaveDaPublicacao('parado-r1', new Date('2026-11-21T14:50:00Z')),
        tipo: 'publicacao',
        titulo:
          'CAIS parou: o deploy terminou, mas o site no ar mostra a versão 1111111, não 2222222',
        pergunta: 'Confira o servidor e retome a fila na tela Publicação.',
        projeto: 'CAIS',
        repositorio: 'kustertech-exemplo/cais',
        linha: 'Publicação · há 10 min',
        desde: new Date('2026-11-21T14:50:00Z'),
        fatos: [],
        relato: {
          resumo:
            'o workflow ficou verde, mas o site não trocou de versão; confira o servidor e retome a fila',
          href: RUN,
          externo: true,
        },
        ref: { tipo: 'publicacao', repositorioId: 'r1', avisoId: 'parado-r1', tom: 'erro' },
      },
    ])
    expect(respostasDoItem(itens[0]!)).toEqual([])
  })

  it('a pergunta segue o caso: falhou, dispensado; sem run, o relato leva à tela Publicação', () => {
    const { itens } = pilha({
      publicacoes: [
        aviso({ id: 'falhou-r1', tom: 'atencao' }),
        aviso({
          id: 'dispensado-r2',
          repositorioId: 'r2',
          tom: 'atencao',
          href: '#r2',
          externo: false,
        }),
      ],
    })
    expect(itens.map((i) => i.pergunta)).toEqual([
      'Confira se o site mostra mesmo a versão que você espera.',
      'Um agente está consertando. Confira o run se quiser saber o que quebrou.',
    ])
    expect(itens[0]!.relato).toEqual({
      resumo: aviso().contexto,
      href: '/publicacao#r2',
      externo: false,
    })
  })

  it('o aviso de erro (fila parada) vem antes do de atenção, mesmo mais novo', () => {
    const { itens } = pilha({
      publicacoes: [
        aviso({ id: 'dispensado-r2', tom: 'atencao', desde: new Date('2026-11-21T14:40:00Z') }),
        aviso(),
      ],
    })
    expect(itens.map((i) => i.ref.tipo === 'publicacao' && i.ref.avisoId)).toEqual([
      'parado-r1',
      'dispensado-r2',
    ])
  })

  it('a publicação vem depois das travas e antes do fim de fase; pular e adiar valem para ela', () => {
    const trava = demanda({
      id: 'd9',
      espera: 'travada',
      esperaDesde: new Date('2026-11-21T10:00:00Z'),
    })
    const fimDeFase = decisao({ titulo: '[fábrica] orquestrador: aprovar fase' })
    const { itens } = pilha({ demandas: [trava], decisoes: [fimDeFase], publicacoes: [aviso()] })
    expect(itens.map((i) => i.tipo)).toEqual(['trava', 'publicacao', 'fim_de_fase'])

    const chave = chaveDaPublicacao('parado-r1', new Date('2026-11-21T14:50:00Z'))
    const adiado = pilha({
      publicacoes: [aviso()],
      marcas: [marca(chave, { adiadaAte: new Date('2026-11-22T09:00:00Z') })],
    })
    expect(adiado.itens).toEqual([])
  })
})

describe('decisão da Fábrica no cabeçalho', () => {
  it('título e pergunta dizem o assunto, sem os prefixos', () => {
    const { itens } = pilha({
      decisoes: [decisao({ titulo: '[fábrica] pergunta: Cobrar à vista?' })],
    })
    expect(itens[0]).toMatchObject({
      tipo: 'decisao_da_fabrica',
      titulo: 'Cobrar à vista?',
      pergunta: 'Cobrar à vista?',
    })
  })
})

describe('amanhaAsSeis', () => {
  it('06:00 do dia seguinte em São Paulo', () => {
    expect(amanhaAsSeis(new Date('2026-11-21T23:30:00-03:00')).toISOString()).toBe(
      new Date('2026-11-22T06:00:00-03:00').toISOString(),
    )
    expect(amanhaAsSeis(new Date('2026-11-22T01:00:00-03:00')).toISOString()).toBe(
      new Date('2026-11-23T06:00:00-03:00').toISOString(),
    )
  })
})

describe('motivosDaIssue', () => {
  const corpo = (motivos: string) =>
    `PR: https://github.com/kustertech-exemplo/alfa/pull/7\nMotivo da acordada: fase_concluida\n\nMotivos:\n${motivos}\n\nPara aprovar, mergeie o PR.`

  it('as linhas "- " do bloco "Motivos:" do corpo escrito pelo despachante, em ordem', () => {
    expect(
      motivosDaIssue(
        corpo(
          '- mudanças de verificação na fase 3\n- aprovar fase (o orquestrador foi acordado por fase_concluida)',
        ),
      ),
    ).toEqual({
      motivos: [
        'mudanças de verificação na fase 3',
        'aprovar fase (o orquestrador foi acordado por fase_concluida)',
      ],
      restantes: 0,
    })
  })

  it('sem bloco, corpo nulo ou bloco vazio: nada', () => {
    expect(motivosDaIssue(null)).toEqual({ motivos: [], restantes: 0 })
    expect(motivosDaIssue('PR: x\n\n- solto fora do bloco')).toEqual({ motivos: [], restantes: 0 })
    expect(motivosDaIssue('Motivos:\n\n- depois da linha em branco')).toEqual({
      motivos: [],
      restantes: 0,
    })
  })

  it('para na primeira linha que não é item, aceita CRLF e ignora item vazio', () => {
    expect(motivosDaIssue('Motivos:\r\n- um\r\n-   \r\n- dois\r\nTexto\r\n- fora')).toEqual({
      motivos: ['um', 'dois'],
      restantes: 0,
    })
  })

  it('no máximo 5 motivos de até 200 caracteres; o resto vira a contagem', () => {
    const linhas = Array.from({ length: 7 }, (_, i) => `- m${i}`).join('\n')
    expect(motivosDaIssue(corpo(linhas))).toEqual({
      motivos: ['m0', 'm1', 'm2', 'm3', 'm4'],
      restantes: 2,
    })
    const [longo] = motivosDaIssue(corpo('- ' + 'x'.repeat(300))).motivos
    expect(longo).toBe('x'.repeat(199) + '…')
  })
})

describe('textoDaTrava', () => {
  it('teste que falhou explica o que cada botão faz, depois do resumo do teste', () => {
    expect(textoDaTrava('teste_falhou', 'Quase tudo funciona.\n')).toBe(
      'Quase tudo funciona.\n\nRetomar: um agente corrige o que falhou e o teste roda de novo.\n' +
        'Entregar o que funciona: a demanda segue para a entrega como está, e o que faltou vira uma demanda nova.\n' +
        'Encerrar a demanda: ela fecha como está, sem correção.',
    )
  })

  it('trava comum mostra só o motivo', () => {
    expect(textoDaTrava('travada', ' O PR não passou no CI. ')).toBe('O PR não passou no CI.')
  })

  it('com desfecho, diz o que o orquestrador concluiu e leva à outra demanda', () => {
    const outra = '7b7ba4b8-1111-4222-8333-444444444444'
    expect(textoDaTrava('travada', 'm', { resultado: 'duplicada', de: outra })).toBe(
      'O orquestrador concluiu que esta demanda é duplicada da 7b7ba4b8: o que ela pede já está feito lá. Não há plano a fazer.\n\n' +
        `A outra demanda: /demandas/${outra}`,
    )
    expect(textoDaTrava('travada', 'm', { resultado: 'duplicada', de: null })).toBe(
      'O orquestrador concluiu que esta demanda é duplicada de outra demanda. Não há plano a fazer.',
    )
    expect(textoDaTrava('travada', 'm', { resultado: 'ja_resolvida', de: null })).toBe(
      'O orquestrador concluiu que o que esta demanda pede já está resolvido no repositório. Não há plano a fazer.',
    )
  })

  it('sem motivo usa o texto padrão', () => {
    expect(textoDaTrava('travada', null)).toBe('A demanda está travada e espera você.')
    expect(textoDaTrava('teste_falhou', '  ')).toMatch(/^O teste no navegador falhou\.\n\nRetomar:/)
  })
})

describe('numeroDoPrDaTrava', () => {
  const repo = 'kustertech-exemplo/alfa'
  it('só o PR do repositório da demanda, sem diferença de caixa', () => {
    expect(numeroDoPrDaTrava('https://github.com/kustertech-exemplo/alfa/pull/500', repo)).toBe(500)
    expect(numeroDoPrDaTrava('https://github.com/Kustertech-Exemplo/Alfa/pull/7', repo)).toBe(7)
  })
  it('outro repositório, issue, lixo ou nulo não têm PR', () => {
    expect(
      numeroDoPrDaTrava('https://github.com/kustertech-exemplo/beta/pull/500', repo),
    ).toBeNull()
    expect(
      numeroDoPrDaTrava('https://github.com/kustertech-exemplo/alfa/issues/5', repo),
    ).toBeNull()
    expect(numeroDoPrDaTrava('https://github.com/kustertech-exemplo/alfa/pull/0', repo)).toBeNull()
    expect(
      numeroDoPrDaTrava('https://github.com/kustertech-exemplo/alfa/pull/5/files', repo),
    ).toBeNull()
    expect(numeroDoPrDaTrava(null, repo)).toBeNull()
  })
})

describe('travaDeCorrecao', () => {
  it('só os motivos da correção com PR aberto para conferir (demandas.py)', () => {
    for (const m of [
      'PR de correção sem CI: revise e faça o merge',
      'o PR da correção mexe em caminho protegido: .github/x.yml',
      'o PR da correção do teste está com o CI vermelho',
      'o CI da correção do teste não terminou em 2 h',
      'o GitHub recusou o merge da correção',
      'O revisor da Fábrica reprovou a correção: falta o teste do quadro',
      'O revisor da Fábrica não conseguiu avaliar a correção, nem na segunda tentativa',
      'O revisor da Fábrica passou de 2 h sem avaliar a correção',
    ]) {
      expect(travaDeCorrecao(m), m).toBe(true)
    }
    for (const m of [
      'o PR do plano foi recusado',
      'o desenho foi recusado',
      'o PR da correção já estava mergeado antes de o kit conferir',
      'o PR da correção está em outro repositório',
      null,
    ]) {
      expect(travaDeCorrecao(m), String(m)).toBe(false)
    }
  })

  it('a trava de correção leva o número do PR na ref; as outras, não', () => {
    const pr = 'https://github.com/kustertech-exemplo/alfa/pull/500'
    const trava = (esperaMotivo: string) =>
      pilha({ demandas: [demanda({ espera: 'travada', esperaMotivo, urlDaTrava: pr })] }).itens[0]!
        .ref
    expect(trava('PR de correção sem CI: revise e faça o merge')).toMatchObject({ prDaTrava: 500 })
    expect(trava('o PR do plano foi recusado')).toMatchObject({ prDaTrava: null })
  })
})

describe('respostasDoItem', () => {
  const pilha = (d: DemandaEsperando) =>
    montarPilha({
      demandas: [d],
      decisoes: [],
      marcas: [],
      agora: AGORA,
      nomeDoProjeto: () => null,
    }).itens[0]!
  const chaves = (d: DemandaEsperando) => respostasDoItem(pilha(d)).map((r) => r.chave)

  it('"Entregar o que funciona" só aparece no teste que falhou', () => {
    expect(chaves(demanda({ espera: 'teste_falhou', esperaMotivo: 'r' }))).toEqual([
      'retomar',
      'entregar_parcial',
      'encerrar',
    ])
    expect(respostasDoItem(pilha(demanda({ espera: 'teste_falhou' })))[1]!.rotulo).toBe(
      'Entregar o que funciona',
    )
    expect(chaves(demanda({ espera: 'travada', esperaMotivo: 'CI' }))).toEqual([
      'retomar',
      'encerrar',
    ])
  })

  it('trava com desfecho: só "Encerrar como …", nunca Retomar', () => {
    const outra = '7b7ba4b8-1111-4222-8333-444444444444'
    const duplicada = demanda({
      espera: 'travada',
      esperaMotivo: 'm',
      desfecho: { resultado: 'duplicada', de: outra },
    })
    expect(respostasDoItem(pilha(duplicada))).toEqual([
      { chave: 'encerrar', rotulo: 'Encerrar como duplicada da 7b7ba4b8' },
    ])
    const resolvida = demanda({
      espera: 'travada',
      desfecho: { resultado: 'ja_resolvida', de: null },
    })
    expect(respostasDoItem(pilha(resolvida))).toEqual([
      { chave: 'encerrar', rotulo: 'Encerrar como já resolvida' },
    ])
    expect(pilha(duplicada).ref).toMatchObject({ desfecho: { resultado: 'duplicada', de: outra } })
    // Só a espera travada leva o desfecho.
    expect(
      pilha(demanda({ espera: 'teste_falhou', desfecho: { resultado: 'ja_resolvida', de: null } }))
        .ref,
    ).toMatchObject({ desfecho: null })
  })

  it('os outros tipos seguem com as respostas de sempre', () => {
    expect(chaves(demanda())).toEqual([
      'fila_de_agentes',
      'urgente',
      'lote_da_noite',
      'guardar',
      'recusar',
    ])
  })
})

describe('trechosComLink', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  it('o caminho de uma demanda vira link; o resto fica texto', () => {
    expect(trechosComLink(`O que faltou virou uma demanda nova: /demandas/${ID}.`)).toEqual([
      { texto: 'O que faltou virou uma demanda nova: ' },
      { texto: `/demandas/${ID}`, href: `/demandas/${ID}` },
      { texto: '.' },
    ])
  })
  it('sem caminho, um trecho só; caminho que não é de demanda não vira link', () => {
    expect(trechosComLink('Registrado.')).toEqual([{ texto: 'Registrado.' }])
    expect(trechosComLink('/demandas/abc e https://x.com/demandas/' + ID)).toEqual([
      { texto: '/demandas/abc e https://x.com/demandas/' + ID },
    ])
  })
})
