import { describe, expect, test } from 'vitest'
import {
  avisosDaPublicacao,
  colunaDeEstado,
  itensDoUltimoLote,
  montarResumoDaPublicacao,
  noArDaLinha,
  oQueEstaNoAr,
  pilulasDaLinha,
  rodapeDoLote,
  rotuloDaLinha,
  type ItemDoLote,
  type LinhaDaFila,
  type PedidoDaLinha,
} from './apresentacao'
import { MOTIVOS, motivoDeBaseAntiga } from './model'

// 12:00 em São Paulo.
const AGORA = new Date('2026-11-19T15:00:00.000Z')
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000)
const sha = (c: string) => c.repeat(40)

function pedido(extra: Partial<PedidoDaLinha> = {}): PedidoDaLinha {
  return {
    id: 'p1',
    commit: sha('a'),
    descricao: null,
    modo: 'imediato',
    estado: 'na_fila',
    checks: null,
    iniciadoEm: null,
    verificandoDesde: null,
    ...extra,
  }
}

function linha(extra: Partial<LinhaDaFila> = {}): LinhaDaFila {
  return {
    repositorioId: 'r1',
    projetoId: 'P1',
    projeto: 'Projeto Alfa',
    rotulo: 'Projeto Alfa',
    configuracao: {
      pausado: false,
      horaDoLote: '22:00',
      situacao: 'normal',
      situacaoDesde: null,
      situacaoMotivo: null,
    },
    noAr: null,
    publicando: null,
    aguardando: [],
    conserto: null,
    ultimaFalha: null,
    ultimoRecusado: null,
    ultimaPublicacaoEm: null,
    duracaoTipicaEmMin: null,
    ...extra,
  }
}

const subindo = (extra: Partial<PedidoDaLinha> = {}) =>
  pedido({
    id: 'sub',
    estado: 'publicando',
    descricao: 'Corrige PDF cortado',
    iniciadoEm: minutos(-2),
    ...extra,
  })

describe('montarResumoDaPublicacao', () => {
  test('um subindo há 2 min com histórico [4,6,8] → n "Projeto Alfa · Corrige PDF cortado", m "há 2 min · costuma levar 6"', () => {
    const r = montarResumoDaPublicacao(
      [linha({ publicando: subindo(), duracaoTipicaEmMin: 6 })],
      [],
      AGORA,
    )
    expect(r.subindo).toEqual({
      vazio: false,
      n: 'Projeto Alfa · Corrige PDF cortado',
      m: 'há 2 min · costuma levar 6',
    })
  })

  test('subindo sem descrição e sem histórico → sha7 e só a idade; nada subindo → "Nada subindo"', () => {
    const r = montarResumoDaPublicacao(
      [linha({ publicando: subindo({ descricao: null, commit: sha('9') }) })],
      [],
      AGORA,
    )
    expect(r.subindo).toEqual({ vazio: false, n: 'Projeto Alfa · 9999999', m: 'há 2 min' })
    expect(montarResumoDaPublicacao([linha()], [], AGORA).subindo).toEqual({
      vazio: true,
      n: 'Nada subindo',
      m: 'a fila anda sozinha',
    })
  })

  test('3 na fila em 2 repositórios → "3" / "em 2 projetos"; lote 4 às 22:00 em 2 → "4" / "às 22:00 · 2 projetos"', () => {
    const alfa = linha({
      aguardando: [
        pedido({ id: 'a1' }),
        pedido({ id: 'a2', estado: 'verificando' }),
        pedido({ id: 'l1', modo: 'lote' }),
        pedido({ id: 'l2', modo: 'lote' }),
        pedido({ id: 'l3', modo: 'lote' }),
      ],
    })
    const beta = linha({
      repositorioId: 'r2',
      projeto: 'Projeto Beta',
      rotulo: 'Projeto Beta',
      configuracao: { ...alfa.configuracao!, horaDoLote: '23:00' },
      aguardando: [pedido({ id: 'b1' }), pedido({ id: 'l4', modo: 'lote' })],
    })
    const r = montarResumoDaPublicacao([alfa, beta], [], AGORA)
    expect(r.naFila).toEqual({ n: '3', m: 'em 2 projetos' })
    expect(r.lote).toEqual({ n: '4', m: 'às 22:00 · 2 projetos' })

    const umSo = montarResumoDaPublicacao([linha({ aguardando: [pedido()] })], [], AGORA)
    expect(umSo.naFila).toEqual({ n: '1', m: 'em 1 projeto' })
    expect(umSo.lote).toEqual({ n: '0', m: 'nada para esta noite' })
  })

  test('último lote 5 de 5 ontem 22:00 em 14 min → "5 de 5" / "ontem 22:00 · 14 min · sem falha"', () => {
    // 22:00 de 18/11 em São Paulo = 01:00Z de 19/11.
    const lote = new Date('2026-11-19T01:00:00.000Z')
    const itens: ItemDoLote[] = [0, 3, 6, 9, 14].map((m, i) => ({
      id: `l${i}`,
      titulo: `item ${i}`,
      projeto: 'Projeto Alfa',
      estado: 'publicado',
      loteEm: lote,
      concluidoEm: new Date(lote.getTime() + m * 60_000),
    }))
    const r = montarResumoDaPublicacao([], itens, AGORA)
    expect(r.ultimoLote).toEqual({
      n: '5',
      de: 'de 5',
      m: 'ontem 22:00 · 14 min · sem falha',
      quando: 'ontem 22:00',
    })
    expect(rodapeDoLote(itens)).toBe('5 no ar · nenhuma voltou · terminou 22:14')

    const comFalha = itens.map((i, n) => (n < 2 ? { ...i, estado: 'falhou' as const } : i))
    expect(montarResumoDaPublicacao([], comFalha, AGORA).ultimoLote.m).toBe(
      'ontem 22:00 · 14 min · 2 falharam',
    )
    expect(rodapeDoLote(comFalha)).toBe('3 no ar · 2 falharam · terminou 22:14')
  })

  // O lote marcado para 22:00 que o worker só disparou às 22:02: o cabeçalho e o cartão mostram o
  // início real (22:02), nunca uma hora anterior à de todos os itens.
  test('último lote disparado depois da hora marcada → "quando" e a duração contam do início real', () => {
    const lote = new Date('2026-11-19T01:00:00.000Z')
    const inicio = new Date(lote.getTime() + 2 * 60_000)
    const itens: ItemDoLote[] = [3, 9].map((m, i) => ({
      id: `l${i}`,
      titulo: `item ${i}`,
      projeto: 'Projeto Alfa',
      estado: 'publicado',
      loteEm: lote,
      iniciadoEm: inicio,
      concluidoEm: new Date(lote.getTime() + m * 60_000),
    }))
    const r = montarResumoDaPublicacao([], itens, AGORA)
    expect(r.ultimoLote.quando).toBe('ontem 22:02')
    expect(r.ultimoLote.m).toBe('ontem 22:02 · 7 min · sem falha')
    expect(rodapeDoLote(itens)).toBe('2 no ar · nenhuma voltou · terminou 22:09')
  })

  test('nenhum lote → "—" / "nenhum lote ainda"; lote de hoje e de antes de ontem', () => {
    expect(montarResumoDaPublicacao([], [], AGORA).ultimoLote).toEqual({
      n: '—',
      m: 'nenhum lote ainda',
      quando: null,
    })
    expect(rodapeDoLote([])).toBeNull()
    const item = (loteEm: Date): ItemDoLote => ({
      id: 'x',
      titulo: 't',
      projeto: 'Projeto Alfa',
      estado: 'publicado',
      loteEm,
      concluidoEm: loteEm,
    })
    // 08:00 de hoje e 22:00 de 15/11 em São Paulo.
    expect(
      montarResumoDaPublicacao([], [item(new Date('2026-11-19T11:00:00Z'))], AGORA).ultimoLote
        .quando,
    ).toBe('hoje 08:00')
    expect(
      montarResumoDaPublicacao([], [item(new Date('2026-11-16T01:00:00Z'))], AGORA).ultimoLote
        .quando,
    ).toBe('15/11 22:00')
  })
})

describe('itensDoUltimoLote', () => {
  test('agrupa só o lote mais recente, ordenado pela conclusão', () => {
    const lote = new Date('2026-11-19T01:00:00.000Z')
    const anterior = new Date('2026-11-18T01:00:00.000Z')
    const base = { titulo: 't', projeto: 'Projeto Alfa', estado: 'publicado' as const }
    const itens = itensDoUltimoLote([
      { ...base, id: 'b', loteEm: lote, concluidoEm: new Date(lote.getTime() + 5 * 60_000) },
      { ...base, id: 'velho', loteEm: anterior, concluidoEm: anterior },
      { ...base, id: 'a', loteEm: lote, concluidoEm: lote },
    ])
    expect(itens.map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('pilulasDaLinha', () => {
  test('ordem subindo, em seguida, lote; consertando com PR #212 → "Consertando · agente no PR #212"', () => {
    const l = linha({
      publicando: subindo({ descricao: 'PDF cortado', checks: 'sucesso' }),
      aguardando: [
        pedido({ id: 'l1', modo: 'lote' }),
        pedido({ id: 'e1', descricao: 'Exportar CSV', checks: 'sem_checks' }),
        pedido({ id: 'l2', modo: 'lote' }),
        pedido({ id: 'l3', modo: 'lote' }),
      ],
    })
    expect(pilulasDaLinha(l, AGORA)).toEqual([
      { chave: 'subindo', texto: 'PDF cortado', tom: 'execucao', checks: 'sucesso' },
      { chave: 'e1', texto: 'Exportar CSV', tom: 'neutro', checks: 'sem_checks' },
      { chave: 'lote', texto: '22:00 · 3', tom: 'informacao', tracejada: true },
    ])

    const consertando = linha({
      configuracao: { ...l.configuracao!, situacao: 'consertando', situacaoDesde: minutos(-12) },
      conserto: {
        estado: 'com_pr',
        prUrl: 'https://github.com/kustertech-exemplo/base/pull/212',
        abertoEm: minutos(-12),
        pegoEm: minutos(-11),
        encerradoEm: null,
        correcaoPedida: false,
        pr: null,
      },
      aguardando: [pedido({ id: 'e1', descricao: 'Índice de busca' })],
    })
    expect(pilulasDaLinha(consertando, AGORA).map((p) => [p.texto, p.tom])).toEqual([
      ['Consertando · agente no PR #212', 'atencao'],
      ['Índice de busca', 'neutro'],
    ])
    const semPr = { ...consertando, conserto: { ...consertando.conserto!, prUrl: null } }
    expect(pilulasDaLinha(semPr, AGORA)[0]?.texto).toBe('Consertando · agente trabalhando')
  })

  test('pausada, parado e não configurado', () => {
    const base = linha()
    const pausada = linha({ configuracao: { ...base.configuracao!, pausado: true } })
    expect(pilulasDaLinha(pausada, AGORA)).toEqual([
      { chave: 'pausada', texto: 'Pausada', tom: 'neutro' },
    ])
    const parada = linha({ configuracao: { ...base.configuracao!, situacao: 'parado' } })
    expect(pilulasDaLinha(parada, AGORA)).toEqual([
      { chave: 'parado', texto: 'Parado', tom: 'erro' },
    ])
    expect(pilulasDaLinha(linha({ configuracao: null }), AGORA)).toEqual([
      { chave: 'nao-configurada', texto: 'publicação não configurada', tom: 'neutro', vazia: true },
    ])
  })

  test('recusado base antiga há 2 h sem publicação depois → "Recusado: base antiga"; há 25 h → sem pílula', () => {
    const recusado = (h: number, motivo = motivoDeBaseAntiga(2)) =>
      linha({ ultimoRecusado: { motivo, concluidoEm: minutos(-h * 60) } })
    expect(pilulasDaLinha(recusado(2), AGORA)).toEqual([
      { chave: 'recusado', texto: 'Recusado: base antiga', tom: 'erro' },
    ])
    expect(pilulasDaLinha(recusado(25), AGORA)).toEqual([])
    expect(pilulasDaLinha({ ...recusado(2), ultimaPublicacaoEm: minutos(-60) }, AGORA)).toEqual([])
    expect(pilulasDaLinha(recusado(2, MOTIVOS.foraDeMain), AGORA)[0]?.texto).toBe(
      'Recusado: fora de main',
    )
    expect(pilulasDaLinha(recusado(2, MOTIVOS.historicoReescrito), AGORA)[0]?.texto).toBe(
      'Recusado: histórico reescrito',
    )
  })
})

describe('colunaDeEstado', () => {
  const base = linha()
  test('cada situação tem o seu texto', () => {
    expect(colunaDeEstado(linha({ configuracao: null }), AGORA, false)).toEqual({
      tipo: 'link',
      texto: 'Configurar',
      href: '/projetos/P1/configuracao#publicacao',
    })
    expect(colunaDeEstado(linha({ publicando: subindo() }), AGORA, false)).toEqual({
      tipo: 'texto',
      texto: 'Publicando',
      tom: 'secundario',
    })
    const consertando = linha({
      configuracao: { ...base.configuracao!, situacao: 'consertando', situacaoDesde: minutos(-12) },
      conserto: {
        estado: 'em_curso',
        prUrl: null,
        abertoEm: minutos(-12),
        pegoEm: null,
        encerradoEm: null,
        correcaoPedida: false,
        pr: null,
      },
    })
    expect(colunaDeEstado(consertando, AGORA, false)).toEqual({
      tipo: 'texto',
      texto: 'Agente · 12 min',
      tom: 'atencao',
    })
    const parada = linha({ configuracao: { ...base.configuracao!, situacao: 'parado' } })
    expect(colunaDeEstado(parada, AGORA, false)).toEqual({
      tipo: 'texto',
      texto: 'Espera você',
      tom: 'erro',
    })
    expect(colunaDeEstado(linha(), AGORA, true)?.texto).toBe('Pausada')
    expect(
      colunaDeEstado(
        linha({ ultimoRecusado: { motivo: MOTIVOS.foraDeMain, concluidoEm: minutos(-5) } }),
        AGORA,
        false,
      )?.texto,
    ).toBe('Avisado')
    expect(colunaDeEstado(linha({ aguardando: [pedido()] }), AGORA, false)?.texto).toBe('Na fila')
    expect(colunaDeEstado(linha(), AGORA, false)).toBeNull()
  })
})

describe('noArDaLinha', () => {
  // A coluna "No ar" tem largura fixa: a idade fica curta como no desenho ("a41c9e2 · 3 h").
  test('commit curto e idade compacta; menos de 1 min vira "agora"; sem publicação, "—"', () => {
    const noAr = (desde: Date) => linha({ noAr: { commit: sha('a'), desde } })
    expect(noArDaLinha(noAr(AGORA), AGORA)).toBe('aaaaaaa · agora')
    expect(noArDaLinha(noAr(minutos(-12)), AGORA)).toBe('aaaaaaa · 12 min')
    expect(noArDaLinha(noAr(minutos(-180)), AGORA)).toBe('aaaaaaa · 3 h')
    expect(noArDaLinha(linha(), AGORA)).toBe('—')
  })
})

describe('oQueEstaNoAr', () => {
  // O commit sozinho não diz nada a quem olha: a tela mostra o que subiu, com o commit embaixo.
  test('o título da demanda; sem demanda, a descrição do pedido; sem nenhum, nada', () => {
    const noAr = (titulo: string | null) =>
      linha({ noAr: { commit: sha('a'), desde: AGORA, titulo } })
    expect(oQueEstaNoAr(noAr('Orientador por IA e fila de relatos'))).toBe(
      'Orientador por IA e fila de relatos',
    )
    expect(oQueEstaNoAr(noAr('   '))).toBeNull()
    // uma publicação que atendeu pedidos mais antigos levou tudo junto
    expect(
      oQueEstaNoAr(
        linha({ noAr: { commit: sha('a'), desde: AGORA, titulo: 'Relatos', junto: 2 } }),
      ),
    ).toBe('Relatos e mais 2')
    expect(oQueEstaNoAr(noAr(null))).toBeNull()
    expect(oQueEstaNoAr(linha())).toBeNull()
  })
})

describe('rotuloDaLinha', () => {
  test('o nome do projeto, ou "<projeto> · <repo>" quando o projeto tem mais de um', () => {
    expect(rotuloDaLinha('Projeto Alfa', 'kustertech-exemplo/portal', 1)).toBe('Projeto Alfa')
    expect(rotuloDaLinha('Projeto Alfa', 'kustertech-exemplo/portal', 2)).toBe(
      'Projeto Alfa · portal',
    )
  })
})

describe('avisosDaPublicacao', () => {
  const parada = (motivo: string, extra: Partial<LinhaDaFila> = {}) =>
    linha({
      repositorioId: 'rb',
      projeto: 'Projeto Beta',
      rotulo: 'Projeto Beta',
      configuracao: {
        pausado: false,
        horaDoLote: '22:00',
        situacao: 'parado',
        situacaoDesde: minutos(-5),
        situacaoMotivo: motivo,
      },
      ultimaFalha: {
        commit: '9d2e41b' + '0'.repeat(33),
        execucaoUrl: 'https://github.com/kustertech-exemplo/beta/actions/runs/7',
      },
      ...extra,
    })

  test('fila parada por desistência há 40 min → título e contexto do desenho, tom erro; nada parado → []', () => {
    const l = parada(MOTIVOS.desistiu, {
      conserto: {
        estado: 'desistiu',
        prUrl: null,
        abertoEm: minutos(-45),
        pegoEm: minutos(-44),
        encerradoEm: minutos(-5),
        correcaoPedida: false,
        pr: null,
      },
    })
    expect(avisosDaPublicacao([l], AGORA)).toEqual([
      {
        id: 'parado-rb',
        repositorioId: 'rb',
        titulo: 'Projeto Beta parou: o agente não conseguiu consertar',
        contexto: 'falhou ao publicar 9d2e41b · conserto desistiu em 40 min',
        href: 'https://github.com/kustertech-exemplo/beta/actions/runs/7',
        externo: true,
        tom: 'erro',
        desde: minutos(-5),
      },
    ])
    expect(avisosDaPublicacao([linha()], AGORA)).toEqual([])
  })

  test('parada por outro motivo e sem link da execução → âncora da linha', () => {
    const l = parada(MOTIVOS.semFabrica, { ultimaFalha: { commit: sha('c'), execucaoUrl: null } })
    const [aviso] = avisosDaPublicacao([l], AGORA)
    expect(aviso).toMatchObject({
      titulo: `Projeto Beta parou: ${MOTIVOS.semFabrica}`,
      contexto: 'falhou ao publicar ccccccc',
      href: '#rb',
      externo: false,
    })
  })

  test('verificando há 31 min → "Projeto Alfa: o GitHub não responde há 31 min"', () => {
    const l = linha({
      aguardando: [pedido({ estado: 'verificando', verificandoDesde: minutos(-31) })],
    })
    expect(avisosDaPublicacao([l], AGORA)).toEqual([
      {
        id: 'verificacao-r1',
        repositorioId: 'r1',
        titulo: 'Projeto Alfa: o GitHub não responde há 31 min',
        contexto: 'pedido aaaaaaa esperando a verificação',
        href: '#r1',
        externo: false,
        tom: 'atencao',
        desde: minutos(-31),
      },
    ])
    const recente = linha({
      aguardando: [pedido({ estado: 'verificando', verificandoDesde: minutos(-29) })],
    })
    expect(avisosDaPublicacao([recente], AGORA)).toEqual([])
  })

  test('histórico reescrito → pede para redefinir; os de erro vêm antes', () => {
    const reescrito = linha({
      ultimoRecusado: { motivo: MOTIVOS.historicoReescrito, concluidoEm: minutos(-10) },
    })
    const lenta = linha({
      repositorioId: 'r3',
      rotulo: 'Projeto Gama',
      aguardando: [pedido({ estado: 'verificando', verificandoDesde: minutos(-60) })],
    })
    const avisos = avisosDaPublicacao([lenta, reescrito], AGORA)
    expect(avisos.map((a) => [a.titulo, a.contexto, a.tom])).toEqual([
      [
        'Projeto Alfa: o histórico de main foi reescrito',
        'redefina o que está no ar para voltar a publicar',
        'erro',
      ],
      [
        'Projeto Gama: o GitHub não responde há 60 min',
        'pedido aaaaaaa esperando a verificação',
        'atencao',
      ],
    ])
  })

  describe('PR do conserto espera revisão', () => {
    const PR = 'https://github.com/kustertech-exemplo/base/pull/212'
    const comPr = (extra: Partial<NonNullable<LinhaDaFila['conserto']>> = {}): LinhaDaFila =>
      linha({
        configuracao: {
          pausado: false,
          horaDoLote: '22:00',
          situacao: 'consertando',
          situacaoDesde: minutos(-120),
          situacaoMotivo: null,
        },
        conserto: {
          estado: 'com_pr',
          prUrl: PR,
          abertoEm: minutos(-120),
          pegoEm: minutos(-110),
          encerradoEm: null,
          correcaoPedida: false,
          pr: { estado: 'ABERTO', shaMerge: null, criadoEm: minutos(-90) },
          ...extra,
        },
      })

    test('COM_PR com o PR aberto há mais de 1 h → aviso de atenção com o link do PR', () => {
      expect(avisosDaPublicacao([comPr()], AGORA)).toEqual([
        {
          id: 'pr-do-conserto-r1',
          repositorioId: 'r1',
          titulo: 'Projeto Alfa: PR do conserto espera revisão',
          contexto: 'PR #212 aberto há 1 h',
          href: PR,
          externo: true,
          rotuloDoLink: 'Ver o PR',
          tom: 'atencao',
          desde: minutos(-90),
        },
      ])
    })

    test('PR mergeado sem o SHA do merge sincronizado também avisa', () => {
      const [aviso] = avisosDaPublicacao(
        [comPr({ pr: { estado: 'MERGEADO', shaMerge: null, criadoEm: minutos(-90) } })],
        AGORA,
      )
      expect(aviso).toMatchObject({
        titulo: 'Projeto Alfa: PR do conserto espera revisão',
        contexto: 'PR #212 mergeado; o commit do merge ainda não chegou ao Flow',
        href: PR,
      })
    })

    test('sem o PR sincronizado conta desde que a Fábrica pegou o conserto', () => {
      expect(avisosDaPublicacao([comPr({ pr: null })], AGORA)[0]?.desde).toEqual(minutos(-110))
      expect(avisosDaPublicacao([comPr({ pr: null, pegoEm: minutos(-59) })], AGORA)).toEqual([])
    })

    test('1 h exata, correção já pedida, PR fechado ou mergeado com SHA → sem aviso', () => {
      expect(
        avisosDaPublicacao(
          [comPr({ pr: { estado: 'ABERTO', shaMerge: null, criadoEm: minutos(-60) } })],
          AGORA,
        ),
      ).toEqual([])
      expect(avisosDaPublicacao([comPr({ correcaoPedida: true })], AGORA)).toEqual([])
      expect(
        avisosDaPublicacao(
          [comPr({ pr: { estado: 'FECHADO', shaMerge: null, criadoEm: minutos(-90) } })],
          AGORA,
        ),
      ).toEqual([])
      expect(
        avisosDaPublicacao(
          [comPr({ pr: { estado: 'MERGEADO', shaMerge: sha('f'), criadoEm: minutos(-90) } })],
          AGORA,
        ),
      ).toEqual([])
      expect(avisosDaPublicacao([comPr({ estado: 'em_curso', prUrl: null })], AGORA)).toEqual([])
    })
  })
})
