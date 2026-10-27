import { describe, expect, test } from 'vitest'
import { ErroDeDominio } from '@/lib/erros'
import {
  ambienteDoDeployment,
  apresentarImplantacao,
  assinaturaDaEntrada,
  deploymentsDevidos,
  estadoDeImplantacaoNoAmbiente,
  evidenciaVigente,
  formatoDeTokenValido,
  hashDoTokenDeEvidencia,
  presencaDeIssueNaVersao,
  prsMergeadosDaIssue,
  rotuloDaVersao,
  situacaoDoStatus,
  validarNomeNoGitHub,
  validarShaDeCommit,
  validarUrlDoAmbiente,
  type EntradaDePresenca,
  type EvidenciaParaEstado,
  type PrParaPresenca,
  type ResultadoDeComparacao,
} from './model'

const M = '1' + 'c'.repeat(39)
const V = '1' + 'e'.repeat(39)
const criadaEm = new Date('2026-10-20T10:00:00.000Z')

function pr(
  numero: number,
  comparacao: ResultadoDeComparacao,
  extra: Partial<PrParaPresenca> = {},
): PrParaPresenca {
  return {
    numero,
    shaMerge: M,
    mergeadoEm: new Date('2026-10-19T10:00:00.000Z'),
    comparacao,
    ...extra,
  }
}

function entrada(
  prs: readonly PrParaPresenca[],
  extra: Partial<EntradaDePresenca> = {},
): EntradaDePresenca {
  return {
    issue: { numero: 2, estado: 'ABERTA' },
    versao: { commitSha: V, criadaEm },
    prsMergeados: prs,
    confirmacaoManual: null,
    ...extra,
  }
}

describe('presencaDeIssueNaVersao', () => {
  test('PR #5 ahead → PRESENCA_CONFIRMADA "Contém o merge do PR #5."; identical → idem; behind → SEM_EVIDENCIA "Não contém o merge do PR #5."; diverged → idem', () => {
    for (const c of ['ahead', 'identical'] as const) {
      expect(presencaDeIssueNaVersao(entrada([pr(5, c)]))).toEqual({
        estado: 'PRESENCA_CONFIRMADA',
        motivo: 'Contém o merge do PR #5.',
      })
    }
    for (const c of ['behind', 'diverged'] as const) {
      expect(presencaDeIssueNaVersao(entrada([pr(5, c)]))).toEqual({
        estado: 'SEM_EVIDENCIA',
        motivo: 'Não contém o merge do PR #5.',
      })
    }
    expect(presencaDeIssueNaVersao(entrada([pr(5, 'ahead'), pr(7, 'ahead')])).motivo).toBe(
      'Contém o merge dos PRs #5, #7.',
    )
    expect(presencaDeIssueNaVersao(entrada([pr(5, 'behind'), pr(7, 'behind')])).motivo).toBe(
      'Não contém o merge dos PRs #5, #7.',
    )
  })

  test('issue FECHADA sem PRs → VERIFICACAO_NECESSARIA "Issue fechada sem PR mergeado que a referencie; confira manualmente."; ABERTA sem PRs → SEM_EVIDENCIA "Nenhum PR mergeado referencia esta issue."', () => {
    expect(
      presencaDeIssueNaVersao(entrada([], { issue: { numero: 4, estado: 'FECHADA' } })),
    ).toEqual({
      estado: 'VERIFICACAO_NECESSARIA',
      motivo: 'Issue fechada sem PR mergeado que a referencie; confira manualmente.',
    })
    expect(presencaDeIssueNaVersao(entrada([]))).toEqual({
      estado: 'SEM_EVIDENCIA',
      motivo: 'Nenhum PR mergeado referencia esta issue.',
    })
  })

  test('PR com shaMerge null ou comparacao indisponivel → VERIFICACAO_NECESSARIA "Não foi possível comparar o PR #5 com a versão."; #5 ahead e #7 behind → VERIFICACAO_NECESSARIA "Contém o merge de #5, mas não de #7; confira manualmente."', () => {
    const indisponivel = {
      estado: 'VERIFICACAO_NECESSARIA',
      motivo: 'Não foi possível comparar o PR #5 com a versão.',
    }
    expect(presencaDeIssueNaVersao(entrada([pr(5, 'ahead', { shaMerge: null })]))).toEqual(
      indisponivel,
    )
    expect(presencaDeIssueNaVersao(entrada([pr(5, 'indisponivel')]))).toEqual(indisponivel)
    expect(
      presencaDeIssueNaVersao(entrada([pr(7, 'indisponivel'), pr(5, 'indisponivel')])),
    ).toEqual(indisponivel)
    expect(presencaDeIssueNaVersao(entrada([pr(5, 'ahead'), pr(7, 'behind')]))).toEqual({
      estado: 'VERIFICACAO_NECESSARIA',
      motivo: 'Contém o merge de #5, mas não de #7; confira manualmente.',
    })
  })

  test('merge fora de ordem: mergeadoEm depois de versao.criadaEm com ahead → PRESENCA_CONFIRMADA; mergeadoEm antes com behind → SEM_EVIDENCIA (datas ignoradas)', () => {
    const depois = pr(5, 'ahead', { mergeadoEm: new Date('2026-10-25T10:00:00.000Z') })
    const antes = pr(5, 'behind', { mergeadoEm: new Date('2026-10-01T10:00:00.000Z') })
    expect(presencaDeIssueNaVersao(entrada([depois])).estado).toBe('PRESENCA_CONFIRMADA')
    expect(presencaDeIssueNaVersao(entrada([antes])).estado).toBe('SEM_EVIDENCIA')
  })

  test('confirmacaoManual prevalece sobre behind → CONFIRMACAO_MANUAL "Presença confirmada manualmente."', () => {
    const manual = { porId: 'u1', em: new Date('2026-10-21T10:00:00.000Z') }
    expect(
      presencaDeIssueNaVersao(entrada([pr(5, 'behind')], { confirmacaoManual: manual })),
    ).toEqual({
      estado: 'CONFIRMACAO_MANUAL',
      motivo: 'Presença confirmada manualmente.',
    })
  })
})

describe('prsMergeadosDaIssue', () => {
  test('prsMergeadosDaIssue(2, ...): PR sem referência ("Trabalho em andamento.") e PR ABERTO com "Closes #2" ficam fora; devolve só MERGEADO com 2, ordenado', () => {
    const prs = [
      { numero: 9, estado: 'MERGEADO' as const, issuesReferenciadas: [2, 3] },
      { numero: 6, estado: 'MERGEADO' as const, issuesReferenciadas: [] as number[] },
      { numero: 8, estado: 'ABERTO' as const, issuesReferenciadas: [2] },
      { numero: 5, estado: 'MERGEADO' as const, issuesReferenciadas: [2] },
      { numero: 7, estado: 'FECHADO' as const, issuesReferenciadas: [2] },
    ]
    expect(prsMergeadosDaIssue(2, prs).map((p) => p.numero)).toEqual([5, 9])
  })
})

describe('assinaturaDaEntrada', () => {
  test('assinaturaDaEntrada: [{7,null},{5,M}] → "5:"+M+",7:-"; [] → ""', () => {
    expect(
      assinaturaDaEntrada([
        { numero: 7, shaMerge: null },
        { numero: 5, shaMerge: M },
      ]),
    ).toBe(`5:${M},7:-`)
    expect(assinaturaDaEntrada([])).toBe('')
  })
})

function ev(
  versaoId: string,
  origem: EvidenciaParaEstado['origem'],
  situacao: EvidenciaParaEstado['situacao'],
  ocorridaEm: string,
  registradaEm: string,
  rotulo = versaoId,
): EvidenciaParaEstado {
  return {
    versaoId,
    rotulo,
    origem,
    situacao,
    ocorridaEm: new Date(ocorridaEm),
    registradaEm: new Date(registradaEm),
  }
}

describe('evidenciaVigente', () => {
  test('evidenciaVigente: FALHA e EM_ANDAMENTO posteriores não substituem; SUCESSO com ocorridaEm menor e registradaEm maior não substitui; empate de ocorridaEm decide por registradaEm; lista sem SUCESSO → null', () => {
    const base = ev(
      'v1',
      'GITHUB_DEPLOYMENT',
      'SUCESSO',
      '2026-10-20T10:00:00Z',
      '2026-10-20T10:01:00Z',
    )
    const falha = ev(
      'v2',
      'GITHUB_DEPLOYMENT',
      'FALHA',
      '2026-10-21T10:00:00Z',
      '2026-10-21T10:01:00Z',
    )
    const andamento = ev(
      'v3',
      'GITHUB_DEPLOYMENT',
      'EM_ANDAMENTO',
      '2026-10-22T10:00:00Z',
      '2026-10-22T10:01:00Z',
    )
    expect(evidenciaVigente([base, falha, andamento])?.versaoId).toBe('v1')

    const antigaRegistradaDepois = ev(
      'v0',
      'GITHUB_DEPLOYMENT',
      'SUCESSO',
      '2026-10-10T10:00:00Z',
      '2026-10-30T10:00:00Z',
    )
    expect(evidenciaVigente([base, antigaRegistradaDepois])?.versaoId).toBe('v1')

    const empate = ev(
      'v4',
      'GITHUB_DEPLOYMENT',
      'SUCESSO',
      '2026-10-20T10:00:00Z',
      '2026-10-20T10:05:00Z',
    )
    expect(evidenciaVigente([base, empate])?.versaoId).toBe('v4')
    expect(evidenciaVigente([empate, base])?.versaoId).toBe('v4')

    expect(evidenciaVigente([falha, andamento])).toBeNull()
    expect(evidenciaVigente([])).toBeNull()
  })

  test('precedência: vigente com MANUAL e ENDPOINT da mesma versão → origem ENDPOINT; só MANUAL → MANUAL', () => {
    const manual = ev('v1', 'MANUAL', 'SUCESSO', '2026-10-20T10:00:00Z', '2026-10-20T10:02:00Z')
    const endpoint = ev('v1', 'ENDPOINT', 'SUCESSO', '2026-10-20T10:00:00Z', '2026-10-20T10:01:00Z')
    expect(evidenciaVigente([manual, endpoint])?.origem).toBe('ENDPOINT')
    expect(evidenciaVigente([manual])?.origem).toBe('MANUAL')
  })
})

describe('estadoDeImplantacaoNoAmbiente', () => {
  const v1 = ev(
    'v1',
    'GITHUB_DEPLOYMENT',
    'SUCESSO',
    '2026-10-20T10:00:00Z',
    '2026-10-20T10:01:00Z',
    'v1.4.0',
  )

  test('estadoDeImplantacaoNoAmbiente: não configurado → configurado false; sem vigente → SEM_EVIDENCIA "A evidência de deploy ainda não foi recebida."; presença ausente → "Presença ainda não calculada para a versão v1.4.0."; PRESENCA_CONFIRMADA + origem MANUAL → CONFIRMACAO_MANUAL "Deploy registrado manualmente. Contém o merge do PR #5."', () => {
    expect(
      estadoDeImplantacaoNoAmbiente({ configurado: false, evidencias: [], presencas: new Map() }),
    ).toMatchObject({
      configurado: false,
      estado: 'SEM_EVIDENCIA',
      motivo: 'Ambiente não configurado.',
      versao: null,
      origem: null,
      ocorridaEm: null,
    })

    expect(
      estadoDeImplantacaoNoAmbiente({ configurado: true, evidencias: [], presencas: new Map() }),
    ).toMatchObject({
      configurado: true,
      estado: 'SEM_EVIDENCIA',
      motivo: 'A evidência de deploy ainda não foi recebida.',
      versao: null,
    })

    expect(
      estadoDeImplantacaoNoAmbiente({ configurado: true, evidencias: [v1], presencas: new Map() }),
    ).toMatchObject({
      estado: 'SEM_EVIDENCIA',
      motivo: 'Presença ainda não calculada para a versão v1.4.0.',
      versao: { id: 'v1', rotulo: 'v1.4.0' },
      origem: 'GITHUB_DEPLOYMENT',
    })

    const presencas = new Map([
      ['v1', { estado: 'PRESENCA_CONFIRMADA' as const, motivo: 'Contém o merge do PR #5.' }],
    ])
    expect(
      estadoDeImplantacaoNoAmbiente({ configurado: true, evidencias: [v1], presencas }),
    ).toMatchObject({ estado: 'PRESENCA_CONFIRMADA', motivo: 'Contém o merge do PR #5.' })

    const manual = { ...v1, origem: 'MANUAL' as const }
    expect(
      estadoDeImplantacaoNoAmbiente({ configurado: true, evidencias: [manual], presencas }),
    ).toMatchObject({
      estado: 'CONFIRMACAO_MANUAL',
      motivo: 'Deploy registrado manualmente. Contém o merge do PR #5.',
      origem: 'MANUAL',
    })
  })
})

describe('apresentarImplantacao', () => {
  test('apresentarImplantacao: textos exatos; nenhum dos cinco casos tem tom sucesso', () => {
    const casos = [
      [{ configurado: false, estado: 'SEM_EVIDENCIA' }, 'Não configurado', 'neutro'],
      [{ configurado: true, estado: 'SEM_EVIDENCIA' }, 'Sem evidência', 'neutro'],
      [{ configurado: true, estado: 'PRESENCA_CONFIRMADA' }, 'Presença confirmada', 'informacao'],
      [{ configurado: true, estado: 'CONFIRMACAO_MANUAL' }, 'Confirmação manual', 'informacao'],
      [
        { configurado: true, estado: 'VERIFICACAO_NECESSARIA' },
        'Verificação necessária',
        'atencao',
      ],
    ] as const
    for (const [entrada, texto, tom] of casos) {
      const r = apresentarImplantacao(entrada)
      expect(r).toEqual({ texto, tom })
      expect(r.tom).not.toBe('sucesso')
    }
  })
})

describe('mapeamentos de deployment', () => {
  test('situacaoDoStatus: success → SUCESSO; failure e error → FALHA; pending, queued, in_progress e null → EM_ANDAMENTO; inactive → null', () => {
    expect(situacaoDoStatus('success')).toBe('SUCESSO')
    expect(situacaoDoStatus('failure')).toBe('FALHA')
    expect(situacaoDoStatus('error')).toBe('FALHA')
    for (const s of ['pending', 'queued', 'in_progress', null]) {
      expect(situacaoDoStatus(s)).toBe('EM_ANDAMENTO')
    }
    expect(situacaoDoStatus('inactive')).toBeNull()
  })

  test('ambienteDoDeployment: " QA " casa com "qa"; nomeNoGitHub null nunca casa; "staging" sem correspondência → null', () => {
    const qa = { nomeNoGitHub: ' QA ' }
    const semNome = { nomeNoGitHub: null }
    const prod = { nomeNoGitHub: 'producao' }
    expect(ambienteDoDeployment('qa', [semNome, qa, prod])).toBe(qa)
    expect(ambienteDoDeployment('QA', [qa])).toBe(qa)
    expect(ambienteDoDeployment('', [semNome])).toBeNull()
    expect(ambienteDoDeployment('staging', [semNome, qa, prod])).toBeNull()
  })

  test('rotuloDaVersao: informado " 3.8.0 " → "3.8.0"; ref "v1.4.0" → "v1.4.0"; ref "main" → "1eeeeee"; ref igual ao SHA → "1eeeeee"', () => {
    expect(rotuloDaVersao({ informado: ' 3.8.0 ', ref: null, commitSha: V })).toBe('3.8.0')
    expect(rotuloDaVersao({ informado: null, ref: 'v1.4.0', commitSha: V })).toBe('v1.4.0')
    expect(rotuloDaVersao({ informado: null, ref: 'main', commitSha: V })).toBe('1eeeeee')
    expect(rotuloDaVersao({ informado: null, ref: V, commitSha: V })).toBe('1eeeeee')
  })
})

describe('token e validações', () => {
  test('token: formatoDeTokenValido("fle_"+"a".repeat(43)) true e com 42 false; hashDoTokenDeEvidencia("fle_"+"a".repeat(43)) = "86b04281458a2bd363c52b7afd3b5d35aab96abb162a82bbf4418246e750dc4d"', () => {
    expect(formatoDeTokenValido('fle_' + 'a'.repeat(43))).toBe(true)
    expect(formatoDeTokenValido('fle_' + 'a'.repeat(42))).toBe(false)
    expect(hashDoTokenDeEvidencia('fle_' + 'a'.repeat(43))).toBe(
      '86b04281458a2bd363c52b7afd3b5d35aab96abb162a82bbf4418246e750dc4d',
    )
  })

  test('validarNomeNoGitHub, validarUrlDoAmbiente, validarShaDeCommit: mensagens exatas; SHA em maiúsculas é normalizado', () => {
    expect(validarNomeNoGitHub('  qa ')).toBe('qa')
    expect(validarNomeNoGitHub('   ')).toBeNull()
    expect(() => validarNomeNoGitHub('x'.repeat(101))).toThrow(
      new ErroDeDominio('O nome no GitHub não pode ter mais de 100 caracteres.'),
    )

    expect(validarUrlDoAmbiente('')).toBeNull()
    expect(validarUrlDoAmbiente(' https://qa.exemplo.com ')).toBe('https://qa.exemplo.com')
    expect(() => validarUrlDoAmbiente('qa.exemplo.com')).toThrow(
      new ErroDeDominio('Informe uma URL que comece com http:// ou https://.'),
    )

    expect(validarShaDeCommit(` ${V.toUpperCase()} `)).toBe(V)
    expect(() => validarShaDeCommit('abc123')).toThrow(
      new ErroDeDominio('Informe o SHA completo do commit (40 caracteres hexadecimais).'),
    )
  })
})

describe('deploymentsDevidos', () => {
  const agora = new Date('2026-10-27T12:00:00.000Z')
  const minutosAtras = (m: number) => new Date(agora.getTime() - m * 60_000)
  const nenhum = {
    deploymentsSincronizadosEm: null,
    deploymentsFalhaEm: null,
    sincronizacaoSolicitadaEm: null,
  }

  test('deploymentsDevidos: nunca lido → true; lido há 5 min com intervalo 600_000 → false; solicitação nova → true; falha há 5 min → false; há 11 min → true', () => {
    expect(deploymentsDevidos(nenhum, agora, 600_000)).toBe(true)
    const lido = { ...nenhum, deploymentsSincronizadosEm: minutosAtras(5) }
    expect(deploymentsDevidos(lido, agora, 600_000)).toBe(false)
    expect(
      deploymentsDevidos({ ...lido, deploymentsSincronizadosEm: minutosAtras(11) }, agora, 600_000),
    ).toBe(true)
    expect(
      deploymentsDevidos({ ...lido, sincronizacaoSolicitadaEm: minutosAtras(1) }, agora, 600_000),
    ).toBe(true)
    expect(
      deploymentsDevidos({ ...lido, sincronizacaoSolicitadaEm: minutosAtras(9) }, agora, 600_000),
    ).toBe(false)

    const falhou = (m: number) => ({
      ...nenhum,
      deploymentsSincronizadosEm: minutosAtras(30),
      deploymentsFalhaEm: minutosAtras(m),
    })
    expect(deploymentsDevidos(falhou(5), agora, 600_000)).toBe(false)
    expect(deploymentsDevidos(falhou(11), agora, 600_000)).toBe(true)
    // solicitação posterior à última leitura e à última falha vence o intervalo
    expect(
      deploymentsDevidos(
        { ...falhou(5), sincronizacaoSolicitadaEm: minutosAtras(1) },
        agora,
        600_000,
      ),
    ).toBe(true)
  })
})
