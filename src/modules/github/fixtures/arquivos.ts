// Arquivos de repositório lidos por `lerArquivo` nos repositórios de fixture do Warren.
// Objetos viram uma linha de JSON; strings entram cruas (para a linha inválida).
type Linha = Record<string, unknown> | string

const unir = (linhas: Linha[]): string =>
  linhas.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n'

const PLANO = 'pl-ex01'
const DESCRICAO = 'Descrição que a Central não guarda.'
const CRIADA = '2026-10-18T09:00:00.000Z'

function seedsDe(prefixo: '0' | '1'): Linha[] {
  const run = (n: number) => `run_exemplo${prefixo}00${n}`
  const tarefa = (
    n: number,
    titulo: string,
    status: string,
    extra: Record<string, unknown>,
  ): Linha => ({
    id: `EXEM-a00${n}`,
    title: titulo,
    status,
    type: 'task',
    priority: 1,
    description: DESCRICAO,
    createdAt: CRIADA,
    updatedAt: '2026-10-21T09:00:00.000Z',
    plan_id: PLANO,
    ...extra,
  })
  const execucao = (n: number, lastRunAt: string) => ({
    extensions: {
      lastRunId: run(n),
      lastRunAt,
      role: 'architect-orchestrator',
      trigger: 'plan-run',
    },
  })
  return [
    {
      id: 'EXEM-e001',
      title: 'Relatórios',
      status: 'open',
      type: 'epic',
      priority: 1,
      description: DESCRICAO,
      createdAt: CRIADA,
      updatedAt: CRIADA,
    },
    tarefa(
      1,
      'Exportar relatório de entregas (Task 1)',
      'in_progress',
      execucao(1, '2026-10-20T10:00:00.000Z'),
    ),
    tarefa(
      2,
      'Ajustar filtro de clientes (Task 2)',
      'closed',
      execucao(2, '2026-10-19T14:00:00.000Z'),
    ),
    tarefa(
      3,
      'Agendar envio do relatório (Task 3)',
      'in_progress',
      execucao(3, '2026-10-21T09:00:00.000Z'),
    ),
    tarefa(4, 'Notificar cliente por e-mail (Task 4)', 'open', { blockedBy: ['EXEM-a003'] }),
    '{"id":"EXEM-quebrada",',
  ]
}

const plano: Linha[] = [
  {
    id: PLANO,
    name: 'Relatórios — plano de exemplo',
    status: 'active',
    children: ['EXEM-a001', 'EXEM-a002', 'EXEM-a003', 'EXEM-a004'],
  },
]

export const ARQUIVOS: Record<string, Record<string, string>> = {
  'kustertech-exemplo/automacao': {
    '.seeds/issues.jsonl': unir(seedsDe('0')),
    '.seeds/plans.jsonl': unir(plano),
  },
  'kustertech-exemplo/automacao-mobile': {
    '.seeds/issues.jsonl': unir(seedsDe('1')),
    '.seeds/plans.jsonl': unir(plano),
  },
}
