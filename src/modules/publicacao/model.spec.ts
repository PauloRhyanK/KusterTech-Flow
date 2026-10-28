import { describe, expect, test } from 'vitest'
import {
  aprovacaoInalterada,
  avaliarAutorizacaoProd,
  deltaDePublicacao,
  deployEhDivergente,
  descreverItemDesconhecido,
  estadosDePublicacao,
  hashDaComposicao,
  resumirEstadosDaMilestone,
  SHA_NULO,
  type EntradaDeAutorizacao,
  type EntradaDoDelta,
  type EntradaDosEstados,
  type ItemDaComposicao,
} from './model'

const B = 'a'.repeat(40)
const A = 'b'.repeat(40)
const M5 = 'c'.repeat(40)
const X = 'd'.repeat(40)
const M7 = 'e'.repeat(40)
const M8 = 'f'.repeat(40)

const issue2 = { id: 'i2', numero: 2 }

function delta(parcial: Partial<EntradaDoDelta>): EntradaDoDelta {
  return {
    commitBase: B,
    comparacao: { status: 'ahead', commits: [], truncada: false },
    pullRequests: [],
    issues: [issue2],
    ...parcial,
  }
}

function pr(
  numero: number,
  sha: string,
  issues: number[],
  estado: 'ABERTO' | 'MERGEADO' = 'MERGEADO',
) {
  return {
    numero,
    estado,
    shaMerge: estado === 'MERGEADO' ? sha : null,
    shaHead: estado === 'MERGEADO' ? 'h'.repeat(40) : sha,
    issuesReferenciadas: issues,
  }
}

describe('deltaDePublicacao', () => {
  test('base nula → INCERTA [{tipo:"sem-base"}]; behind → historico-divergente; identical → IDENTIFICADA []', () => {
    expect(SHA_NULO).toBe('0'.repeat(40))
    expect(deltaDePublicacao(delta({ commitBase: null, comparacao: null }))).toEqual({
      estado: 'INCERTA',
      itens: [{ tipo: 'sem-base' }],
    })
    expect(
      deltaDePublicacao(delta({ comparacao: { status: 'behind', commits: [], truncada: false } })),
    ).toEqual({
      estado: 'INCERTA',
      itens: [{ tipo: 'historico-divergente', status: 'behind' }],
    })
    expect(
      deltaDePublicacao(
        delta({ comparacao: { status: 'diverged', commits: [], truncada: false } }),
      ),
    ).toEqual({
      estado: 'INCERTA',
      itens: [{ tipo: 'historico-divergente', status: 'diverged' }],
    })
    expect(
      deltaDePublicacao(
        delta({ comparacao: { status: 'identical', commits: [], truncada: false } }),
      ),
    ).toEqual({ estado: 'IDENTIFICADA', itens: [] })
  })

  test('ahead [M5] com PR #5 MERGEADO shaMerge M5 "Closes #2" → IDENTIFICADA [{tipo:"issue", numero:2, prs:[5], commits:[M5]}]', () => {
    expect(
      deltaDePublicacao(
        delta({
          comparacao: { status: 'ahead', commits: [M5], truncada: false },
          pullRequests: [pr(5, M5, [2])],
        }),
      ),
    ).toEqual({
      estado: 'IDENTIFICADA',
      itens: [{ tipo: 'issue', issueId: 'i2', numero: 2, prs: [5], commits: [M5] }],
    })
  })

  test('commit igual ao shaHead de PR MERGEADO é do PR; igual ao shaHead de PR ABERTO → commit-sem-pr', () => {
    const comoHead = {
      numero: 5,
      estado: 'MERGEADO' as const,
      shaMerge: null,
      shaHead: M5,
      issuesReferenciadas: [2],
    }
    expect(
      deltaDePublicacao(
        delta({
          comparacao: { status: 'ahead', commits: [M5], truncada: false },
          pullRequests: [comoHead],
        }),
      ),
    ).toEqual({
      estado: 'IDENTIFICADA',
      itens: [{ tipo: 'issue', issueId: 'i2', numero: 2, prs: [5], commits: [M5] }],
    })
    expect(
      deltaDePublicacao(
        delta({
          comparacao: { status: 'ahead', commits: [M5], truncada: false },
          pullRequests: [pr(5, M5, [2], 'ABERTO')],
        }),
      ),
    ).toEqual({ estado: 'INCERTA', itens: [{ tipo: 'commit-sem-pr', commit: M5 }] })
  })

  test('ahead [M5, X, M7, M8]: X sem PR, #7 sem issue, #8 referencia #9 não espelhada → INCERTA com 3 desconhecidos; truncada acrescenta comparacao-truncada', () => {
    const entrada = delta({
      comparacao: { status: 'ahead', commits: [M5, X, M7, M8], truncada: false },
      pullRequests: [pr(5, M5, [2]), pr(7, M7, []), pr(8, M8, [9])],
    })
    const r = deltaDePublicacao(entrada)
    expect(r.estado).toBe('INCERTA')
    expect(r.itens).toEqual([
      { tipo: 'issue', issueId: 'i2', numero: 2, prs: [5], commits: [M5] },
      { tipo: 'commit-sem-pr', commit: X },
      { tipo: 'issue-nao-espelhada', pr: 8, numero: 9 },
      { tipo: 'pr-sem-issue', pr: 7, commit: M7 },
    ])
    const t = deltaDePublicacao({
      ...entrada,
      comparacao: { status: 'ahead', commits: [M5, X, M7, M8], truncada: true },
    })
    expect(t.itens).toContainEqual({ tipo: 'comparacao-truncada' })
    expect(t.itens.filter((i) => i.tipo !== 'issue')).toHaveLength(4)
  })

  test('PRs #5 e #7 da mesma issue #2 → um item, prs [5, 7], commits ordenados', () => {
    const r = deltaDePublicacao(
      delta({
        comparacao: { status: 'ahead', commits: [M7, M5], truncada: false },
        pullRequests: [pr(7, M7, [2]), pr(5, M5, [2])],
      }),
    )
    expect(r).toEqual({
      estado: 'IDENTIFICADA',
      itens: [{ tipo: 'issue', issueId: 'i2', numero: 2, prs: [5, 7], commits: [M5, M7] }],
    })
  })
})

describe('hashDaComposicao', () => {
  const itens: ItemDaComposicao[] = [
    { tipo: 'issue', issueId: 'i2', numero: 2, prs: [5], commits: [M5] },
    { tipo: 'commit-sem-pr', commit: X },
  ]

  test('valores exatos; ordem de entrada e issueId não mudam o hash', () => {
    expect(hashDaComposicao({ commitBase: B, commitAlvo: A, itens })).toBe(
      '3ca72bcd7e3f74eddc0bfeb19a94059e59e8977184b49fc5f729cedcd36739e7',
    )
    expect(hashDaComposicao({ commitBase: B, commitAlvo: A, itens: [] })).toBe(
      '47f90a734124df7096bbe57d5da26c5742171340c21ea47c11efd1cf1008472a',
    )
    expect(hashDaComposicao({ commitBase: B, commitAlvo: A, itens: [itens[1]!, itens[0]!] })).toBe(
      hashDaComposicao({ commitBase: B, commitAlvo: A, itens }),
    )
    expect(
      hashDaComposicao({
        commitBase: B,
        commitAlvo: A,
        itens: [
          { tipo: 'issue', issueId: 'outro-id', numero: 2, prs: [5], commits: [M5] },
          itens[1]!,
        ],
      }),
    ).toBe(hashDaComposicao({ commitBase: B, commitAlvo: A, itens }))
  })
})

test('aprovacaoInalterada: [ahead, identical] → true; [ahead, behind] → false; [ahead, null] → null; [] → null', () => {
  expect(aprovacaoInalterada(['ahead', 'identical'])).toBe(true)
  expect(aprovacaoInalterada(['ahead', 'behind'])).toBe(false)
  expect(aprovacaoInalterada(['ahead', 'diverged'])).toBe(false)
  expect(aprovacaoInalterada(['ahead', null])).toBeNull()
  expect(aprovacaoInalterada([])).toBeNull()
})

const confirmado = {
  contextoConferido: true,
  desconhecidosConferidos: false,
  verificadasPorHumano: [] as string[],
  justificativa: null,
}

function autorizacao(parcial: Partial<EntradaDeAutorizacao>): EntradaDeAutorizacao {
  return {
    alvoId: 'v2',
    composicao: {
      estado: 'IDENTIFICADA',
      itens: [{ tipo: 'issue', issueId: 'i2', numero: 2, prs: [5], commits: [M5] }],
    },
    integracao: 'conectada',
    issues: [
      {
        issueId: 'i2',
        numero: 2,
        homologacoes: [],
        correcoesBloqueadoras: [],
      },
    ],
    aprovacoesAnteriores: [],
    autorizacaoAnterior: null,
    confirmacao: confirmado,
    ...parcial,
  }
}

const alvo = { id: 'v2', rotulo: 'v2' }
const aprovada = (cliente: string, versao: { id: string; rotulo: string } | null = alvo) => ({
  cliente,
  estado: 'APROVADA' as const,
  versaoAvaliada: versao,
})
const pendente = (cliente: string) => ({
  cliente,
  estado: 'PENDENTE_DE_TESTE' as const,
  versaoAvaliada: null,
})

describe('avaliarAutorizacaoProd', () => {
  test('A10: Acme APROVADA no alvo e Beta PENDENTE_DE_TESTE → pode, QA_APROVADO, aviso "#2: homologação de Beta ainda pendente (não bloqueia a autorização)."', () => {
    const r = avaliarAutorizacaoProd(
      autorizacao({
        issues: [
          {
            issueId: 'i2',
            numero: 2,
            homologacoes: [aprovada('Acme'), pendente('Beta')],
            correcoesBloqueadoras: [],
          },
        ],
      }),
    )
    expect(r.pode).toBe(true)
    expect(r.itens[0]).toMatchObject({
      issueId: 'i2',
      situacao: 'QA_APROVADO',
      motivo: 'QA aprovado nesta versão.',
      afetado: false,
      exigeVerificacaoHumana: false,
    })
    expect(r.avisos).toEqual([
      '#2: homologação de Beta ainda pendente (não bloqueia a autorização).',
    ])
    expect(r.bloqueios).toEqual([])
    expect(r.pendencias).toEqual([])
  })

  test('A10: Acme e Beta pendentes → bloqueio "#2: QA pendente."; D69: Acme APROVADA e correção bloqueadora de Beta → bloqueio "#2: Correção bloqueadora aberta (Beta)."', () => {
    const pend = avaliarAutorizacaoProd(
      autorizacao({
        issues: [
          {
            issueId: 'i2',
            numero: 2,
            homologacoes: [pendente('Acme'), pendente('Beta')],
            correcoesBloqueadoras: [],
          },
        ],
      }),
    )
    expect(pend.pode).toBe(false)
    expect(pend.bloqueios).toEqual(['#2: QA pendente.'])
    const corr = avaliarAutorizacaoProd(
      autorizacao({
        issues: [
          {
            issueId: 'i2',
            numero: 2,
            homologacoes: [aprovada('Acme'), pendente('Beta')],
            correcoesBloqueadoras: [{ cliente: 'Beta' }],
          },
        ],
      }),
    )
    expect(corr.pode).toBe(false)
    expect(corr.bloqueios).toEqual(['#2: Correção bloqueadora aberta (Beta).'])
  })

  test('A08: aprovação na versão "v1" inalterada → REAPROVEITADO com o motivo citando v1; inalterada false → bloqueio "#2: Alterada depois da aprovação de QA; precisa de novo teste."; null → pendência; null e marcada → VERIFICADO_POR_HUMANO', () => {
    const issues = [
      {
        issueId: 'i2',
        numero: 2,
        homologacoes: [aprovada('Acme', { id: 'v1', rotulo: 'v1' })],
        correcoesBloqueadoras: [],
      },
    ]
    const inalterada = avaliarAutorizacaoProd(
      autorizacao({
        issues,
        aprovacoesAnteriores: [{ issueId: 'i2', versaoId: 'v1', inalterada: true }],
      }),
    )
    expect(inalterada.pode).toBe(true)
    expect(inalterada.itens[0]).toMatchObject({
      situacao: 'REAPROVEITADO',
      motivo: 'Aprovação de QA da versão v1 reaproveitada: a issue não mudou desde então.',
    })

    const alterada = avaliarAutorizacaoProd(
      autorizacao({
        issues,
        aprovacoesAnteriores: [{ issueId: 'i2', versaoId: 'v1', inalterada: false }],
      }),
    )
    expect(alterada.pode).toBe(false)
    expect(alterada.bloqueios).toEqual([
      '#2: Alterada depois da aprovação de QA; precisa de novo teste.',
    ])

    const incerta = avaliarAutorizacaoProd(
      autorizacao({
        issues,
        aprovacoesAnteriores: [{ issueId: 'i2', versaoId: 'v1', inalterada: null }],
      }),
    )
    expect(incerta.pode).toBe(false)
    expect(incerta.pendencias).toContain(
      '#2: Não foi possível comprovar que a issue não mudou desde a aprovação; verificação humana necessária.',
    )
    expect(incerta.itens[0]).toMatchObject({ situacao: null, exigeVerificacaoHumana: true })

    const marcada = avaliarAutorizacaoProd(
      autorizacao({
        issues,
        aprovacoesAnteriores: [{ issueId: 'i2', versaoId: 'v1', inalterada: null }],
        confirmacao: {
          ...confirmado,
          verificadasPorHumano: ['i2'],
          justificativa: 'Conferi o diff da issue na versão anterior.',
        },
      }),
    )
    expect(marcada.pode).toBe(true)
    expect(marcada.itens[0]).toMatchObject({
      situacao: 'VERIFICADO_POR_HUMANO',
      motivo: 'Verificada manualmente nesta autorização.',
    })
  })

  test('A08: anterior com #2 [m2] e #3 [m3] VERIFICADO_POR_HUMANO; nova com #2 [m2] e #3 [m3, x] → #2 REAPROVEITADO afetado false; #3 afetado true e pendência de verificação', () => {
    const r = avaliarAutorizacaoProd(
      autorizacao({
        composicao: {
          estado: 'IDENTIFICADA',
          itens: [
            { tipo: 'issue', issueId: 'i2', numero: 2, prs: [5], commits: ['m2'] },
            { tipo: 'issue', issueId: 'i3', numero: 3, prs: [6], commits: ['m3', 'x'] },
          ],
        },
        issues: [
          { issueId: 'i2', numero: 2, homologacoes: [], correcoesBloqueadoras: [] },
          { issueId: 'i3', numero: 3, homologacoes: [], correcoesBloqueadoras: [] },
        ],
        autorizacaoAnterior: {
          itens: [
            { tipo: 'issue', issueId: 'i2', numero: 2, prs: [5], commits: ['m2'] },
            { tipo: 'issue', issueId: 'i3', numero: 3, prs: [6], commits: ['m3'] },
          ],
          situacoes: [
            { issueId: 'i2', situacao: 'VERIFICADO_POR_HUMANO' },
            { issueId: 'i3', situacao: 'VERIFICADO_POR_HUMANO' },
          ],
        },
      }),
    )
    expect(r.itens[0]).toMatchObject({
      issueId: 'i2',
      situacao: 'REAPROVEITADO',
      motivo: 'Verificação da autorização anterior reaproveitada: a issue não mudou.',
      afetado: false,
    })
    expect(r.itens[1]).toMatchObject({
      issueId: 'i3',
      situacao: null,
      afetado: true,
      exigeVerificacaoHumana: true,
    })
    expect(r.pendencias).toContain('#3: Sem homologação; verificação humana necessária.')
    expect(r.pode).toBe(false)
  })

  test('sem homologação marcada exige justificativa ≥ 10; INCERTA sem desconhecidosConferidos → "A composição tem 1 item desconhecido; confira manualmente."; sem contextoConferido → pode false; integração sem-dados-recentes e composição vazia bloqueiam', () => {
    const semHomologacao = {
      issues: [{ issueId: 'i2', numero: 2, homologacoes: [], correcoesBloqueadoras: [] }],
    }
    const curta = avaliarAutorizacaoProd(
      autorizacao({
        ...semHomologacao,
        confirmacao: { ...confirmado, verificadasPorHumano: ['i2'], justificativa: ' curta ' },
      }),
    )
    expect(curta.pode).toBe(false)
    expect(curta.pendencias).toEqual(['Justifique a conferência manual (mínimo de 10 caracteres).'])
    const longa = avaliarAutorizacaoProd(
      autorizacao({
        ...semHomologacao,
        confirmacao: {
          ...confirmado,
          verificadasPorHumano: ['i2'],
          justificativa: 'Revisei o PR e testei manualmente.',
        },
      }),
    )
    expect(longa.pode).toBe(true)

    const incerta = avaliarAutorizacaoProd(
      autorizacao({
        composicao: {
          estado: 'INCERTA',
          itens: [
            { tipo: 'issue', issueId: 'i2', numero: 2, prs: [5], commits: [M5] },
            { tipo: 'commit-sem-pr', commit: X },
          ],
        },
        issues: [
          {
            issueId: 'i2',
            numero: 2,
            homologacoes: [aprovada('Acme')],
            correcoesBloqueadoras: [],
          },
        ],
      }),
    )
    expect(incerta.pode).toBe(false)
    expect(incerta.desconhecidos).toEqual([{ tipo: 'commit-sem-pr', commit: X }])
    expect(incerta.pendencias).toEqual([
      'A composição tem 1 item desconhecido; confira manualmente.',
      'Justifique a conferência manual (mínimo de 10 caracteres).',
    ])
    const dois = avaliarAutorizacaoProd(
      autorizacao({
        composicao: {
          estado: 'INCERTA',
          itens: [{ tipo: 'commit-sem-pr', commit: X }, { tipo: 'sem-base' }],
        },
        issues: [],
      }),
    )
    expect(dois.pendencias[0]).toBe('A composição tem 2 itens desconhecidos; confira manualmente.')

    const semContexto = avaliarAutorizacaoProd(
      autorizacao({
        issues: [
          { issueId: 'i2', numero: 2, homologacoes: [aprovada('Acme')], correcoesBloqueadoras: [] },
        ],
        confirmacao: { ...confirmado, contextoConferido: false },
      }),
    )
    expect(semContexto.pode).toBe(false)
    expect(semContexto.pendencias).toEqual([
      'Confirme o projeto, o repositório, a versão e a composição.',
    ])

    const velha = avaliarAutorizacaoProd(autorizacao({ integracao: 'sem-dados-recentes' }))
    expect(velha.bloqueios[0]).toBe(
      'Os dados do GitHub deste repositório podem estar desatualizados. Autorize depois da próxima sincronização.',
    )
    const vazia = avaliarAutorizacaoProd(
      autorizacao({ composicao: { estado: 'IDENTIFICADA', itens: [] }, issues: [] }),
    )
    expect(vazia.pode).toBe(false)
    expect(vazia.bloqueios).toEqual(['A versão em QA não traz alterações em relação à base.'])
  })

  test('errata §3.8-6: correção sem item próprio herda a situação da issue original (não vira "Sem homologação")', () => {
    const r = avaliarAutorizacaoProd(
      autorizacao({
        issues: [
          {
            issueId: 'i2',
            numero: 2,
            homologacoes: [],
            correcoesBloqueadoras: [],
            corrigeIssues: [
              {
                homologacoes: [aprovada('Acme'), pendente('Beta')],
                correcoesBloqueadoras: [],
              },
            ],
          },
        ],
      }),
    )
    expect(r.pode).toBe(true)
    expect(r.itens[0]).toMatchObject({ situacao: 'QA_APROVADO', exigeVerificacaoHumana: false })
    expect(r.avisos).toEqual([
      '#2: homologação de Beta ainda pendente (não bloqueia a autorização).',
    ])

    const bloq = avaliarAutorizacaoProd(
      autorizacao({
        issues: [
          {
            issueId: 'i2',
            numero: 2,
            homologacoes: [],
            correcoesBloqueadoras: [],
            corrigeIssues: [
              { homologacoes: [aprovada('Acme')], correcoesBloqueadoras: [{ cliente: 'Beta' }] },
            ],
          },
        ],
      }),
    )
    expect(bloq.bloqueios).toEqual(['#2: Correção bloqueadora aberta (Beta).'])
  })
})

describe('deployEhDivergente', () => {
  const ambienteCriadoEm = new Date('2026-10-01T00:00:00Z')
  const evidencia = {
    situacao: 'SUCESSO' as const,
    ocorridaEm: new Date('2026-10-10T12:00:00Z'),
    registradaEm: new Date('2026-10-10T12:05:00Z'),
  }

  test('ocorrida antes da criação do ambiente → false; sem autorização → true; autorização criada antes do registro → false; revogada antes do registro → true; FALHA → false', () => {
    expect(
      deployEhDivergente({
        ambienteCriadoEm,
        evidencia: { ...evidencia, ocorridaEm: new Date('2026-09-30T00:00:00Z') },
        autorizacoes: [],
      }),
    ).toBe(false)
    expect(deployEhDivergente({ ambienteCriadoEm, evidencia, autorizacoes: [] })).toBe(true)
    expect(
      deployEhDivergente({
        ambienteCriadoEm,
        evidencia,
        autorizacoes: [{ criadaEm: new Date('2026-10-10T11:00:00Z'), revogadaEm: null }],
      }),
    ).toBe(false)
    expect(
      deployEhDivergente({
        ambienteCriadoEm,
        evidencia,
        autorizacoes: [
          {
            criadaEm: new Date('2026-10-10T11:00:00Z'),
            revogadaEm: new Date('2026-10-10T12:00:00Z'),
          },
        ],
      }),
    ).toBe(true)
    expect(
      deployEhDivergente({
        ambienteCriadoEm,
        evidencia,
        autorizacoes: [{ criadaEm: new Date('2026-10-10T13:00:00Z'), revogadaEm: null }],
      }),
    ).toBe(true)
    expect(
      deployEhDivergente({
        ambienteCriadoEm,
        evidencia: { ...evidencia, situacao: 'FALHA' },
        autorizacoes: [],
      }),
    ).toBe(false)
  })
})

describe('estadosDePublicacao', () => {
  const base: EntradaDosEstados = {
    qa: { estados: ['APROVADA'], correcoesBloqueadoras: 0 },
    autorizacao: null,
    deploy: { tipo: 'evidencia', situacao: 'SUCESSO', origem: 'GITHUB_DEPLOYMENT' },
    divergente: true,
    verificacao: null,
  }

  test('A09: QA aprovado, sem autorização, deploy SUCESSO divergente e sem verificação → aprovada, nao-autorizada, divergente, nao-verificada; nenhum estado sem dado tem tom sucesso', () => {
    const e = estadosDePublicacao(base)
    expect(e.qa).toEqual({ codigo: 'aprovada', texto: 'QA aprovado', tom: 'sucesso' })
    expect(e.autorizacao).toEqual({
      codigo: 'nao-autorizada',
      texto: 'Não autorizada para PROD',
      tom: 'neutro',
    })
    expect(e.deploy).toEqual({
      codigo: 'divergente',
      texto: 'Em PROD sem autorização registrada',
      tom: 'atencao',
    })
    expect(e.verificacao).toEqual({
      codigo: 'nao-verificada',
      texto: 'Não verificada em produção',
      tom: 'neutro',
    })

    const vazio = estadosDePublicacao({
      qa: { estados: [], correcoesBloqueadoras: 0 },
      autorizacao: null,
      deploy: null,
      divergente: false,
      verificacao: null,
    })
    expect(vazio.qa).toEqual({ codigo: 'sem-homologacao', texto: 'Sem homologação', tom: 'neutro' })
    expect(vazio.deploy).toEqual({
      codigo: 'sem-evidencia',
      texto: 'Sem evidência de deploy em PROD',
      tom: 'neutro',
    })
    for (const s of Object.values(vazio)) expect(s.tom).not.toBe('sucesso')
  })

  test('variantes de QA, autorização, deploy e verificação', () => {
    const qa = (estados: EntradaDosEstados['qa']['estados'], c = 0) =>
      estadosDePublicacao({ ...base, qa: { estados, correcoesBloqueadoras: c } }).qa
    expect(qa(['APROVADA'], 1)).toEqual({
      codigo: 'correcao',
      texto: 'Correção bloqueadora aberta',
      tom: 'erro',
    })
    expect(qa(['APROVADA', 'PENDENTE_DE_TESTE'])).toEqual({
      codigo: 'parcial',
      texto: 'QA aprovado em 1 de 2',
      tom: 'atencao',
    })
    expect(qa(['PENDENTE_DE_TESTE'])).toEqual({
      codigo: 'pendente',
      texto: 'QA pendente',
      tom: 'atencao',
    })

    const aut = (a: EntradaDosEstados['autorizacao']) =>
      estadosDePublicacao({ ...base, autorizacao: a }).autorizacao
    const t = new Date('2026-10-10T00:00:00Z')
    expect(aut({ criadaEm: t, revogadaEm: t })).toEqual({
      codigo: 'revogada',
      texto: 'Autorização revogada: a composição mudou',
      tom: 'atencao',
    })
    expect(aut({ criadaEm: t, revogadaEm: null })).toEqual({
      codigo: 'autorizada',
      texto: 'Autorizada para PROD',
      tom: 'sucesso',
    })

    const dep = (d: EntradaDosEstados['deploy'], divergente = false) =>
      estadosDePublicacao({ ...base, deploy: d, divergente }).deploy
    expect(dep({ tipo: 'evidencia', situacao: 'SUCESSO', origem: 'ENDPOINT' })).toEqual({
      codigo: 'implantada',
      texto: 'Em PROD',
      tom: 'sucesso',
    })
    expect(dep({ tipo: 'evidencia', situacao: 'SUCESSO', origem: 'MANUAL' })).toEqual({
      codigo: 'implantada',
      texto: 'Em PROD (confirmação manual)',
      tom: 'informacao',
    })
    expect(dep({ tipo: 'evidencia', situacao: 'EM_ANDAMENTO', origem: 'ENDPOINT' })).toEqual({
      codigo: 'em-andamento',
      texto: 'Deploy em andamento',
      tom: 'execucao',
    })
    expect(dep({ tipo: 'evidencia', situacao: 'FALHA', origem: 'ENDPOINT' })).toEqual({
      codigo: 'falhou',
      texto: 'Deploy em PROD falhou',
      tom: 'erro',
    })
    expect(dep({ tipo: 'presenca', estado: 'PRESENCA_CONFIRMADA' })).toMatchObject({
      codigo: 'implantada',
      tom: 'sucesso',
    })
    expect(dep({ tipo: 'presenca', estado: 'CONFIRMACAO_MANUAL' })).toMatchObject({
      codigo: 'implantada',
      tom: 'informacao',
    })
    expect(dep({ tipo: 'presenca', estado: 'VERIFICACAO_NECESSARIA' })).toEqual({
      codigo: 'verificacao-necessaria',
      texto: 'Presença em PROD incerta: verificação necessária',
      tom: 'atencao',
    })
    expect(dep({ tipo: 'presenca', estado: 'SEM_EVIDENCIA' })).toMatchObject({
      codigo: 'sem-evidencia',
      tom: 'neutro',
    })

    const ver = (v: EntradaDosEstados['verificacao']) =>
      estadosDePublicacao({ ...base, verificacao: v }).verificacao
    expect(ver({ origem: 'MANUAL' })).toEqual({
      codigo: 'verificada',
      texto: 'Verificada manualmente em produção',
      tom: 'sucesso',
    })
    expect(ver({ origem: 'ENDPOINT' })).toEqual({
      codigo: 'verificada',
      texto: 'Verificada em produção por evidência',
      tom: 'sucesso',
    })
  })
})

test('resumirEstadosDaMilestone conta parcial como QA aprovado e divergente como em PROD sem autorização', () => {
  const e = (qa: string, aut: string, dep: string, ver: string) =>
    ({
      qa: { codigo: qa, texto: '', tom: 'neutro' },
      autorizacao: { codigo: aut, texto: '', tom: 'neutro' },
      deploy: { codigo: dep, texto: '', tom: 'neutro' },
      verificacao: { codigo: ver, texto: '', tom: 'neutro' },
    }) as const
  expect(
    resumirEstadosDaMilestone([
      e('aprovada', 'autorizada', 'implantada', 'verificada'),
      e('parcial', 'nao-autorizada', 'divergente', 'nao-verificada'),
      e('pendente', 'revogada', 'sem-evidencia', 'nao-verificada'),
    ]),
  ).toEqual({
    total: 3,
    qaAprovado: 2,
    autorizadas: 1,
    emProd: 2,
    verificadas: 1,
    emProdSemAutorizacao: 1,
  })
})

test('descreverItemDesconhecido: um texto por tipo', () => {
  expect(descreverItemDesconhecido({ tipo: 'sem-base' })).toMatch(/base/i)
  expect(descreverItemDesconhecido({ tipo: 'commit-sem-pr', commit: X })).toContain('dddddd')
  expect(descreverItemDesconhecido({ tipo: 'pr-sem-issue', pr: 7, commit: M7 })).toContain('#7')
  expect(descreverItemDesconhecido({ tipo: 'issue-nao-espelhada', pr: 8, numero: 9 })).toContain(
    '#9',
  )
  expect(descreverItemDesconhecido({ tipo: 'comparacao-truncada' })).toMatch(/truncad/i)
  expect(descreverItemDesconhecido({ tipo: 'historico-divergente', status: 'behind' })).toMatch(
    /hist/i,
  )
})
