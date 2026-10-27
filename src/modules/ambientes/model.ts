import { createHash } from 'node:crypto'
import { ErroDeDominio } from '@/lib/erros'

export const TIPOS_DE_AMBIENTE = ['DEV', 'QA', 'PROD'] as const
export type TipoAmbiente = (typeof TIPOS_DE_AMBIENTE)[number]
export type OrigemEvidencia = 'GITHUB_DEPLOYMENT' | 'ENDPOINT' | 'MANUAL'
export type SituacaoEvidencia = 'SUCESSO' | 'FALHA' | 'EM_ANDAMENTO'
export type EstadoImplantacao =
  'SEM_EVIDENCIA' | 'PRESENCA_CONFIRMADA' | 'CONFIRMACAO_MANUAL' | 'VERIFICACAO_NECESSARIA'

export type ResultadoDeComparacao = 'ahead' | 'behind' | 'identical' | 'diverged' | 'indisponivel'

export interface PrParaPresenca {
  numero: number
  shaMerge: string | null
  mergeadoEm: Date | null
  comparacao: ResultadoDeComparacao
}

export interface EntradaDePresenca {
  issue: { numero: number; estado: 'ABERTA' | 'FECHADA' }
  versao: { commitSha: string; criadaEm: Date }
  prsMergeados: readonly PrParaPresenca[]
  confirmacaoManual: { porId: string; em: Date } | null
}

export interface PresencaCalculada {
  estado: EstadoImplantacao
  motivo: string
}

function listarPrs(numeros: readonly number[]): string {
  return numeros.map((n) => `#${n}`).join(', ')
}

// Presença por ancestralidade de commit; datas não entram na regra.
export function presencaDeIssueNaVersao(e: EntradaDePresenca): PresencaCalculada {
  if (e.confirmacaoManual) {
    return { estado: 'CONFIRMACAO_MANUAL', motivo: 'Presença confirmada manualmente.' }
  }

  if (e.prsMergeados.length === 0) {
    return e.issue.estado === 'FECHADA'
      ? {
          estado: 'VERIFICACAO_NECESSARIA',
          motivo: 'Issue fechada sem PR mergeado que a referencie; confira manualmente.',
        }
      : { estado: 'SEM_EVIDENCIA', motivo: 'Nenhum PR mergeado referencia esta issue.' }
  }

  const prs = [...e.prsMergeados].sort((a, b) => a.numero - b.numero)
  const indisponivel = prs.find((p) => p.shaMerge === null || p.comparacao === 'indisponivel')
  if (indisponivel) {
    return {
      estado: 'VERIFICACAO_NECESSARIA',
      motivo: `Não foi possível comparar o PR #${indisponivel.numero} com a versão.`,
    }
  }

  const contidos = prs.filter((p) => p.comparacao === 'ahead' || p.comparacao === 'identical')
  const ausentes = prs.filter((p) => p.comparacao === 'behind' || p.comparacao === 'diverged')
  const rotulo = (lista: readonly PrParaPresenca[]) =>
    lista.length === 1
      ? `do PR #${lista[0]?.numero}`
      : `dos PRs ${listarPrs(lista.map((p) => p.numero))}`

  if (ausentes.length === 0) {
    return { estado: 'PRESENCA_CONFIRMADA', motivo: `Contém o merge ${rotulo(contidos)}.` }
  }
  if (contidos.length === 0) {
    return { estado: 'SEM_EVIDENCIA', motivo: `Não contém o merge ${rotulo(ausentes)}.` }
  }
  return {
    estado: 'VERIFICACAO_NECESSARIA',
    motivo: `Contém o merge de ${listarPrs(contidos.map((p) => p.numero))}, mas não de ${listarPrs(ausentes.map((p) => p.numero))}; confira manualmente.`,
  }
}

export function prsMergeadosDaIssue<
  T extends {
    numero: number
    estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'
    issuesReferenciadas: readonly number[]
  },
>(numeroDaIssue: number, prs: readonly T[]): T[] {
  return prs
    .filter((p) => p.estado === 'MERGEADO' && p.issuesReferenciadas.includes(numeroDaIssue))
    .sort((a, b) => a.numero - b.numero)
}

export function assinaturaDaEntrada(
  prs: readonly { numero: number; shaMerge: string | null }[],
): string {
  return [...prs]
    .sort((a, b) => a.numero - b.numero)
    .map((p) => `${p.numero}:${p.shaMerge ?? '-'}`)
    .join(',')
}

export interface EvidenciaParaEstado {
  versaoId: string
  rotulo: string
  origem: OrigemEvidencia
  situacao: SituacaoEvidencia
  ocorridaEm: Date
  registradaEm: Date
}

function maisRecente(a: EvidenciaParaEstado, b: EvidenciaParaEstado): boolean {
  const porOcorrencia = a.ocorridaEm.getTime() - b.ocorridaEm.getTime()
  if (porOcorrencia !== 0) return porOcorrencia > 0
  return a.registradaEm.getTime() > b.registradaEm.getTime()
}

function maisRecenteDaLista(lista: readonly EvidenciaParaEstado[]): EvidenciaParaEstado | null {
  let atual: EvidenciaParaEstado | null = null
  for (const e of lista) {
    if (atual === null || maisRecente(e, atual)) atual = e
  }
  return atual
}

// A versão vigente é a do SUCESSO mais recente; a origem exibida prefere a automática.
export function evidenciaVigente(
  evidencias: readonly EvidenciaParaEstado[],
): EvidenciaParaEstado | null {
  const sucessos = evidencias.filter((e) => e.situacao === 'SUCESSO')
  const vigente = maisRecenteDaLista(sucessos)
  if (!vigente) return null

  const daVersao = sucessos.filter((e) => e.versaoId === vigente.versaoId)
  const automatica = maisRecenteDaLista(daVersao.filter((e) => e.origem !== 'MANUAL'))
  return automatica ?? maisRecenteDaLista(daVersao)
}

export interface ImplantacaoNoAmbiente {
  configurado: boolean
  estado: EstadoImplantacao
  motivo: string
  versao: { id: string; rotulo: string } | null
  origem: OrigemEvidencia | null
  ocorridaEm: Date | null
}

export function estadoDeImplantacaoNoAmbiente(e: {
  configurado: boolean
  evidencias: readonly EvidenciaParaEstado[]
  presencas: ReadonlyMap<string, PresencaCalculada>
}): ImplantacaoNoAmbiente {
  const vazio = { versao: null, origem: null, ocorridaEm: null }
  if (!e.configurado) {
    return {
      configurado: false,
      estado: 'SEM_EVIDENCIA',
      motivo: 'Ambiente não configurado.',
      ...vazio,
    }
  }

  const vigente = evidenciaVigente(e.evidencias)
  if (!vigente) {
    return {
      configurado: true,
      estado: 'SEM_EVIDENCIA',
      motivo: 'A evidência de deploy ainda não foi recebida.',
      ...vazio,
    }
  }

  const dadosDaVersao = {
    configurado: true,
    versao: { id: vigente.versaoId, rotulo: vigente.rotulo },
    origem: vigente.origem,
    ocorridaEm: vigente.ocorridaEm,
  }
  const presenca = e.presencas.get(vigente.versaoId)
  if (!presenca) {
    return {
      ...dadosDaVersao,
      estado: 'SEM_EVIDENCIA',
      motivo: `Presença ainda não calculada para a versão ${vigente.rotulo}.`,
    }
  }
  if (presenca.estado === 'PRESENCA_CONFIRMADA' && vigente.origem === 'MANUAL') {
    return {
      ...dadosDaVersao,
      estado: 'CONFIRMACAO_MANUAL',
      motivo: `Deploy registrado manualmente. ${presenca.motivo}`,
    }
  }
  return { ...dadosDaVersao, estado: presenca.estado, motivo: presenca.motivo }
}

export type TomDeImplantacao = 'neutro' | 'informacao' | 'atencao'

export function apresentarImplantacao(i: Pick<ImplantacaoNoAmbiente, 'configurado' | 'estado'>): {
  texto: string
  tom: TomDeImplantacao
} {
  if (!i.configurado) return { texto: 'Não configurado', tom: 'neutro' }
  switch (i.estado) {
    case 'SEM_EVIDENCIA':
      return { texto: 'Sem evidência', tom: 'neutro' }
    case 'PRESENCA_CONFIRMADA':
      return { texto: 'Presença confirmada', tom: 'informacao' }
    case 'CONFIRMACAO_MANUAL':
      return { texto: 'Confirmação manual', tom: 'informacao' }
    case 'VERIFICACAO_NECESSARIA':
      return { texto: 'Verificação necessária', tom: 'atencao' }
  }
}

export function situacaoDoStatus(estado: string | null): SituacaoEvidencia | null {
  switch (estado) {
    case 'success':
      return 'SUCESSO'
    case 'failure':
    case 'error':
      return 'FALHA'
    case 'inactive':
      return null
    default:
      return 'EM_ANDAMENTO'
  }
}

function normalizarNomeDeAmbiente(v: string): string {
  return v.trim().toLowerCase()
}

export function ambienteDoDeployment<T extends { nomeNoGitHub: string | null }>(
  environment: string,
  ambientes: readonly T[],
): T | null {
  const procurado = normalizarNomeDeAmbiente(environment)
  if (procurado === '') return null
  return (
    ambientes.find(
      (a) => a.nomeNoGitHub !== null && normalizarNomeDeAmbiente(a.nomeNoGitHub) === procurado,
    ) ?? null
  )
}

const REF_DE_VERSAO = /^v?\d+(\.\d+){1,3}([-+][0-9A-Za-z.-]+)?$/

export function rotuloDaVersao(e: {
  informado: string | null | undefined
  ref: string | null | undefined
  commitSha: string
}): string {
  const informado = e.informado?.trim()
  if (informado) return informado
  const ref = e.ref?.trim()
  if (ref && REF_DE_VERSAO.test(ref)) return ref
  return e.commitSha.slice(0, 7)
}

export function validarNomeNoGitHub(v: string): string | null {
  const nome = v.trim()
  if (nome === '') return null
  if (nome.length > 100) {
    throw new ErroDeDominio('O nome no GitHub não pode ter mais de 100 caracteres.')
  }
  return nome
}

export function validarUrlDoAmbiente(v: string): string | null {
  const url = v.trim()
  if (url === '') return null
  if (!/^https?:\/\//i.test(url)) {
    throw new ErroDeDominio('Informe uma URL que comece com http:// ou https://.')
  }
  return url
}

export function validarShaDeCommit(v: string): string {
  const sha = v.trim().toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new ErroDeDominio('Informe o SHA completo do commit (40 caracteres hexadecimais).')
  }
  return sha
}

export const PREFIXO_DO_TOKEN = 'fle_'

export function formatoDeTokenValido(t: string): boolean {
  return /^fle_[A-Za-z0-9_-]{43}$/.test(t)
}

export function hashDoTokenDeEvidencia(t: string): string {
  return createHash('sha256').update(t).digest('hex')
}

export const JANELA_DE_REVISAO_DE_DEPLOYMENTS_MS = 86_400_000

export function deploymentsDevidos(
  a: {
    deploymentsSincronizadosEm: Date | null
    deploymentsFalhaEm: Date | null
    sincronizacaoSolicitadaEm: Date | null
  },
  agora: Date,
  intervaloMs: number,
): boolean {
  const { deploymentsSincronizadosEm: lidoEm, deploymentsFalhaEm: falhaEm } = a
  const solicitadaEm = a.sincronizacaoSolicitadaEm

  if (lidoEm === null && falhaEm === null) return true

  const ultimaTentativa = Math.max(lidoEm?.getTime() ?? 0, falhaEm?.getTime() ?? 0)
  if (solicitadaEm !== null && solicitadaEm.getTime() > ultimaTentativa) return true

  const falhouDepoisDeLer = falhaEm !== null && (lidoEm === null || falhaEm > lidoEm)
  const referencia = falhouDepoisDeLer ? falhaEm : lidoEm
  return agora.getTime() - (referencia?.getTime() ?? 0) >= intervaloMs
}
