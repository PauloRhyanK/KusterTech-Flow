import { describe, expect, test } from 'vitest'
import {
  apresentarEstadoDoItem,
  classificarNaFila,
  hrefDaFila,
  lerFiltrosDaFila,
  lerRetornoDaFila,
  resumoDaHomologacao,
  tituloDoEvento,
  transicaoDeHomologacao,
  type ContextoDaTransicao,
  type EstadoItemHomologacao,
} from './model'

const ok: ContextoDaTransicao = {
  presencaNaVersaoAtual: 'PRESENCA_CONFIRMADA',
  versaoAtualId: 'v1',
  versaoInformadaId: 'v1',
  ultimoEventoAtualId: 'e1',
  ultimoEventoInformadoId: 'e1',
  integracaoIndisponivel: false,
}

const ESTADOS: readonly EstadoItemHomologacao[] = [
  'AGUARDANDO_DISPONIBILIZACAO',
  'PENDENTE_DE_TESTE',
  'CORRECAO_SOLICITADA',
  'AGUARDANDO_RETESTE',
  'APROVADA',
]

describe('transicaoDeHomologacao', () => {
  test('transições válidas: AGUARDANDO_DISPONIBILIZACAO+DISPONIBILIZAR → PENDENTE_DE_TESTE; PENDENTE_DE_TESTE e AGUARDANDO_RETESTE + APROVAR → APROVADA; PENDENTE_DE_TESTE, AGUARDANDO_RETESTE e CORRECAO_SOLICITADA + SOLICITAR_CORRECAO → CORRECAO_SOLICITADA', () => {
    expect(transicaoDeHomologacao('AGUARDANDO_DISPONIBILIZACAO', 'DISPONIBILIZAR', ok)).toEqual({
      novoEstado: 'PENDENTE_DE_TESTE',
    })
    for (const estado of ['PENDENTE_DE_TESTE', 'AGUARDANDO_RETESTE'] as const) {
      expect(transicaoDeHomologacao(estado, 'APROVAR', ok)).toEqual({ novoEstado: 'APROVADA' })
    }
    for (const estado of [
      'PENDENTE_DE_TESTE',
      'AGUARDANDO_RETESTE',
      'CORRECAO_SOLICITADA',
    ] as const) {
      expect(transicaoDeHomologacao(estado, 'SOLICITAR_CORRECAO', ok)).toEqual({
        novoEstado: 'CORRECAO_SOLICITADA',
      })
    }
  })

  test('COMENTAR devolve o mesmo estado nos 5 estados mesmo com presença null, versões e eventos divergentes (A06)', () => {
    const divergente: ContextoDaTransicao = {
      presencaNaVersaoAtual: null,
      versaoAtualId: null,
      versaoInformadaId: 'v0',
      ultimoEventoAtualId: 'e1',
      ultimoEventoInformadoId: 'e0',
      integracaoIndisponivel: true,
    }
    for (const estado of ESTADOS) {
      expect(transicaoDeHomologacao(estado, 'COMENTAR', divergente)).toEqual({ novoEstado: estado })
    }
  })

  test('recusas de estado com os textos exatos da decisão 4 (6 casos)', () => {
    const casos: [
      EstadoItemHomologacao,
      'DISPONIBILIZAR' | 'APROVAR' | 'SOLICITAR_CORRECAO',
      string,
    ][] = [
      ['PENDENTE_DE_TESTE', 'DISPONIBILIZAR', 'Esta issue já foi disponibilizada ao cliente.'],
      [
        'AGUARDANDO_DISPONIBILIZACAO',
        'APROVAR',
        'Disponibilize a issue ao cliente antes de registrar a aprovação.',
      ],
      [
        'CORRECAO_SOLICITADA',
        'APROVAR',
        'Há uma correção solicitada. A aprovação volta a ficar disponível no reteste.',
      ],
      ['APROVADA', 'APROVAR', 'Esta issue já está aprovada para este cliente.'],
      [
        'AGUARDANDO_DISPONIBILIZACAO',
        'SOLICITAR_CORRECAO',
        'Disponibilize a issue ao cliente antes de solicitar correção.',
      ],
      [
        'APROVADA',
        'SOLICITAR_CORRECAO',
        'Esta issue já está aprovada para este cliente. Registre um comentário se encontrou algo novo.',
      ],
    ]
    for (const [estado, acao, recusa] of casos) {
      expect(transicaoDeHomologacao(estado, acao, ok)).toEqual({ recusa })
    }
  })

  test('desatualizado tem precedência: APROVADA+APROVAR com ultimoEventoInformadoId e0 → "Esta homologação mudou desde que você abriu a página. Confira o estado atual e tente de novo."', () => {
    expect(
      transicaoDeHomologacao('APROVADA', 'APROVAR', { ...ok, ultimoEventoInformadoId: 'e0' }),
    ).toEqual({
      recusa:
        'Esta homologação mudou desde que você abriu a página. Confira o estado atual e tente de novo.',
    })
  })

  test('presença SEM_EVIDENCIA, VERIFICACAO_NECESSARIA ou versaoAtualId null recusa APROVAR; CONFIRMACAO_MANUAL aprova', () => {
    const recusa =
      'Não há evidência desta issue na versão atual de QA. A ação fica disponível quando a presença for confirmada.'
    for (const presenca of ['SEM_EVIDENCIA', 'VERIFICACAO_NECESSARIA'] as const) {
      expect(
        transicaoDeHomologacao('PENDENTE_DE_TESTE', 'APROVAR', {
          ...ok,
          presencaNaVersaoAtual: presenca,
        }),
      ).toEqual({ recusa })
    }
    expect(
      transicaoDeHomologacao('PENDENTE_DE_TESTE', 'APROVAR', {
        ...ok,
        versaoAtualId: null,
        versaoInformadaId: null,
      }),
    ).toEqual({ recusa })
    expect(
      transicaoDeHomologacao('PENDENTE_DE_TESTE', 'APROVAR', {
        ...ok,
        presencaNaVersaoAtual: 'CONFIRMACAO_MANUAL',
      }),
    ).toEqual({ novoEstado: 'APROVADA' })
  })

  test('versaoInformadaId v0 com atual v1 → "A versão em QA mudou desde que você abriu a página. Confira a versão atual antes de registrar."', () => {
    expect(
      transicaoDeHomologacao('PENDENTE_DE_TESTE', 'APROVAR', { ...ok, versaoInformadaId: 'v0' }),
    ).toEqual({
      recusa:
        'A versão em QA mudou desde que você abriu a página. Confira a versão atual antes de registrar.',
    })
  })

  test('integracaoIndisponivel recusa APROVAR e DISPONIBILIZAR e permite SOLICITAR_CORRECAO', () => {
    const indisponivel = { ...ok, integracaoIndisponivel: true }
    const recusa =
      'A integração com o GitHub está indisponível e a versão atual em QA não pode ser confirmada. Tente de novo quando a sincronização voltar.'
    expect(transicaoDeHomologacao('PENDENTE_DE_TESTE', 'APROVAR', indisponivel)).toEqual({ recusa })
    expect(
      transicaoDeHomologacao('AGUARDANDO_DISPONIBILIZACAO', 'DISPONIBILIZAR', indisponivel),
    ).toEqual({ recusa })
    expect(transicaoDeHomologacao('PENDENTE_DE_TESTE', 'SOLICITAR_CORRECAO', indisponivel)).toEqual(
      { novoEstado: 'CORRECAO_SOLICITADA' },
    )
  })
})

describe('classificarNaFila', () => {
  test('admin {true,true,true} → requer em AGUARDANDO_DISPONIBILIZACAO, PENDENTE_DE_TESTE, AGUARDANDO_RETESTE; aguardando-outros em CORRECAO_SOLICITADA; aprovado em APROVADA; testador {false,false,true} → aguardando-outros em AGUARDANDO_DISPONIBILIZACAO', () => {
    const admin = { disponibilizar: true, aprovar: true, solicitarCorrecao: true }
    for (const e of [
      'AGUARDANDO_DISPONIBILIZACAO',
      'PENDENTE_DE_TESTE',
      'AGUARDANDO_RETESTE',
    ] as const) {
      expect(classificarNaFila(e, admin)).toBe('requer-minha-acao')
    }
    expect(classificarNaFila('CORRECAO_SOLICITADA', admin)).toBe('aguardando-outros')
    expect(classificarNaFila('APROVADA', admin)).toBe('aprovados')
    const testador = { disponibilizar: false, aprovar: false, solicitarCorrecao: true }
    expect(classificarNaFila('AGUARDANDO_DISPONIBILIZACAO', testador)).toBe('aguardando-outros')
    expect(classificarNaFila('PENDENTE_DE_TESTE', testador)).toBe('requer-minha-acao')
  })
})

describe('apresentação', () => {
  test('apresentarEstadoDoItem: só APROVADA tem tom sucesso', () => {
    const tons = ESTADOS.map((e) => [e, apresentarEstadoDoItem(e).tom])
    expect(tons).toEqual([
      ['AGUARDANDO_DISPONIBILIZACAO', 'neutro'],
      ['PENDENTE_DE_TESTE', 'informacao'],
      ['CORRECAO_SOLICITADA', 'atencao'],
      ['AGUARDANDO_RETESTE', 'informacao'],
      ['APROVADA', 'sucesso'],
    ])
    expect(apresentarEstadoDoItem('AGUARDANDO_DISPONIBILIZACAO').texto).toBe(
      'Aguardando disponibilização',
    )
    expect(apresentarEstadoDoItem('PENDENTE_DE_TESTE').texto).toBe('Pendente de teste')
    expect(apresentarEstadoDoItem('CORRECAO_SOLICITADA').texto).toBe('Correção solicitada')
    expect(apresentarEstadoDoItem('AGUARDANDO_RETESTE').texto).toBe('Aguardando reteste')
    expect(apresentarEstadoDoItem('APROVADA').texto).toBe('Aprovada')
  })

  test('resumoDaHomologacao: [] → "Nenhuma issue em homologação" neutro; [CORRECAO, PENDENTE, PENDENTE, APROVADA] → "1 correção solicitada · 2 pendentes de teste · 1 aprovada" atencao; [APROVADA, APROVADA] → "2 aprovadas" sucesso; [PENDENTE, RETESTE] → "1 aguardando reteste · 1 pendente de teste" informacao', () => {
    expect(resumoDaHomologacao([])).toEqual({
      texto: 'Nenhuma issue em homologação',
      tom: 'neutro',
    })
    expect(
      resumoDaHomologacao([
        'CORRECAO_SOLICITADA',
        'PENDENTE_DE_TESTE',
        'PENDENTE_DE_TESTE',
        'APROVADA',
      ]),
    ).toEqual({
      texto: '1 correção solicitada · 2 pendentes de teste · 1 aprovada',
      tom: 'atencao',
    })
    expect(resumoDaHomologacao(['APROVADA', 'APROVADA'])).toEqual({
      texto: '2 aprovadas',
      tom: 'sucesso',
    })
    expect(resumoDaHomologacao(['PENDENTE_DE_TESTE', 'AGUARDANDO_RETESTE'])).toEqual({
      texto: '1 aguardando reteste · 1 pendente de teste',
      tom: 'informacao',
    })
  })

  test('resumoDaHomologacao: plurais e tom neutro para aguardando disponibilização', () => {
    expect(
      resumoDaHomologacao(['AGUARDANDO_DISPONIBILIZACAO', 'AGUARDANDO_DISPONIBILIZACAO']),
    ).toEqual({ texto: '2 aguardando disponibilização', tom: 'neutro' })
    expect(resumoDaHomologacao(['AGUARDANDO_RETESTE', 'AGUARDANDO_RETESTE']).texto).toBe(
      '2 aguardando reteste',
    )
    expect(resumoDaHomologacao(['CORRECAO_SOLICITADA', 'CORRECAO_SOLICITADA']).texto).toBe(
      '2 correções solicitadas',
    )
  })

  test('tituloDoEvento cobre os nove tipos', () => {
    expect(tituloDoEvento('COMENTARIO')).toBe('Comentário')
    expect(tituloDoEvento('ENTRADA_NA_FILA')).toBe('Entrou na fila de homologação')
    expect(tituloDoEvento('DISPONIBILIZACAO')).toBe('Disponibilizada ao cliente')
    expect(tituloDoEvento('APROVACAO')).toBe('Testado e aprovado')
    expect(tituloDoEvento('SOLICITACAO_CORRECAO')).toBe('Correção solicitada')
    expect(tituloDoEvento('RETESTE_DETECTADO')).toBe('Reteste necessário')
    expect(tituloDoEvento('RETESTE_CONFIRMADO')).toBe('Reteste confirmado')
    expect(tituloDoEvento('TRIAGEM')).toBe('Triagem da correção')
    expect(tituloDoEvento('APROVACAO_MILESTONE')).toBe('Milestone aprovada')
  })
})

describe('filtros e retorno da fila', () => {
  test('lerFiltrosDaFila: {} → requer-minha-acao, nulls; {filtro:"xyz", cliente:"abc"} → padrão e cliente null; {filtro:["todos","aprovados"]} → todos', () => {
    expect(lerFiltrosDaFila({})).toEqual({
      filtro: 'requer-minha-acao',
      clienteId: null,
      milestoneId: null,
    })
    expect(lerFiltrosDaFila({ filtro: 'xyz', cliente: 'abc' })).toEqual({
      filtro: 'requer-minha-acao',
      clienteId: null,
      milestoneId: null,
    })
    expect(lerFiltrosDaFila({ filtro: ['todos', 'aprovados'] }).filtro).toBe('todos')
  })

  test('lerFiltrosDaFila aceita uuid em cliente e milestone', () => {
    const c = '11111111-1111-4111-8111-111111111111'
    const m = '22222222-2222-4222-8222-222222222222'
    expect(lerFiltrosDaFila({ filtro: 'aprovados', cliente: c, milestone: m })).toEqual({
      filtro: 'aprovados',
      clienteId: c,
      milestoneId: m,
    })
  })

  test('hrefDaFila("/projetos/p/homologacao", {filtro:"todos", clienteId:null, milestoneId:"m"}) → "/projetos/p/homologacao?filtro=todos&milestone=m"', () => {
    expect(
      hrefDaFila('/projetos/p/homologacao', { filtro: 'todos', clienteId: null, milestoneId: 'm' }),
    ).toBe('/projetos/p/homologacao?filtro=todos&milestone=m')
  })

  test('lerRetornoDaFila aceita "/projetos/p/homologacao?filtro=aprovados#item-x" e recusa "/projetos/p/homologacaoX", "https://mal.example", "//mal.example", "/projetos/p/homologacao/../x", undefined e 501 caracteres', () => {
    const prefixos = ['/projetos/p/homologacao']
    expect(lerRetornoDaFila('/projetos/p/homologacao?filtro=aprovados#item-x', prefixos)).toBe(
      '/projetos/p/homologacao?filtro=aprovados#item-x',
    )
    expect(lerRetornoDaFila('/projetos/p/homologacao', prefixos)).toBe('/projetos/p/homologacao')
    for (const ruim of [
      '/projetos/p/homologacaoX',
      'https://mal.example',
      '//mal.example',
      '/projetos/p/homologacao/../x',
      undefined,
      '/projetos/p/homologacao?x=' + 'a'.repeat(501),
    ]) {
      expect(lerRetornoDaFila(ruim, prefixos)).toBeNull()
    }
  })
})
