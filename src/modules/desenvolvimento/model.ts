import type { EstadoExecucao, StatusDeSeed } from '@prisma/client'
import { z } from 'zod'
import type { TomDeEstado } from '@/lib/ui/badge-de-estado'

export const PADRAO_RUN_ID = /^run_[a-z0-9]{6,40}$/
export const AUTOR_WARREN = /^warren-forge(?:-[a-z0-9]+)?\[bot\]$/
export const JANELA_SEM_SINAL_MS = 86_400_000

const TOLERANCIA_RELOGIO_MS = 5 * 60_000
const PADRAO_ID_DE_SEED = /^[A-Za-z][A-Za-z0-9]{0,15}-[a-z0-9]{3,12}$/
const PADRAO_BRANCH_DO_WARREN = /^warren\/(run_[a-z0-9]{6,40})$/
const LIMITE_DE_TEXTO = 200
const LIMITE_DO_PAPEL = 60
const LIMITE_DE_SEEDS_DO_CORPO = 20

export type TipoDeSeed = 'task' | 'bug' | 'feature' | 'epic' | 'outro'

export interface SeedLida {
  seedId: string
  titulo: string
  status: StatusDeSeed
  tipo: TipoDeSeed
  planoId: string | null
  bloqueadaPor: string[]
  atualizadaEm: Date | null
  execucao: { runId: string; registradaEm: Date | null; papel: string | null } | null
}

export interface PlanoLido {
  planoId: string
  nome: string
  status: string
  filhos: string[]
}

const STATUS_DO_SEEDS: Record<string, StatusDeSeed> = {
  open: 'ABERTA',
  in_progress: 'EM_ANDAMENTO',
  closed: 'FECHADA',
}

const TIPOS_CONHECIDOS: readonly string[] = ['task', 'bug', 'feature', 'epic']

function dataValida(valor: unknown): Date | null {
  if (typeof valor !== 'string') return null
  const data = new Date(valor)
  return Number.isNaN(data.getTime()) ? null : data
}

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === 'string' && valor !== '' ? valor : null
}

const esquemaDaSeed = z.object({
  id: z.string().regex(PADRAO_ID_DE_SEED),
  title: z.string().min(1),
  status: z.enum(['open', 'in_progress', 'closed']),
  type: z.unknown().optional(),
  plan_id: z.unknown().optional(),
  blockedBy: z.unknown().optional(),
  updatedAt: z.unknown().optional(),
  extensions: z.unknown().optional(),
})

const esquemaDoPlano = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().min(1),
  children: z.array(z.unknown()).optional(),
})

function linhasDe(jsonl: string): string[] {
  return jsonl.split('\n').filter((linha) => linha.trim() !== '')
}

function lerJson(linha: string): unknown {
  try {
    return JSON.parse(linha)
  } catch {
    return undefined
  }
}

function execucaoDaSeed(extensoes: unknown): SeedLida['execucao'] {
  if (typeof extensoes !== 'object' || extensoes === null) return null
  const { lastRunId, lastRunAt, role } = extensoes as Record<string, unknown>
  if (typeof lastRunId !== 'string' || !PADRAO_RUN_ID.test(lastRunId)) return null
  const papel = textoOuNulo(role)
  return {
    runId: lastRunId,
    registradaEm: dataValida(lastRunAt),
    papel: papel === null ? null : papel.slice(0, LIMITE_DO_PAPEL),
  }
}

export function lerSeeds(jsonl: string): { seeds: SeedLida[]; linhasInvalidas: number } {
  const porId = new Map<string, SeedLida>()
  let linhasInvalidas = 0
  for (const linha of linhasDe(jsonl)) {
    const resultado = esquemaDaSeed.safeParse(lerJson(linha))
    if (!resultado.success) {
      linhasInvalidas += 1
      continue
    }
    const l = resultado.data
    const bloqueadaPor = Array.isArray(l.blockedBy)
      ? l.blockedBy.filter(
          (id): id is string => typeof id === 'string' && PADRAO_ID_DE_SEED.test(id),
        )
      : []
    porId.set(l.id, {
      seedId: l.id,
      titulo: l.title.slice(0, LIMITE_DE_TEXTO),
      status: STATUS_DO_SEEDS[l.status]!,
      tipo:
        typeof l.type === 'string' && TIPOS_CONHECIDOS.includes(l.type)
          ? (l.type as TipoDeSeed)
          : 'outro',
      planoId: textoOuNulo(l.plan_id),
      bloqueadaPor,
      atualizadaEm: dataValida(l.updatedAt),
      execucao: execucaoDaSeed(l.extensions),
    })
  }
  return { seeds: [...porId.values()], linhasInvalidas }
}

export function lerPlanosDeSeeds(jsonl: string): {
  planos: PlanoLido[]
  linhasInvalidas: number
} {
  const porId = new Map<string, PlanoLido>()
  let linhasInvalidas = 0
  for (const linha of linhasDe(jsonl)) {
    const resultado = esquemaDoPlano.safeParse(lerJson(linha))
    if (!resultado.success) {
      linhasInvalidas += 1
      continue
    }
    const l = resultado.data
    porId.set(l.id, {
      planoId: l.id,
      nome: l.name.slice(0, LIMITE_DE_TEXTO),
      status: l.status,
      filhos: (l.children ?? []).filter((id): id is string => typeof id === 'string'),
    })
  }
  return { planos: [...porId.values()], linhasInvalidas }
}

export interface CorpoDePrWarren {
  runId: string | null
  agente: string | null
  custoUsd: string | null
  seeds: string[]
}

export function lerCorpoDePrWarren(corpo: string): CorpoDePrWarren {
  const linhas = corpo.split(/\r?\n/)
  const fim = linhas.findIndex((linha) => /^## Prompt\s*$/.test(linha))
  const visiveis = fim === -1 ? linhas : linhas.slice(0, fim)
  const texto = visiveis.join('\n')

  const runId = /\*\*Warren run:\*\*\s*`(run_[a-z0-9]{6,40})`/.exec(texto)?.[1] ?? null
  const agente = /^\s*-\s*\*\*Agent:\*\*\s*([A-Za-z0-9._-]{1,60})\s*$/m.exec(texto)?.[1] ?? null
  const custoUsd = /\*\*Cost:\*\*\s*\$(\d{1,6}(?:\.\d{1,6})?)(?![\d.])/.exec(texto)?.[1] ?? null

  const seeds: string[] = []
  const inicioDaSecao = visiveis.findIndex((linha) => /^## Seeds\s*$/.test(linha))
  if (inicioDaSecao !== -1) {
    for (const linha of visiveis.slice(inicioDaSecao + 1)) {
      if (/^## /.test(linha)) break
      const id = /^\s*-\s+([A-Za-z][A-Za-z0-9]{0,15}-[a-z0-9]{3,12})\s+—/.exec(linha)?.[1]
      if (id !== undefined && seeds.length < LIMITE_DE_SEEDS_DO_CORPO) seeds.push(id)
    }
  }
  return { runId, agente, custoUsd, seeds }
}

export function runIdDoBranch(branch: string): string | null {
  return PADRAO_BRANCH_DO_WARREN.exec(branch)?.[1] ?? null
}

export function ehPrDoWarren(autor: string | null, branch: string): boolean {
  return autor !== null && AUTOR_WARREN.test(autor) && runIdDoBranch(branch) !== null
}

export interface EntradaDoEstado {
  mencionadaNasFontes: boolean
  temPullRequest: boolean
  seed: { status: StatusDeSeed; ultimaExecucao: boolean } | null
  registradaEm: Date | null
}

const MOTIVO_SEM_INFORMACAO = 'As fontes lidas não informam o estado atual desta execução.'

export function estadoDaExecucao(
  e: EntradaDoEstado,
  agora: Date,
): { estado: EstadoExecucao; motivo: string } {
  if (!e.mencionadaNasFontes) {
    return { estado: 'SEM_DADOS', motivo: 'As fontes não mencionam mais esta execução.' }
  }
  if (e.temPullRequest) {
    return {
      estado: 'CONCLUIDA',
      motivo:
        'O Warren abriu a PR desta execução. Isso não indica PR aprovada, CI verde nem issue fechada.',
    }
  }
  if (e.seed === null || !e.seed.ultimaExecucao) {
    return { estado: 'SEM_DADOS', motivo: MOTIVO_SEM_INFORMACAO }
  }
  if (e.seed.status === 'EM_ANDAMENTO') {
    if (e.registradaEm !== null) {
      const idade = agora.getTime() - e.registradaEm.getTime()
      if (idade >= -TOLERANCIA_RELOGIO_MS && idade <= JANELA_SEM_SINAL_MS) {
        return {
          estado: 'EXECUTANDO',
          motivo: 'A seed está em andamento no Seeds e ainda não há PR desta execução.',
        }
      }
    }
    return {
      estado: 'SEM_DADOS',
      motivo: 'Sem sinal desta execução há mais de 24 h; o Warren não informa se ela terminou.',
    }
  }
  if (e.seed.status === 'FECHADA') {
    return {
      estado: 'SEM_DADOS',
      motivo: 'A seed foi fechada, mas nenhuma PR desta execução foi encontrada.',
    }
  }
  return {
    estado: 'SEM_DADOS',
    motivo: 'A seed voltou a aberta e não há PR desta execução; o resultado não foi informado.',
  }
}

export interface PrParaExecucao {
  id: string
  autor: string | null
  branch: string
  corpo: string | null
  atualizadoEm: Date
}

export type FonteDaExecucao = 'seeds' | 'pull-request' | 'seeds-e-pull-request'

export interface ExecucaoDerivada {
  runId: string
  seedId: string | null
  papel: string | null
  agente: string | null
  custoUsd: string | null
  iniciadaEm: Date | null
  pullRequestId: string | null
  fonte: FonteDaExecucao
  estado: EstadoExecucao
  motivo: string
}

export function derivarExecucoes(
  seeds: readonly SeedLida[],
  prs: readonly PrParaExecucao[],
  agora: Date,
): ExecucaoDerivada[] {
  const seedDoRun = new Map<string, SeedLida>()
  for (const seed of seeds) {
    if (seed.execucao !== null) seedDoRun.set(seed.execucao.runId, seed)
  }

  const prDoRun = new Map<string, PrParaExecucao>()
  for (const pr of prs) {
    if (!ehPrDoWarren(pr.autor, pr.branch)) continue
    const runId = runIdDoBranch(pr.branch)!
    const atual = prDoRun.get(runId)
    if (atual === undefined || pr.atualizadoEm.getTime() > atual.atualizadoEm.getTime()) {
      prDoRun.set(runId, pr)
    }
  }

  const runIds = [...new Set([...seedDoRun.keys(), ...prDoRun.keys()])].sort()
  return runIds.map((runId) => {
    const seed = seedDoRun.get(runId) ?? null
    const pr = prDoRun.get(runId) ?? null
    const corpo = pr?.corpo != null ? lerCorpoDePrWarren(pr.corpo) : null
    const corpoValeParaORun = corpo !== null && (corpo.runId === null || corpo.runId === runId)
    const { estado, motivo } = estadoDaExecucao(
      {
        mencionadaNasFontes: true,
        temPullRequest: pr !== null,
        seed: seed === null ? null : { status: seed.status, ultimaExecucao: true },
        registradaEm: seed?.execucao?.registradaEm ?? null,
      },
      agora,
    )
    return {
      runId,
      seedId: seed?.seedId ?? (corpoValeParaORun ? (corpo.seeds[0] ?? null) : null),
      papel: seed?.execucao?.papel ?? null,
      agente: corpoValeParaORun ? corpo.agente : null,
      custoUsd: corpoValeParaORun ? corpo.custoUsd : null,
      iniciadaEm: seed?.execucao?.registradaEm ?? null,
      pullRequestId: pr?.id ?? null,
      fonte:
        seed !== null && pr !== null
          ? 'seeds-e-pull-request'
          : pr !== null
            ? 'pull-request'
            : 'seeds',
      estado,
      motivo,
    }
  })
}

const ESTADOS_DA_EXECUCAO: Record<EstadoExecucao, { texto: string; tom: TomDeEstado }> = {
  NA_FILA: { texto: 'Na fila', tom: 'neutro' },
  AGUARDANDO_CAPACIDADE: { texto: 'Aguardando capacidade', tom: 'atencao' },
  AGUARDANDO_DEPENDENCIA: { texto: 'Aguardando dependência', tom: 'atencao' },
  EXECUTANDO: { texto: 'Executando', tom: 'execucao' },
  INTERVENCAO_NECESSARIA: { texto: 'Intervenção necessária', tom: 'erro' },
  CONCLUIDA: { texto: 'Concluída', tom: 'informacao' },
  SEM_DADOS: { texto: 'Sem dados', tom: 'neutro' },
}

const STATUS_DE_SEED: Record<StatusDeSeed, { texto: string; tom: TomDeEstado }> = {
  ABERTA: { texto: 'Aberta', tom: 'informacao' },
  EM_ANDAMENTO: { texto: 'Em andamento', tom: 'execucao' },
  FECHADA: { texto: 'Fechada', tom: 'neutro' },
}

export function apresentarEstadoDaExecucao(e: EstadoExecucao): { texto: string; tom: TomDeEstado } {
  return ESTADOS_DA_EXECUCAO[e]
}

export function apresentarStatusDeSeed(s: StatusDeSeed): { texto: string; tom: TomDeEstado } {
  return STATUS_DE_SEED[s]
}

export function leituraWarrenDevida(
  r: { warrenLidoEm: Date | null; warrenFalhaEm: Date | null; sincronizadoEm: Date | null },
  agora: Date,
  intervaloMs: number,
): boolean {
  if (r.warrenLidoEm === null) return true
  if (r.sincronizadoEm !== null && r.sincronizadoEm.getTime() > r.warrenLidoEm.getTime()) {
    return true
  }
  return agora.getTime() - r.warrenLidoEm.getTime() >= intervaloMs
}
