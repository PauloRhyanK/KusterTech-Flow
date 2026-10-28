import { describe, expect, test } from 'vitest'
import {
  agruparRodadas,
  apresentarEstadoDoItem,
  classificarNaFila,
  destinoDaFalhaDaTarefa,
  detectarReteste,
  hrefDaFila,
  lerFiltrosDaFila,
  lerRetornoDaFila,
  MENSAGEM_RESULTADO_INCERTO,
  MENSAGEM_TENTATIVAS_ESGOTADAS,
  podeAprovarMilestone,
  resumoDaHomologacao,
  resumoDeSituacoes,
  resumoDosClientes,
  situacaoDaCorrecao,
  tituloDoEvento,
  transicaoDeHomologacao,
  type ContextoDaTransicao,
  type CorrecaoAcompanhada,
  type EntradaDeReteste,
  type PresencaEmQa,
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
      ['AGUARDANDO_RETESTE', 'atencao'],
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

  test('lerRetornoDaFila: prefixo terminado em "/" aceita a página da milestone, mas não o próprio prefixo de outro projeto', () => {
    const prefixos = ['/c/1/p/2/homologacao', '/c/1/p/2/entregas/milestones/']
    expect(lerRetornoDaFila('/c/1/p/2/entregas/milestones/m-9?aba=homologacao', prefixos)).toBe(
      '/c/1/p/2/entregas/milestones/m-9?aba=homologacao',
    )
    expect(lerRetornoDaFila('/c/1/p/3/entregas/milestones/m-9', prefixos)).toBeNull()
    expect(lerRetornoDaFila('/c/1/p/2/entregas/milestones/../x', prefixos)).toBeNull()
  })
})

const L = new Date('2026-10-20T12:00:00Z')
const F = new Date('2026-10-21T12:00:00Z')
const V2 = new Date('2026-10-22T12:00:00Z')
const V3 = new Date('2026-10-23T12:00:00Z')

function correcao(p: Partial<CorrecaoAcompanhada> = {}): CorrecaoAcompanhada {
  return {
    solicitacaoId: 's1',
    estado: 'CORRECAO_CRIADA',
    issueAlvoId: 'i-corr',
    liberadaEm: L,
    issueAlvoFechadaEm: F,
    ...p,
  }
}

function presenca(p: Partial<PresencaEmQa> = {}): PresencaEmQa {
  return {
    issueId: 'i-corr',
    versaoId: 'v2',
    estado: 'PRESENCA_CONFIRMADA',
    implantadaEm: V2,
    ...p,
  }
}

function reteste(p: Partial<EntradaDeReteste> = {}): EntradaDeReteste {
  return {
    estadoDoItem: 'CORRECAO_SOLICITADA',
    versaoAvaliadaId: 'v1',
    correcoes: [correcao()],
    presencasEmQa: [presenca()],
    ...p,
  }
}

describe('detectarReteste', () => {
  test('PENDENTE_DE_TESTE, APROVADA e AGUARDANDO_RETESTE → { reteste: false, motivo: "item-fora-de-correcao" }', () => {
    for (const estadoDoItem of ['PENDENTE_DE_TESTE', 'APROVADA', 'AGUARDANDO_RETESTE'] as const) {
      expect(detectarReteste(reteste({ estadoDoItem }))).toEqual({
        reteste: false,
        motivo: 'item-fora-de-correcao',
      })
    }
  })

  test('uma ABERTA ao lado de uma CORRECAO_CRIADA pronta → triagem-pendente; só RESPONDIDA_SEM_TAREFA → sem-correcao-com-tarefa', () => {
    expect(
      detectarReteste(
        reteste({
          correcoes: [
            correcao(),
            correcao({
              solicitacaoId: 's2',
              estado: 'ABERTA',
              issueAlvoId: null,
              liberadaEm: null,
              issueAlvoFechadaEm: null,
            }),
          ],
        }),
      ),
    ).toEqual({ reteste: false, motivo: 'triagem-pendente' })
    expect(
      detectarReteste(
        reteste({
          correcoes: [
            correcao({
              estado: 'RESPONDIDA_SEM_TAREFA',
              issueAlvoId: null,
              liberadaEm: null,
              issueAlvoFechadaEm: null,
            }),
          ],
        }),
      ),
    ).toEqual({ reteste: false, motivo: 'sem-correcao-com-tarefa' })
  })

  test('correção sem fechamento → correcao-nao-fechada; fechada em 2026-10-19 (antes de L) → correcao-nao-fechada', () => {
    for (const issueAlvoFechadaEm of [null, new Date('2026-10-19T12:00:00Z')]) {
      expect(detectarReteste(reteste({ correcoes: [correcao({ issueAlvoFechadaEm })] }))).toEqual({
        reteste: false,
        motivo: 'correcao-nao-fechada',
      })
    }
  })

  test('presença só na v1 → sem-presenca-em-qa; v2 com VERIFICACAO_NECESSARIA → sem-presenca-em-qa; v2 implantada em 2026-10-21T06:00Z (antes de F) → sem-presenca-em-qa', () => {
    const sem = { reteste: false, motivo: 'sem-presenca-em-qa' }
    expect(detectarReteste(reteste({ presencasEmQa: [presenca({ versaoId: 'v1' })] }))).toEqual(sem)
    expect(
      detectarReteste(reteste({ presencasEmQa: [presenca({ estado: 'VERIFICACAO_NECESSARIA' })] })),
    ).toEqual(sem)
    expect(
      detectarReteste(
        reteste({ presencasEmQa: [presenca({ implantadaEm: new Date('2026-10-21T06:00:00Z') })] }),
      ),
    ).toEqual(sem)
  })

  test('CORRECAO_CRIADA s1 fechada em F e PRESENCA_CONFIRMADA na v2 → { reteste: true, versaoId: "v2", solicitacoesResolvidas: ["s1"], origem: "evidencia" }', () => {
    expect(detectarReteste(reteste())).toEqual({
      reteste: true,
      versaoId: 'v2',
      solicitacoesResolvidas: ['s1'],
      origem: 'evidencia',
    })
  })

  test('v2 e v3 qualificadas → v3; presença CONFIRMACAO_MANUAL → origem "presenca-manual"; s1 só na v2 e s2 só na v3 → sem-presenca-em-qa; as duas na v3 → v3 com ["s1", "s2"]', () => {
    expect(
      detectarReteste(
        reteste({
          presencasEmQa: [presenca(), presenca({ versaoId: 'v3', implantadaEm: V3 })],
        }),
      ),
    ).toMatchObject({ reteste: true, versaoId: 'v3' })
    expect(
      detectarReteste(reteste({ presencasEmQa: [presenca({ estado: 'CONFIRMACAO_MANUAL' })] })),
    ).toMatchObject({ reteste: true, origem: 'presenca-manual' })

    const duas = [correcao(), correcao({ solicitacaoId: 's2', issueAlvoId: 'i-corr2' })]
    expect(
      detectarReteste(
        reteste({
          correcoes: duas,
          presencasEmQa: [
            presenca(),
            presenca({ issueId: 'i-corr2', versaoId: 'v3', implantadaEm: V3 }),
          ],
        }),
      ),
    ).toEqual({ reteste: false, motivo: 'sem-presenca-em-qa' })
    expect(
      detectarReteste(
        reteste({
          correcoes: duas,
          presencasEmQa: [
            presenca({ versaoId: 'v3', implantadaEm: V3 }),
            presenca({ issueId: 'i-corr2', versaoId: 'v3', implantadaEm: V3 }),
          ],
        }),
      ),
    ).toEqual({
      reteste: true,
      versaoId: 'v3',
      solicitacoesResolvidas: ['s1', 's2'],
      origem: 'evidencia',
    })
  })
})

describe('podeAprovarMilestone', () => {
  const fechada = (issueId: string, foraDoEscopo = false) => ({
    issueId,
    estado: 'FECHADA' as const,
    foraDoEscopo,
  })
  const aberta = (issueId: string, foraDoEscopo = false) => ({
    issueId,
    estado: 'ABERTA' as const,
    foraDoEscopo,
  })
  const base = {
    estado: 'EM_ANDAMENTO' as const,
    issuesDoEscopo: [fechada('a'), fechada('b')],
    itensDisponibilizados: 2,
    solicitacoes: [],
  }

  test('duas FECHADA, 2 disponibilizados, sem solicitações → { pode: true }; a mesma issue ABERTA repetida conta uma vez; três abertas → plural; ABERTA com foraDoEscopo não conta', () => {
    expect(podeAprovarMilestone(base)).toEqual({ pode: true })
    expect(
      podeAprovarMilestone({
        ...base,
        issuesDoEscopo: [fechada('a'), aberta('b'), aberta('b')],
      }),
    ).toEqual({ pode: false, motivos: ['1 issue do escopo ainda está aberta no GitHub.'] })
    expect(
      podeAprovarMilestone({
        ...base,
        issuesDoEscopo: [aberta('a'), aberta('b'), aberta('c')],
      }),
    ).toEqual({ pode: false, motivos: ['3 issues do escopo ainda estão abertas no GitHub.'] })
    expect(
      podeAprovarMilestone({
        ...base,
        issuesDoEscopo: [fechada('a'), aberta('b', true)],
      }),
    ).toEqual({ pode: true })
  })

  test('ABERTA, REABERTA_NO_GITHUB e CORRECAO_CRIADA → "3 correções bloqueadoras em aberto."; RESPONDIDA_SEM_TAREFA, RESOLVIDA e foraDoEscopo não bloqueiam', () => {
    const s = (id: string, estado: string, foraDoEscopo = false) => ({
      id,
      estado: estado as 'ABERTA',
      foraDoEscopo,
    })
    expect(
      podeAprovarMilestone({
        ...base,
        solicitacoes: [
          s('1', 'ABERTA'),
          s('2', 'REABERTA_NO_GITHUB'),
          s('3', 'CORRECAO_CRIADA'),
          s('4', 'RESPONDIDA_SEM_TAREFA'),
          s('5', 'RESOLVIDA'),
          s('6', 'ABERTA', true),
        ],
      }),
    ).toEqual({ pode: false, motivos: ['3 correções bloqueadoras em aberto.'] })
    expect(podeAprovarMilestone({ ...base, solicitacoes: [s('1', 'ABERTA')] })).toEqual({
      pode: false,
      motivos: ['1 correção bloqueadora em aberto.'],
    })
  })

  test('APROVADA → só "A milestone já foi aprovada por este cliente."; escopo vazio e 0 disponibilizados → os dois motivos nessa ordem', () => {
    expect(
      podeAprovarMilestone({
        ...base,
        estado: 'APROVADA',
        issuesDoEscopo: [aberta('a')],
        itensDisponibilizados: 0,
      }),
    ).toEqual({ pode: false, motivos: ['A milestone já foi aprovada por este cliente.'] })
    expect(podeAprovarMilestone({ ...base, issuesDoEscopo: [], itensDisponibilizados: 0 })).toEqual(
      {
        pode: false,
        motivos: [
          'A milestone não tem issues no escopo.',
          'Nenhum item desta milestone foi disponibilizado em QA para este cliente.',
        ],
      },
    )
  })
})

describe('destinoDaFalhaDaTarefa', () => {
  const agora = new Date('2026-10-27T12:00:00Z')
  const em = (hhmm: string) => new Date(`2026-10-27T${hhmm}:00Z`)

  test('REABRIR rede 1 → PENDENTE 12:01; 2 → 12:02; 3 → FALHOU esgotadas; CRIAR rede 1 → FALHOU incerto; CRIAR limite com tentarApos 12:30 → PENDENTE 12:30; CRIAR autenticacao → "A GitHub App recusou as credenciais."', () => {
    expect(destinoDaFalhaDaTarefa('REABRIR_ISSUE', 'rede', 1, undefined, agora)).toEqual({
      estado: 'PENDENTE',
      proximaTentativaEm: em('12:01'),
    })
    expect(destinoDaFalhaDaTarefa('REABRIR_ISSUE', 'rede', 2, undefined, agora)).toEqual({
      estado: 'PENDENTE',
      proximaTentativaEm: em('12:02'),
    })
    expect(destinoDaFalhaDaTarefa('REABRIR_ISSUE', 'rede', 3, undefined, agora)).toEqual({
      estado: 'FALHOU',
      motivo: MENSAGEM_TENTATIVAS_ESGOTADAS,
    })
    expect(destinoDaFalhaDaTarefa('CRIAR_ISSUE', 'rede', 1, undefined, agora)).toEqual({
      estado: 'FALHOU',
      motivo: MENSAGEM_RESULTADO_INCERTO,
    })
    expect(destinoDaFalhaDaTarefa('CRIAR_ISSUE', 'limite', 1, em('12:30'), agora)).toEqual({
      estado: 'PENDENTE',
      proximaTentativaEm: em('12:30'),
    })
    expect(destinoDaFalhaDaTarefa('CRIAR_ISSUE', 'autenticacao', 1, undefined, agora)).toEqual({
      estado: 'FALHOU',
      motivo: 'A GitHub App recusou as credenciais.',
    })
  })
})

describe('transicaoDeHomologacao — reteste', () => {
  test('CORRECAO_SOLICITADA + CONFIRMAR_RETESTE → AGUARDANDO_RETESTE; os outros estados → recusa; AGUARDANDO_RETESTE + APROVAR → APROVADA, + SOLICITAR_CORRECAO → CORRECAO_SOLICITADA, + COMENTAR → AGUARDANDO_RETESTE', () => {
    expect(transicaoDeHomologacao('CORRECAO_SOLICITADA', 'CONFIRMAR_RETESTE', ok)).toEqual({
      novoEstado: 'AGUARDANDO_RETESTE',
    })
    for (const estado of ESTADOS.filter((e) => e !== 'CORRECAO_SOLICITADA')) {
      expect(transicaoDeHomologacao(estado, 'CONFIRMAR_RETESTE', ok)).toEqual({
        recusa: 'Só um item com correção solicitada volta para reteste.',
      })
    }
    expect(transicaoDeHomologacao('AGUARDANDO_RETESTE', 'APROVAR', ok)).toEqual({
      novoEstado: 'APROVADA',
    })
    expect(transicaoDeHomologacao('AGUARDANDO_RETESTE', 'SOLICITAR_CORRECAO', ok)).toEqual({
      novoEstado: 'CORRECAO_SOLICITADA',
    })
    expect(transicaoDeHomologacao('AGUARDANDO_RETESTE', 'COMENTAR', ok)).toEqual({
      novoEstado: 'AGUARDANDO_RETESTE',
    })
  })
})

describe('situacaoDaCorrecao', () => {
  const tarefa = (
    tipo: 'REABRIR_ISSUE' | 'CRIAR_ISSUE',
    estado: 'PENDENTE' | 'FALHOU',
    falhaMotivo: string | null = null,
  ) => ({
    tipo,
    estado,
    falhaMotivo,
  })

  test('as sete correspondências; nenhuma com tom sucesso', () => {
    const casos = [
      [{ estado: 'ABERTA', tarefa: null, numeroAlvo: null }, 'Aguardando triagem', 'atencao'],
      [
        { estado: 'ABERTA', tarefa: tarefa('REABRIR_ISSUE', 'PENDENTE'), numeroAlvo: null },
        'Reabertura no GitHub pendente',
        'informacao',
      ],
      [
        { estado: 'ABERTA', tarefa: tarefa('CRIAR_ISSUE', 'PENDENTE'), numeroAlvo: null },
        'Criação da issue de correção pendente',
        'informacao',
      ],
      [
        {
          estado: 'ABERTA',
          tarefa: tarefa('CRIAR_ISSUE', 'FALHOU', MENSAGEM_TENTATIVAS_ESGOTADAS),
          numeroAlvo: null,
        },
        `Falha no GitHub: ${MENSAGEM_TENTATIVAS_ESGOTADAS}`,
        'erro',
      ],
      [
        { estado: 'REABERTA_NO_GITHUB', tarefa: null, numeroAlvo: 4 },
        'Issue #4 reaberta no GitHub',
        'informacao',
      ],
      [
        { estado: 'CORRECAO_CRIADA', tarefa: null, numeroAlvo: 316000 },
        'Correção #316000 criada no GitHub',
        'informacao',
      ],
      [
        { estado: 'RESPONDIDA_SEM_TAREFA', tarefa: null, numeroAlvo: null },
        'Respondida sem tarefa',
        'neutro',
      ],
      [
        { estado: 'RESOLVIDA', tarefa: null, numeroAlvo: 4 },
        'Correção disponível em QA',
        'informacao',
      ],
    ] as const
    for (const [entrada, texto, tom] of casos) {
      expect(situacaoDaCorrecao(entrada)).toEqual({ texto, tom })
      expect(situacaoDaCorrecao(entrada).tom).not.toBe('sucesso')
    }
  })
})

describe('classificarNaFila com triagem pendente (base §3.8, item 10)', () => {
  const admin = { disponibilizar: true, aprovar: true, solicitarCorrecao: true, triar: true }

  test('CORRECAO_SOLICITADA com solicitação a triar → requer-minha-acao só para quem triar', () => {
    expect(classificarNaFila('CORRECAO_SOLICITADA', admin, true)).toBe('requer-minha-acao')
    expect(classificarNaFila('CORRECAO_SOLICITADA', admin, false)).toBe('aguardando-outros')
    expect(classificarNaFila('CORRECAO_SOLICITADA', { ...admin, triar: false }, true)).toBe(
      'aguardando-outros',
    )
  })
})

describe('agruparRodadas', () => {
  const em = (minuto: number) => new Date(Date.UTC(2026, 9, 22, 12, minuto))
  const eventos = [
    { id: 'e1', versaoId: 'v1', criadoEm: em(1) },
    { id: 'e2', versaoId: null, criadoEm: em(2) },
    { id: 'e3', versaoId: 'v1', criadoEm: em(3) },
    { id: 'e4', versaoId: 'v2', criadoEm: em(4) },
    { id: 'e5', versaoId: null, criadoEm: em(5) },
  ]

  test('[e1 v1, e2 null, e3 v1, e4 v2, e5 null] com atual v2 → [{ v1, atual: false, [e1, e2, e3] }, { v2, atual: true, [e4, e5] }]; atual nulo → última rodada', () => {
    expect(agruparRodadas(eventos, 'v2')).toEqual([
      { versaoId: 'v1', atual: false, eventos: [eventos[0], eventos[1], eventos[2]] },
      { versaoId: 'v2', atual: true, eventos: [eventos[3], eventos[4]] },
    ])
    expect(agruparRodadas(eventos, null).map((r) => r.atual)).toEqual([false, true])
  })

  test('ordena por criadoEm, mesmo fora de ordem; sem eventos → []', () => {
    const desordenados = [eventos[3]!, eventos[0]!, eventos[2]!, eventos[1]!]
    expect(agruparRodadas(desordenados, 'v1').map((r) => [r.versaoId, r.atual])).toEqual([
      ['v1', true],
      ['v2', false],
    ])
    expect(agruparRodadas([], null)).toEqual([])
  })

  test('evento sem versão no começo abre a própria rodada sem versão', () => {
    const r = agruparRodadas([{ id: 'a', versaoId: null, criadoEm: em(0) }, eventos[0]!], 'v1')
    expect(r.map((x) => x.versaoId)).toEqual([null, 'v1'])
  })

  test('versão que volta depois de outra continua na rodada do primeiro evento dela', () => {
    const r = agruparRodadas(
      [
        { id: 'a', versaoId: 'v1', criadoEm: em(1) },
        { id: 'b', versaoId: 'v2', criadoEm: em(2) },
        { id: 'c', versaoId: 'v1', criadoEm: em(3) },
      ],
      'v2',
    )
    expect(r.map((x) => [x.versaoId, x.eventos.map((e) => e.id)])).toEqual([
      ['v1', ['a', 'c']],
      ['v2', ['b']],
    ])
  })
})

describe('resumoDeSituacoes', () => {
  test('2 PENDENTE_DE_TESTE + 1 CORRECAO_SOLICITADA → "2 pendentes de teste · 1 correção solicitada"; [] → "Nenhum item em homologação ainda."', () => {
    expect(
      resumoDeSituacoes([
        { estado: 'CORRECAO_SOLICITADA' },
        { estado: 'PENDENTE_DE_TESTE' },
        { estado: 'PENDENTE_DE_TESTE' },
      ]),
    ).toBe('2 pendentes de teste · 1 correção solicitada')
    expect(resumoDeSituacoes([])).toBe('Nenhum item em homologação ainda.')
  })

  test('ordem do Blueprint §6 e singular/plural de cada estado', () => {
    expect(
      resumoDeSituacoes([
        { estado: 'APROVADA' },
        { estado: 'AGUARDANDO_RETESTE' },
        { estado: 'AGUARDANDO_DISPONIBILIZACAO' },
        { estado: 'AGUARDANDO_DISPONIBILIZACAO' },
        { estado: 'CORRECAO_SOLICITADA' },
        { estado: 'CORRECAO_SOLICITADA' },
        { estado: 'PENDENTE_DE_TESTE' },
      ]),
    ).toBe(
      '2 aguardando disponibilização · 1 pendente de teste · 2 correções solicitadas · 1 aguardando reteste · 1 aprovada',
    )
    expect(resumoDeSituacoes([{ estado: 'APROVADA' }, { estado: 'APROVADA' }])).toBe('2 aprovadas')
  })
})

describe('resumoDosClientes', () => {
  test('[APROVADA, EM_ANDAMENTO] → "2 clientes · 1 com milestone aprovada · 1 em andamento"; [APROVADA] → "1 cliente · 1 com milestone aprovada"', () => {
    expect(resumoDosClientes(['APROVADA', 'EM_ANDAMENTO'])).toBe(
      '2 clientes · 1 com milestone aprovada · 1 em andamento',
    )
    expect(resumoDosClientes(['APROVADA'])).toBe('1 cliente · 1 com milestone aprovada')
  })

  test('partes zeradas são omitidas; dois aprovados; sem clientes', () => {
    expect(resumoDosClientes(['APROVADA', 'APROVADA'])).toBe(
      '2 clientes · 2 com milestone aprovada',
    )
    expect(resumoDosClientes(['EM_ANDAMENTO'])).toBe('1 cliente · 1 em andamento')
    expect(resumoDosClientes([])).toBe('Nenhum cliente associado.')
  })
})
