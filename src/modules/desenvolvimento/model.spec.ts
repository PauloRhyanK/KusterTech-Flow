import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  apresentarEstadoDaExecucao,
  apresentarStatusDeSeed,
  AUTOR_WARREN,
  derivarExecucoes,
  ehPrDoWarren,
  estadoDaExecucao,
  JANELA_SEM_SINAL_MS,
  leituraWarrenDevida,
  lerCorpoDePrWarren,
  lerPlanosDeSeeds,
  lerSeeds,
  PADRAO_RUN_ID,
  prioridadeNaFila,
  runIdDoBranch,
  situacaoNaFila,
  type EntradaDoEstado,
  type ItemParaSituacao,
  type PrParaExecucao,
  type SeedLida,
} from './model'

const agora = new Date('2026-10-21T10:00:00.000Z')

const LINHA_FB3A = JSON.stringify({
  id: 'FLOW-fb3a',
  title: 'Domínio GitHub — schema, migration e regras puras de estado, checks e agenda (Task 1)',
  status: 'closed',
  type: 'task',
  priority: 0,
  plan_id: 'pl-537b',
  description: 'BRIEFING interno que não pode ser guardado',
  closeReason: 'Mergeada',
  assignee: 'alguem',
  blockedBy: [],
  updatedAt: '2026-10-27T00:00:00.000Z',
  extensions: {
    role: 'architect-orchestrator',
    trigger: 'plan-run',
    lastRunId: 'run_97km49v16089',
    lastRunAt: '2026-10-26T21:48:06.918Z',
  },
})
const LINHA_AA1D = JSON.stringify({
  id: 'FLOW-aa1d',
  title: 'Incremento 4 — Ambientes, versões e evidência',
  status: 'open',
  type: 'epic',
  blockedBy: ['FLOW-2f85'],
})
const LINHA_X002 = JSON.stringify({
  id: 'FLOW-x002',
  title: 'Seed com run malformado',
  status: 'in_progress',
  type: 'task',
  extensions: { lastRunId: '../segredo', lastRunAt: '2026-10-26T21:48:06.918Z' },
})
const LINHA_TRUNCADA = '{"id":"FLOW-t001","title":"truncada","status":"op'
const LINHA_DOING = JSON.stringify({ id: 'FLOW-d001', title: 'status novo', status: 'doing' })

const CORPO_PR_44 = [
  '## Resumo',
  '',
  'Warren run complete.',
  '',
  '**Warren run:** `run_72t2177t8475`',
  '- **Agent:** architect-orchestrator',
  '- **Cost:** $0.538 (12 mil tokens)',
  '',
  '## Seeds',
  '',
  '- FLOW-d055 — Verificação final do Incremento 2',
  '',
  '## Prompt',
  '',
  '**Warren run:** `run_falso0000001`',
  'prompt interno inteiro',
].join('\n')
const CORPO_PR_43 = [
  '**Warren run:** `run_g3gyrhgy88be`',
  '- **Agent:** architect-orchestrator',
  '',
  '**Cost:** $1.36',
  '',
  '## Seeds',
  '- FLOW-c9e8 — Reconciliação',
].join('\n')

describe('lerSeeds', () => {
  test('6 linhas (FLOW-fb3a real com extensions, epic com blockedBy, vazia, truncada, status "doing", lastRunId "../segredo") → 3 seeds e linhasInvalidas 2; fb3a.execucao = { runId: "run_97km49v16089", registradaEm: 2026-10-26T21:48:06.918Z, papel: "architect-orchestrator" }; aa1d.bloqueadaPor ["FLOW-2f85"]; x002.execucao null', () => {
    const jsonl = [LINHA_FB3A, LINHA_AA1D, '', LINHA_TRUNCADA, LINHA_DOING, LINHA_X002].join('\n')
    const { seeds, linhasInvalidas } = lerSeeds(jsonl)
    expect(seeds).toHaveLength(3)
    expect(linhasInvalidas).toBe(2)
    const porId = new Map(seeds.map((s) => [s.seedId, s]))
    expect(porId.get('FLOW-fb3a')?.execucao).toEqual({
      runId: 'run_97km49v16089',
      registradaEm: new Date('2026-10-26T21:48:06.918Z'),
      papel: 'architect-orchestrator',
    })
    expect(porId.get('FLOW-fb3a')?.status).toBe('FECHADA')
    expect(porId.get('FLOW-fb3a')?.planoId).toBe('pl-537b')
    expect(porId.get('FLOW-aa1d')?.bloqueadaPor).toEqual(['FLOW-2f85'])
    expect(porId.get('FLOW-aa1d')?.tipo).toBe('epic')
    expect(porId.get('FLOW-x002')?.execucao).toBeNull()
    expect(porId.get('FLOW-x002')?.status).toBe('EM_ANDAMENTO')
  })

  test('lerSeeds não devolve description, closeReason nem assignee: Object.keys da seed = as 8 chaves de SeedLida', () => {
    const { seeds } = lerSeeds(LINHA_FB3A)
    expect(Object.keys(seeds[0]!).sort()).toEqual(
      [
        'atualizadaEm',
        'bloqueadaPor',
        'execucao',
        'planoId',
        'seedId',
        'status',
        'tipo',
        'titulo',
      ].sort(),
    )
    expect(JSON.stringify(seeds)).not.toContain('BRIEFING')
  })

  test('lerSeeds: tipo desconhecido → outro, título cortado em 200, lastRunAt inválido → registradaEm null, id repetido vale a última linha', () => {
    const longa = JSON.stringify({
      id: 'FLOW-l001',
      title: 'x'.repeat(300),
      status: 'open',
      type: 'chore',
      extensions: { lastRunId: 'run_abc123', lastRunAt: 'ontem', role: 'r'.repeat(80) },
    })
    const repetida1 = JSON.stringify({ id: 'FLOW-r001', title: 'antiga', status: 'open' })
    const repetida2 = JSON.stringify({ id: 'FLOW-r001', title: 'nova', status: 'closed' })
    const { seeds, linhasInvalidas } = lerSeeds([longa, repetida1, repetida2].join('\n'))
    expect(linhasInvalidas).toBe(0)
    expect(seeds).toHaveLength(2)
    const l = seeds.find((s) => s.seedId === 'FLOW-l001')!
    expect(l.titulo).toHaveLength(200)
    expect(l.tipo).toBe('outro')
    expect(l.execucao?.registradaEm).toBeNull()
    expect(l.execucao?.papel).toHaveLength(60)
    const r = seeds.find((s) => s.seedId === 'FLOW-r001')!
    expect(r.titulo).toBe('nova')
    expect(r.status).toBe('FECHADA')
  })

  test('lerSeeds e lerPlanosDeSeeds leem os .seeds reais deste repositório (fs) com linhasInvalidas 0; seeds.length = linhas não vazias; pl-537b tem nome "Incremento 2 — Integração GitHub" e 6 filhos', () => {
    const issues = readFileSync(join(process.cwd(), '.seeds/issues.jsonl'), 'utf8')
    const plans = readFileSync(join(process.cwd(), '.seeds/plans.jsonl'), 'utf8')
    const naoVazias = (t: string) => t.split('\n').filter((l) => l.trim() !== '').length
    const lidas = lerSeeds(issues)
    expect(lidas.linhasInvalidas).toBe(0)
    expect(lidas.seeds).toHaveLength(naoVazias(issues))
    const planos = lerPlanosDeSeeds(plans)
    expect(planos.linhasInvalidas).toBe(0)
    expect(planos.planos).toHaveLength(naoVazias(plans))
    const pl = planos.planos.find((p) => p.planoId === 'pl-537b')
    expect(pl?.nome).toBe('Incremento 2 — Integração GitHub')
    expect(pl?.filhos).toHaveLength(6)
  })

  test('lerPlanosDeSeeds: linha truncada e plano sem nome são inválidos; nome cortado em 200', () => {
    const ok = JSON.stringify({
      id: 'pl-aaaa',
      name: 'n'.repeat(250),
      status: 'done',
      children: ['FLOW-a001'],
    })
    const semNome = JSON.stringify({ id: 'pl-bbbb', status: 'done', children: [] })
    const { planos, linhasInvalidas } = lerPlanosDeSeeds([ok, semNome, '{"id":'].join('\n'))
    expect(planos).toHaveLength(1)
    expect(planos[0]!.nome).toHaveLength(200)
    expect(linhasInvalidas).toBe(2)
  })
})

describe('lerCorpoDePrWarren', () => {
  test('no corpo da PR #44 (até ## Prompt) → { runId: "run_72t2177t8475", agente: "architect-orchestrator", custoUsd: "0.538", seeds: ["FLOW-d055"] }; PR #43 → custoUsd "1.36", seeds ["FLOW-c9e8"]', () => {
    expect(lerCorpoDePrWarren(CORPO_PR_44)).toEqual({
      runId: 'run_72t2177t8475',
      agente: 'architect-orchestrator',
      custoUsd: '0.538',
      seeds: ['FLOW-d055'],
    })
    const pr43 = lerCorpoDePrWarren(CORPO_PR_43)
    expect(pr43.custoUsd).toBe('1.36')
    expect(pr43.seeds).toEqual(['FLOW-c9e8'])
  })

  test('"" → tudo nulo e seeds []; "**Cost:** $abc" → custoUsd null com runId mantido; **Warren run:** só depois de ## Prompt → runId null', () => {
    expect(lerCorpoDePrWarren('')).toEqual({ runId: null, agente: null, custoUsd: null, seeds: [] })
    const ruim = lerCorpoDePrWarren('**Warren run:** `run_abc123`\n**Cost:** $abc')
    expect(ruim.custoUsd).toBeNull()
    expect(ruim.runId).toBe('run_abc123')
    expect(lerCorpoDePrWarren('texto\n## Prompt\n**Warren run:** `run_abc123`').runId).toBeNull()
  })

  test('limita a 20 seeds e ignora itens fora do padrão de id', () => {
    const itens = Array.from({ length: 30 }, (_, i) => `- FLOW-a${String(i).padStart(3, '0')} — t`)
    const corpo = ['## Seeds', '- sem id — x', ...itens].join('\n')
    expect(lerCorpoDePrWarren(corpo).seeds).toHaveLength(20)
  })
})

describe('runIdDoBranch e ehPrDoWarren', () => {
  test('runIdDoBranch: "warren/run_72t2177t8475" → "run_72t2177t8475"; "warren/run_", "warren/run_ABC123", "x/warren/run_abc123" → null', () => {
    expect(runIdDoBranch('warren/run_72t2177t8475')).toBe('run_72t2177t8475')
    expect(runIdDoBranch('warren/run_')).toBeNull()
    expect(runIdDoBranch('warren/run_ABC123')).toBeNull()
    expect(runIdDoBranch('x/warren/run_abc123')).toBeNull()
    expect(PADRAO_RUN_ID.test('run_abc123')).toBe(true)
    expect(AUTOR_WARREN.test('warren-forge[bot]')).toBe(true)
  })

  test('ehPrDoWarren: "warren-forge-kckt9y[bot]" e "warren-forge[bot]" em warren/run_abc123 → true; "exemplo-bia", null, "evil-warren-forge[bot]" ou branch main → false', () => {
    expect(ehPrDoWarren('warren-forge-kckt9y[bot]', 'warren/run_abc123')).toBe(true)
    expect(ehPrDoWarren('warren-forge[bot]', 'warren/run_abc123')).toBe(true)
    expect(ehPrDoWarren('exemplo-bia', 'warren/run_abc123')).toBe(false)
    expect(ehPrDoWarren(null, 'warren/run_abc123')).toBe(false)
    expect(ehPrDoWarren('evil-warren-forge[bot]', 'warren/run_abc123')).toBe(false)
    expect(ehPrDoWarren('warren-forge[bot]', 'main')).toBe(false)
  })
})

describe('estadoDaExecucao', () => {
  const base: EntradaDoEstado = {
    mencionadaNasFontes: true,
    temPullRequest: false,
    seed: null,
    registradaEm: null,
  }
  const umaHoraAtras = new Date(agora.getTime() - 3_600_000)

  test('os sete casos da decisão 5 com os motivos exatos; lastRunAt há 1 h → EXECUTANDO, há 24 h + 1 s → SEM_DADOS', () => {
    expect(estadoDaExecucao({ ...base, mencionadaNasFontes: false }, agora)).toEqual({
      estado: 'SEM_DADOS',
      motivo: 'As fontes não mencionam mais esta execução.',
    })
    expect(
      estadoDaExecucao(
        { ...base, temPullRequest: true, seed: { status: 'EM_ANDAMENTO', ultimaExecucao: true } },
        agora,
      ),
    ).toEqual({
      estado: 'CONCLUIDA',
      motivo:
        'O Warren abriu a PR desta execução. Isso não indica PR aprovada, CI verde nem issue fechada.',
    })
    expect(estadoDaExecucao(base, agora)).toEqual({
      estado: 'SEM_DADOS',
      motivo: 'As fontes lidas não informam o estado atual desta execução.',
    })
    expect(
      estadoDaExecucao({ ...base, seed: { status: 'EM_ANDAMENTO', ultimaExecucao: false } }, agora),
    ).toEqual({
      estado: 'SEM_DADOS',
      motivo: 'As fontes lidas não informam o estado atual desta execução.',
    })
    expect(
      estadoDaExecucao(
        {
          ...base,
          seed: { status: 'EM_ANDAMENTO', ultimaExecucao: true },
          registradaEm: umaHoraAtras,
        },
        agora,
      ),
    ).toEqual({
      estado: 'EXECUTANDO',
      motivo: 'A seed está em andamento no Seeds e ainda não há PR desta execução.',
    })
    const foraDaJanela = new Date(agora.getTime() - JANELA_SEM_SINAL_MS - 1000)
    const semSinal = {
      estado: 'SEM_DADOS',
      motivo: 'Sem sinal desta execução há mais de 24 h; o Warren não informa se ela terminou.',
    }
    expect(
      estadoDaExecucao(
        {
          ...base,
          seed: { status: 'EM_ANDAMENTO', ultimaExecucao: true },
          registradaEm: foraDaJanela,
        },
        agora,
      ),
    ).toEqual(semSinal)
    expect(
      estadoDaExecucao({ ...base, seed: { status: 'EM_ANDAMENTO', ultimaExecucao: true } }, agora),
    ).toEqual(semSinal)
    expect(
      estadoDaExecucao(
        { ...base, seed: { status: 'FECHADA', ultimaExecucao: true }, registradaEm: umaHoraAtras },
        agora,
      ),
    ).toEqual({
      estado: 'SEM_DADOS',
      motivo: 'A seed foi fechada, mas nenhuma PR desta execução foi encontrada.',
    })
    expect(
      estadoDaExecucao(
        { ...base, seed: { status: 'ABERTA', ultimaExecucao: true }, registradaEm: umaHoraAtras },
        agora,
      ),
    ).toEqual({
      estado: 'SEM_DADOS',
      motivo: 'A seed voltou a aberta e não há PR desta execução; o resultado não foi informado.',
    })
  })

  test('janela: exatamente 24 h ainda é EXECUTANDO; 5 min no futuro ainda é EXECUTANDO, 5 min + 1 s não', () => {
    const seed = { status: 'EM_ANDAMENTO' as const, ultimaExecucao: true }
    const em = (ms: number) => new Date(agora.getTime() + ms)
    expect(
      estadoDaExecucao({ ...base, seed, registradaEm: em(-JANELA_SEM_SINAL_MS) }, agora).estado,
    ).toBe('EXECUTANDO')
    expect(estadoDaExecucao({ ...base, seed, registradaEm: em(300_000) }, agora).estado).toBe(
      'EXECUTANDO',
    )
    expect(estadoDaExecucao({ ...base, seed, registradaEm: em(301_000) }, agora).estado).toBe(
      'SEM_DADOS',
    )
  })

  test('estadoDaExecucao nunca devolve NA_FILA, AGUARDANDO_CAPACIDADE, AGUARDANDO_DEPENDENCIA nem INTERVENCAO_NECESSARIA (todas as combinações de status, PR, menção e data)', () => {
    const proibidos = [
      'NA_FILA',
      'AGUARDANDO_CAPACIDADE',
      'AGUARDANDO_DEPENDENCIA',
      'INTERVENCAO_NECESSARIA',
    ]
    const status = [null, 'ABERTA', 'EM_ANDAMENTO', 'FECHADA'] as const
    const datas = [
      null,
      new Date(agora.getTime() - 3_600_000),
      new Date(agora.getTime() - 2 * JANELA_SEM_SINAL_MS),
      new Date(agora.getTime() + 3_600_000),
    ]
    let combinacoes = 0
    for (const s of status) {
      for (const ultima of [true, false]) {
        for (const pr of [true, false]) {
          for (const mencao of [true, false]) {
            for (const d of datas) {
              const r = estadoDaExecucao(
                {
                  mencionadaNasFontes: mencao,
                  temPullRequest: pr,
                  seed: s === null ? null : { status: s, ultimaExecucao: ultima },
                  registradaEm: d,
                },
                agora,
              )
              combinacoes += 1
              expect(proibidos).not.toContain(r.estado)
            }
          }
        }
      }
    }
    expect(combinacoes).toBe(4 * 2 * 2 * 2 * 4)
  })
})

describe('derivarExecucoes', () => {
  function seed(sobrescrever: Partial<SeedLida> & { seedId: string }): SeedLida {
    return {
      titulo: 't',
      status: 'EM_ANDAMENTO',
      tipo: 'task',
      planoId: null,
      bloqueadaPor: [],
      atualizadaEm: null,
      execucao: null,
      ...sobrescrever,
    }
  }
  function pr(sobrescrever: Partial<PrParaExecucao> & { id: string }): PrParaExecucao {
    return {
      autor: 'warren-forge-kckt9y[bot]',
      branch: 'warren/run_a00000',
      corpo: null,
      atualizadoEm: new Date('2026-10-21T09:00:00.000Z'),
      ...sobrescrever,
    }
  }
  const corpoDoRun = (runId: string, seedId: string) =>
    `**Warren run:** \`${runId}\`\n- **Agent:** gemini-3\n**Cost:** $0.538\n## Seeds\n- ${seedId} — x\n`

  test('seed in_progress run_a + PR do bot em warren/run_a → 1 execução CONCLUIDA, fonte seeds-e-pull-request, agente e custo do corpo; PR do bot sem seed → seedId do corpo, fonte pull-request; PR humana em warren/run_c e PR do bot em feature/x → ignoradas; corpo com runId diferente do branch → agente e custo null', () => {
    const seeds = [
      seed({
        seedId: 'FLOW-a001',
        execucao: {
          runId: 'run_a00000',
          registradaEm: new Date('2026-10-21T08:00:00.000Z'),
          papel: 'architect-orchestrator',
        },
      }),
    ]
    const prs = [
      pr({ id: 'pr1', branch: 'warren/run_a00000', corpo: corpoDoRun('run_a00000', 'FLOW-a001') }),
      pr({ id: 'pr2', branch: 'warren/run_b00000', corpo: corpoDoRun('run_b00000', 'FLOW-b001') }),
      pr({ id: 'pr3', autor: 'exemplo-bia', branch: 'warren/run_c00000' }),
      pr({ id: 'pr4', branch: 'feature/x', corpo: corpoDoRun('run_d00000', 'FLOW-d001') }),
      pr({ id: 'pr5', branch: 'warren/run_e00000', corpo: corpoDoRun('run_outro0', 'FLOW-e001') }),
    ]
    const r = derivarExecucoes(seeds, prs, agora)
    expect(r.map((e) => e.runId)).toEqual(['run_a00000', 'run_b00000', 'run_e00000'])
    expect(r[0]).toMatchObject({
      seedId: 'FLOW-a001',
      papel: 'architect-orchestrator',
      agente: 'gemini-3',
      custoUsd: '0.538',
      iniciadaEm: new Date('2026-10-21T08:00:00.000Z'),
      pullRequestId: 'pr1',
      fonte: 'seeds-e-pull-request',
      estado: 'CONCLUIDA',
    })
    expect(r[1]).toMatchObject({
      seedId: 'FLOW-b001',
      papel: null,
      pullRequestId: 'pr2',
      fonte: 'pull-request',
      estado: 'CONCLUIDA',
      iniciadaEm: null,
    })
    expect(r[2]).toMatchObject({ agente: null, custoUsd: null, seedId: null })
  })

  test('seed sem PR → EXECUTANDO na janela, fonte seeds; dois PRs do mesmo run → o mais recente; saída ordenada por runId', () => {
    const seeds = [
      seed({
        seedId: 'FLOW-s001',
        execucao: {
          runId: 'run_zzz000',
          registradaEm: new Date(agora.getTime() - 60_000),
          papel: null,
        },
      }),
    ]
    const prs = [
      pr({
        id: 'velho',
        branch: 'warren/run_aaa000',
        atualizadoEm: new Date('2026-10-20T00:00:00Z'),
      }),
      pr({
        id: 'novo',
        branch: 'warren/run_aaa000',
        atualizadoEm: new Date('2026-10-21T00:00:00Z'),
      }),
    ]
    const r = derivarExecucoes(seeds, prs, agora)
    expect(r.map((e) => e.runId)).toEqual(['run_aaa000', 'run_zzz000'])
    expect(r[0]!.pullRequestId).toBe('novo')
    expect(r[1]).toMatchObject({ estado: 'EXECUTANDO', fonte: 'seeds', pullRequestId: null })
  })
})

describe('apresentação', () => {
  test('apresentarEstadoDaExecucao: textos do Blueprint §6; CONCLUIDA e SEM_DADOS nunca em tom sucesso', () => {
    expect(apresentarEstadoDaExecucao('NA_FILA')).toEqual({ texto: 'Na fila', tom: 'neutro' })
    expect(apresentarEstadoDaExecucao('AGUARDANDO_CAPACIDADE')).toEqual({
      texto: 'Aguardando capacidade',
      tom: 'atencao',
    })
    expect(apresentarEstadoDaExecucao('AGUARDANDO_DEPENDENCIA')).toEqual({
      texto: 'Aguardando dependência',
      tom: 'atencao',
    })
    expect(apresentarEstadoDaExecucao('EXECUTANDO')).toEqual({
      texto: 'Executando',
      tom: 'execucao',
    })
    expect(apresentarEstadoDaExecucao('INTERVENCAO_NECESSARIA')).toEqual({
      texto: 'Intervenção necessária',
      tom: 'erro',
    })
    expect(apresentarEstadoDaExecucao('CONCLUIDA')).toEqual({
      texto: 'Concluída',
      tom: 'informacao',
    })
    expect(apresentarEstadoDaExecucao('SEM_DADOS')).toEqual({ texto: 'Sem dados', tom: 'neutro' })
  })

  test('apresentarStatusDeSeed: Aberta informacao, Em andamento execucao, Fechada neutro', () => {
    expect(apresentarStatusDeSeed('ABERTA')).toEqual({ texto: 'Aberta', tom: 'informacao' })
    expect(apresentarStatusDeSeed('EM_ANDAMENTO')).toEqual({
      texto: 'Em andamento',
      tom: 'execucao',
    })
    expect(apresentarStatusDeSeed('FECHADA')).toEqual({ texto: 'Fechada', tom: 'neutro' })
  })
})

describe('leituraWarrenDevida', () => {
  const t = (min: number) => new Date(agora.getTime() - min * 60_000)
  const dezMin = 10 * 60_000
  test('nunca lido → true; GitHub sincronizado depois da leitura → true; lido há 5 min com intervalo 10 min → false; há 10 min → true', () => {
    expect(
      leituraWarrenDevida(
        { warrenLidoEm: null, warrenFalhaEm: null, sincronizadoEm: t(1) },
        agora,
        dezMin,
      ),
    ).toBe(true)
    expect(
      leituraWarrenDevida(
        { warrenLidoEm: t(5), warrenFalhaEm: null, sincronizadoEm: t(2) },
        agora,
        dezMin,
      ),
    ).toBe(true)
    expect(
      leituraWarrenDevida(
        { warrenLidoEm: t(5), warrenFalhaEm: null, sincronizadoEm: t(6) },
        agora,
        dezMin,
      ),
    ).toBe(false)
    expect(
      leituraWarrenDevida(
        { warrenLidoEm: t(10), warrenFalhaEm: null, sincronizadoEm: t(20) },
        agora,
        dezMin,
      ),
    ).toBe(true)
  })
})

describe('fila unificada', () => {
  const prAberto = (checks: 'SUCESSO' | 'FALHA' | 'PENDENTE' | 'SEM_CHECKS'): ItemParaSituacao => ({
    tipo: 'pull-request',
    estado: 'ABERTO',
    checks,
  })

  test('situacaoNaFila: PR aberto com FALHA → intervencao com "Checks com falha no GitHub."; execução CONCLUIDA → encerrado; SEM_DADOS → aberto', () => {
    expect(situacaoNaFila(prAberto('FALHA'))).toEqual({
      situacao: 'intervencao',
      motivo: 'Checks com falha no GitHub.',
    })
    expect(situacaoNaFila({ tipo: 'execucao', estado: 'CONCLUIDA' }).situacao).toBe('encerrado')
    expect(situacaoNaFila({ tipo: 'execucao', estado: 'SEM_DADOS' })).toEqual({
      situacao: 'aberto',
      motivo: null,
    })
    expect(situacaoNaFila({ tipo: 'execucao', estado: 'INTERVENCAO_NECESSARIA' }).situacao).toBe(
      'intervencao',
    )
    expect(situacaoNaFila(prAberto('PENDENTE')).situacao).toBe('aberto')
    expect(situacaoNaFila({ tipo: 'issue', estado: 'FECHADA' }).situacao).toBe('encerrado')
    expect(situacaoNaFila({ tipo: 'issue', estado: 'ABERTA' }).situacao).toBe('aberto')
    for (const estado of ['MERGEADO', 'FECHADO'] as const) {
      expect(situacaoNaFila({ tipo: 'pull-request', estado, checks: 'FALHA' }).situacao).toBe(
        'encerrado',
      )
    }
  })

  test('prioridadeNaFila ordena intervenção, executando, aguardando, sem dados, PR aberto, issue aberta, encerrados', () => {
    const ordem: ItemParaSituacao[] = [
      prAberto('FALHA'),
      { tipo: 'execucao', estado: 'EXECUTANDO' },
      { tipo: 'execucao', estado: 'AGUARDANDO_CAPACIDADE' },
      { tipo: 'execucao', estado: 'SEM_DADOS' },
      prAberto('SEM_CHECKS'),
      { tipo: 'issue', estado: 'ABERTA' },
      { tipo: 'issue', estado: 'FECHADA' },
    ]
    expect(ordem.map(prioridadeNaFila)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(prioridadeNaFila({ tipo: 'execucao', estado: 'INTERVENCAO_NECESSARIA' })).toBe(0)
    expect(prioridadeNaFila({ tipo: 'execucao', estado: 'NA_FILA' })).toBe(2)
    expect(prioridadeNaFila({ tipo: 'execucao', estado: 'AGUARDANDO_DEPENDENCIA' })).toBe(2)
    expect(prioridadeNaFila({ tipo: 'execucao', estado: 'CONCLUIDA' })).toBe(6)
    expect(prioridadeNaFila({ tipo: 'pull-request', estado: 'MERGEADO', checks: 'SUCESSO' })).toBe(
      6,
    )
  })
})
