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

// Arquivos lidos por `lerArquivoBinario` (qualquer commit): o desenho que acompanha a pergunta 43.
const FLUXO_DOS_CAMPOS = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 150" font-family="sans-serif" font-size="13">',
  '<rect width="760" height="150" fill="#f5f7fa"/>',
  ...['Formulário', 'Recebimento', 'Normalização', 'Ficha do lead'].map((nome, i) => {
    const x = 20 + i * 185
    const seta =
      i < 3
        ? `<path d="M${x + 150} 75 h31" stroke="#607083"/><path d="M${x + 181} 75 l-7 -4 v8 z" fill="#607083"/>`
        : ''
    const borda = nome === 'Recebimento' ? '#a96011' : '#c6d2dc'
    return `<rect x="${x}" y="50" width="150" height="50" rx="8" fill="#ffffff" stroke="${borda}"/><text x="${x + 75}" y="80" text-anchor="middle" fill="#172033">${nome}</text>${seta}`
  }),
  '<text x="280" y="125" text-anchor="middle" fill="#a96011" font-size="11">a ordem se perde aqui</text>',
  '<script>document.title = "script do svg rodou"</script>',
  '</svg>',
].join('')

export const BINARIOS: Record<string, Record<string, string>> = {
  'kustertech-exemplo/portal': {
    '.fabrica/planejamento/lead-de-formulario-na-ficha/anexos/fluxo.svg': FLUXO_DOS_CAMPOS,
  },
}
