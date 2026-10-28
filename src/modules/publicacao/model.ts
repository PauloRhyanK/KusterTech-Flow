import { createHash } from 'node:crypto'
import type { SituacaoItemAutorizacao as SituacaoItemPrisma } from '@prisma/client'
import type { TomDeEstado } from '@/lib/ui/badge-de-estado'
import type {
  EstadoImplantacao,
  OrigemEvidencia,
  SituacaoEvidencia,
} from '@/modules/ambientes/model'
import type { EstadoIntegracao } from '@/modules/github/model'
import type { EstadoItemHomologacao } from '@/modules/homologacao/model'

export const SHA_NULO = '0'.repeat(40)

export type SituacaoItemAutorizacao = 'QA_APROVADO' | 'REAPROVEITADO' | 'VERIFICADO_POR_HUMANO'

type Paridade<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _paridadeComOPrisma: Paridade<SituacaoItemAutorizacao, SituacaoItemPrisma> = true
void _paridadeComOPrisma

export type StatusDeComparacao = 'ahead' | 'behind' | 'identical' | 'diverged'

export type ItemDaComposicao =
  | { tipo: 'issue'; issueId: string; numero: number; prs: number[]; commits: string[] }
  | { tipo: 'commit-sem-pr'; commit: string }
  | { tipo: 'pr-sem-issue'; pr: number; commit: string }
  | { tipo: 'issue-nao-espelhada'; pr: number; numero: number }
  | { tipo: 'comparacao-truncada' }
  | { tipo: 'historico-divergente'; status: 'behind' | 'diverged' }
  | { tipo: 'sem-base' }

type ItemDesconhecido = Exclude<ItemDaComposicao, { tipo: 'issue' }>

export interface EntradaDoDelta {
  commitBase: string | null
  comparacao: {
    status: StatusDeComparacao
    commits: readonly string[]
    truncada: boolean
  } | null
  pullRequests: readonly {
    numero: number
    estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'
    shaMerge: string | null
    shaHead: string
    issuesReferenciadas: readonly number[]
  }[]
  issues: readonly { id: string; numero: number }[]
}

function comparar(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function ordenarNumeros(v: Iterable<number>): number[] {
  return [...new Set(v)].sort((a, b) => a - b)
}

function ordenarTextos(v: Iterable<string>): string[] {
  return [...new Set(v)].sort(comparar)
}

function chaveDoDesconhecido(i: ItemDesconhecido): string {
  return JSON.stringify(i)
}

// Forma canônica: issues por número, depois desconhecidos por tipo, commit e PR; chaves na ordem da união.
function canonizar(itens: readonly ItemDaComposicao[]): ItemDaComposicao[] {
  const issues = new Map<number, Extract<ItemDaComposicao, { tipo: 'issue' }>>()
  const desconhecidos = new Map<string, ItemDesconhecido>()
  for (const i of itens) {
    if (i.tipo === 'issue') {
      const atual = issues.get(i.numero)
      issues.set(i.numero, {
        tipo: 'issue',
        issueId: i.issueId,
        numero: i.numero,
        prs: ordenarNumeros([...(atual?.prs ?? []), ...i.prs]),
        commits: ordenarTextos([...(atual?.commits ?? []), ...i.commits]),
      })
    } else {
      const d = canonicoDoDesconhecido(i)
      desconhecidos.set(chaveDoDesconhecido(d), d)
    }
  }
  const textoOuVazio = (i: ItemDesconhecido) => ('commit' in i ? i.commit : '')
  const numeroOuZero = (i: ItemDesconhecido) => ('pr' in i ? i.pr : 0)
  return [
    ...[...issues.values()].sort((a, b) => a.numero - b.numero),
    ...[...desconhecidos.values()].sort(
      (a, b) =>
        comparar(a.tipo, b.tipo) ||
        comparar(textoOuVazio(a), textoOuVazio(b)) ||
        comparar(numeroOuZero(a), numeroOuZero(b)),
    ),
  ]
}

function canonicoDoDesconhecido(i: ItemDesconhecido): ItemDesconhecido {
  switch (i.tipo) {
    case 'commit-sem-pr':
      return { tipo: i.tipo, commit: i.commit }
    case 'pr-sem-issue':
      return { tipo: i.tipo, pr: i.pr, commit: i.commit }
    case 'issue-nao-espelhada':
      return { tipo: i.tipo, pr: i.pr, numero: i.numero }
    case 'historico-divergente':
      return { tipo: i.tipo, status: i.status }
    case 'comparacao-truncada':
    case 'sem-base':
      return { tipo: i.tipo }
  }
}

export function deltaDePublicacao(e: EntradaDoDelta): {
  estado: 'IDENTIFICADA' | 'INCERTA'
  itens: ItemDaComposicao[]
} {
  if (e.commitBase === null || e.comparacao === null) {
    return { estado: 'INCERTA', itens: [{ tipo: 'sem-base' }] }
  }
  const { status, commits, truncada } = e.comparacao
  if (status === 'identical') return { estado: 'IDENTIFICADA', itens: [] }
  if (status === 'behind' || status === 'diverged') {
    return { estado: 'INCERTA', itens: [{ tipo: 'historico-divergente', status }] }
  }

  const issuePorNumero = new Map(e.issues.map((i) => [i.numero, i]))
  const itens: ItemDaComposicao[] = []
  for (const commit of commits) {
    const pr = e.pullRequests.find(
      (p) => p.estado === 'MERGEADO' && (p.shaMerge === commit || p.shaHead === commit),
    )
    if (!pr) {
      itens.push({ tipo: 'commit-sem-pr', commit })
      continue
    }
    if (pr.issuesReferenciadas.length === 0) {
      itens.push({ tipo: 'pr-sem-issue', pr: pr.numero, commit })
      continue
    }
    for (const numero of pr.issuesReferenciadas) {
      const issue = issuePorNumero.get(numero)
      if (issue) {
        itens.push({
          tipo: 'issue',
          issueId: issue.id,
          numero,
          prs: [pr.numero],
          commits: [commit],
        })
      } else {
        itens.push({ tipo: 'issue-nao-espelhada', pr: pr.numero, numero })
      }
    }
  }
  if (truncada) itens.push({ tipo: 'comparacao-truncada' })

  const canonicos = canonizar(itens)
  return {
    estado: canonicos.some((i) => i.tipo !== 'issue') ? 'INCERTA' : 'IDENTIFICADA',
    itens: canonicos,
  }
}

export function hashDaComposicao(c: {
  commitBase: string
  commitAlvo: string
  itens: readonly ItemDaComposicao[]
}): string {
  const itens = canonizar(c.itens).map((i) => {
    if (i.tipo !== 'issue') return i
    return { tipo: i.tipo, numero: i.numero, prs: i.prs, commits: i.commits }
  })
  return createHash('sha256')
    .update(JSON.stringify({ commitBase: c.commitBase, commitAlvo: c.commitAlvo, itens }))
    .digest('hex')
}

// Todo commit da issue no delta deve ser ancestral da versão aprovada (ahead ou identical).
export function aprovacaoInalterada(
  statusPorCommit: readonly (StatusDeComparacao | null)[],
): boolean | null {
  if (statusPorCommit.length === 0 || statusPorCommit.includes(null)) return null
  return statusPorCommit.every((s) => s === 'ahead' || s === 'identical')
}

type Homologacao = {
  cliente: string
  estado: EstadoItemHomologacao
  versaoAvaliada: { id: string; rotulo: string } | null
}

export interface EntradaDeAutorizacao {
  alvoId: string
  composicao: { estado: 'IDENTIFICADA' | 'INCERTA'; itens: readonly ItemDaComposicao[] }
  integracao: EstadoIntegracao
  issues: readonly {
    issueId: string
    numero: number
    homologacoes: readonly Homologacao[]
    correcoesBloqueadoras: readonly { cliente: string }[]
    // Errata §3.8-6: a correção não tem item próprio; herda os itens da(s) issue(s) original(is).
    corrigeIssues?: readonly {
      homologacoes: readonly Homologacao[]
      correcoesBloqueadoras: readonly { cliente: string }[]
    }[]
  }[]
  aprovacoesAnteriores: readonly { issueId: string; versaoId: string; inalterada: boolean | null }[]
  autorizacaoAnterior: {
    itens: readonly ItemDaComposicao[]
    situacoes: readonly { issueId: string; situacao: SituacaoItemAutorizacao }[]
  } | null
  confirmacao: {
    contextoConferido: boolean
    desconhecidosConferidos: boolean
    verificadasPorHumano: readonly string[]
    justificativa: string | null
  }
}

export interface AvaliacaoDeAutorizacao {
  pode: boolean
  itens: {
    issueId: string
    numero: number
    situacao: SituacaoItemAutorizacao | null
    motivo: string
    afetado: boolean
    exigeVerificacaoHumana: boolean
  }[]
  desconhecidos: ItemDaComposicao[]
  bloqueios: string[]
  pendencias: string[]
  avisos: string[]
}

const JUSTIFICATIVA_MINIMA = 10

function mesmosCommits(a: readonly string[], b: readonly string[]): boolean {
  const x = ordenarTextos(a)
  const y = ordenarTextos(b)
  return x.length === y.length && x.every((c, i) => c === y[i])
}

export function avaliarAutorizacaoProd(e: EntradaDeAutorizacao): AvaliacaoDeAutorizacao {
  const bloqueios: string[] = []
  const pendencias: string[] = []
  const avisos: string[] = []
  const itensAvaliados: AvaliacaoDeAutorizacao['itens'] = []
  const anterior = e.autorizacaoAnterior

  if (e.integracao !== 'conectada') {
    bloqueios.push(
      'Os dados do GitHub deste repositório podem estar desatualizados. Autorize depois da próxima sincronização.',
    )
  }
  if (e.composicao.estado === 'IDENTIFICADA' && e.composicao.itens.length === 0) {
    bloqueios.push('A versão em QA não traz alterações em relação à base.')
  }

  const issuesDaComposicao = e.composicao.itens.filter(
    (i): i is Extract<ItemDaComposicao, { tipo: 'issue' }> => i.tipo === 'issue',
  )
  const desconhecidos = e.composicao.itens.filter((i) => i.tipo !== 'issue')
  const bloqueiosDeItem: string[] = []
  const pendenciasDeItem: string[] = []
  let algumaVerificadaPorHumano = false

  for (const item of issuesDaComposicao) {
    const dados = e.issues.find((i) => i.issueId === item.issueId)
    const homologacoes = [
      ...(dados?.homologacoes ?? []),
      ...(dados?.corrigeIssues ?? []).flatMap((o) => o.homologacoes),
    ]
    const bloqueadoras = [
      ...(dados?.correcoesBloqueadoras ?? []),
      ...(dados?.corrigeIssues ?? []).flatMap((o) => o.correcoesBloqueadoras),
    ]
    const prefixo = `#${item.numero}: `

    const anteriorDoItem = anterior?.itens.find(
      (i): i is Extract<ItemDaComposicao, { tipo: 'issue' }> =>
        i.tipo === 'issue' && i.issueId === item.issueId,
    )
    const afetado =
      !!anterior && (!anteriorDoItem || !mesmosCommits(anteriorDoItem.commits, item.commits))
    const base = { issueId: item.issueId, numero: item.numero, afetado }

    const aprovadas = homologacoes.filter((h) => h.estado === 'APROVADA')
    const noAlvo = aprovadas.find((h) => h.versaoAvaliada?.id === e.alvoId)
    const statusDe = (h: Homologacao) =>
      e.aprovacoesAnteriores.find(
        (a) => a.issueId === item.issueId && a.versaoId === h.versaoAvaliada?.id,
      )?.inalterada ?? null
    const inalterada = aprovadas.find((h) => h.versaoAvaliada && statusDe(h) === true)
    const situacaoAnterior =
      anteriorDoItem && !afetado
        ? anterior?.situacoes.find((s) => s.issueId === item.issueId)
        : undefined
    const verificada = e.confirmacao.verificadasPorHumano.includes(item.issueId)

    const humano = (motivo: string) => {
      if (verificada) {
        algumaVerificadaPorHumano = true
        itensAvaliados.push({
          ...base,
          situacao: 'VERIFICADO_POR_HUMANO',
          motivo: 'Verificada manualmente nesta autorização.',
          exigeVerificacaoHumana: true,
        })
      } else {
        pendenciasDeItem.push(prefixo + motivo)
        itensAvaliados.push({
          ...base,
          situacao: null,
          motivo,
          exigeVerificacaoHumana: true,
        })
      }
    }
    const bloquear = (motivo: string) => {
      bloqueiosDeItem.push(prefixo + motivo)
      itensAvaliados.push({
        ...base,
        situacao: null,
        motivo,
        exigeVerificacaoHumana: false,
      })
    }
    const aprovar = (situacao: SituacaoItemAutorizacao, motivo: string) =>
      itensAvaliados.push({ ...base, situacao, motivo, exigeVerificacaoHumana: false })

    if (bloqueadoras.length > 0) {
      const clientes = ordenarTextos(bloqueadoras.map((b) => b.cliente))
      bloquear(`Correção bloqueadora aberta (${clientes.join(', ')}).`)
    } else if (noAlvo) {
      aprovar('QA_APROVADO', 'QA aprovado nesta versão.')
    } else if (inalterada?.versaoAvaliada) {
      aprovar(
        'REAPROVEITADO',
        `Aprovação de QA da versão ${inalterada.versaoAvaliada.rotulo} reaproveitada: a issue não mudou desde então.`,
      )
    } else if (situacaoAnterior) {
      aprovar(
        'REAPROVEITADO',
        'Verificação da autorização anterior reaproveitada: a issue não mudou.',
      )
    } else if (homologacoes.length === 0) {
      humano('Sem homologação; verificação humana necessária.')
    } else if (aprovadas.some((h) => statusDe(h) === null)) {
      humano(
        'Não foi possível comprovar que a issue não mudou desde a aprovação; verificação humana necessária.',
      )
    } else if (aprovadas.length > 0) {
      bloquear('Alterada depois da aprovação de QA; precisa de novo teste.')
    } else {
      bloquear('QA pendente.')
    }

    const situacao = itensAvaliados[itensAvaliados.length - 1]?.situacao
    if (situacao) {
      for (const cliente of ordenarTextos(homologacoes.map((h) => h.cliente))) {
        if (!homologacoes.some((h) => h.cliente === cliente && h.estado === 'APROVADA')) {
          avisos.push(
            `${prefixo}homologação de ${cliente} ainda pendente (não bloqueia a autorização).`,
          )
        }
      }
    }
  }

  bloqueios.push(...bloqueiosDeItem)
  pendencias.push(...pendenciasDeItem)

  if (desconhecidos.length > 0 && !e.confirmacao.desconhecidosConferidos) {
    pendencias.push(
      desconhecidos.length === 1
        ? 'A composição tem 1 item desconhecido; confira manualmente.'
        : `A composição tem ${desconhecidos.length} itens desconhecidos; confira manualmente.`,
    )
  }
  const exigeJustificativa = e.composicao.estado === 'INCERTA' || algumaVerificadaPorHumano
  if (
    exigeJustificativa &&
    (e.confirmacao.justificativa ?? '').trim().length < JUSTIFICATIVA_MINIMA
  ) {
    pendencias.push('Justifique a conferência manual (mínimo de 10 caracteres).')
  }
  if (!e.confirmacao.contextoConferido) {
    pendencias.push('Confirme o projeto, o repositório, a versão e a composição.')
  }

  return {
    pode: bloqueios.length === 0 && pendencias.length === 0,
    itens: itensAvaliados,
    desconhecidos,
    bloqueios,
    pendencias,
    avisos,
  }
}

// Invariante 7: deploy em PROD sem autorização válida no momento do registro.
export function deployEhDivergente(e: {
  ambienteCriadoEm: Date
  evidencia: { situacao: SituacaoEvidencia; ocorridaEm: Date; registradaEm: Date }
  autorizacoes: readonly { criadaEm: Date; revogadaEm: Date | null }[]
}): boolean {
  const { evidencia } = e
  if (evidencia.situacao !== 'SUCESSO') return false
  if (evidencia.ocorridaEm < e.ambienteCriadoEm) return false
  const registro = evidencia.registradaEm.getTime()
  return !e.autorizacoes.some(
    (a) =>
      a.criadaEm.getTime() <= registro &&
      (a.revogadaEm === null || a.revogadaEm.getTime() > registro),
  )
}

export interface EstadoDePublicacao {
  codigo: string
  texto: string
  tom: TomDeEstado
}

export interface EntradaDosEstados {
  qa: { estados: readonly EstadoItemHomologacao[]; correcoesBloqueadoras: number }
  autorizacao: { criadaEm: Date; revogadaEm: Date | null } | null
  deploy:
    | { tipo: 'evidencia'; situacao: SituacaoEvidencia; origem: OrigemEvidencia }
    | { tipo: 'presenca'; estado: EstadoImplantacao }
    | null
  divergente: boolean
  verificacao: { origem: OrigemEvidencia } | null
}

export interface EstadosDePublicacao {
  qa: EstadoDePublicacao
  autorizacao: EstadoDePublicacao
  deploy: EstadoDePublicacao
  verificacao: EstadoDePublicacao
}

function estadoDoQa(qa: EntradaDosEstados['qa']): EstadoDePublicacao {
  if (qa.correcoesBloqueadoras > 0) {
    return { codigo: 'correcao', texto: 'Correção bloqueadora aberta', tom: 'erro' }
  }
  if (qa.estados.length === 0) {
    return { codigo: 'sem-homologacao', texto: 'Sem homologação', tom: 'neutro' }
  }
  const aprovados = qa.estados.filter((s) => s === 'APROVADA').length
  if (aprovados === qa.estados.length) {
    return { codigo: 'aprovada', texto: 'QA aprovado', tom: 'sucesso' }
  }
  if (aprovados > 0) {
    return {
      codigo: 'parcial',
      texto: `QA aprovado em ${aprovados} de ${qa.estados.length}`,
      tom: 'atencao',
    }
  }
  return { codigo: 'pendente', texto: 'QA pendente', tom: 'atencao' }
}

function estadoDoDeploy(e: EntradaDosEstados): EstadoDePublicacao {
  const semEvidencia: EstadoDePublicacao = {
    codigo: 'sem-evidencia',
    texto: 'Sem evidência de deploy em PROD',
    tom: 'neutro',
  }
  const implantada = (manual: boolean): EstadoDePublicacao =>
    e.divergente
      ? { codigo: 'divergente', texto: 'Em PROD sem autorização registrada', tom: 'atencao' }
      : manual
        ? { codigo: 'implantada', texto: 'Em PROD (confirmação manual)', tom: 'informacao' }
        : { codigo: 'implantada', texto: 'Em PROD', tom: 'sucesso' }
  const d = e.deploy
  if (!d) return semEvidencia
  if (d.tipo === 'evidencia') {
    if (d.situacao === 'EM_ANDAMENTO') {
      return { codigo: 'em-andamento', texto: 'Deploy em andamento', tom: 'execucao' }
    }
    if (d.situacao === 'FALHA') {
      return { codigo: 'falhou', texto: 'Deploy em PROD falhou', tom: 'erro' }
    }
    return implantada(d.origem === 'MANUAL')
  }
  switch (d.estado) {
    case 'PRESENCA_CONFIRMADA':
      return implantada(false)
    case 'CONFIRMACAO_MANUAL':
      return implantada(true)
    case 'VERIFICACAO_NECESSARIA':
      return {
        codigo: 'verificacao-necessaria',
        texto: 'Presença em PROD incerta: verificação necessária',
        tom: 'atencao',
      }
    case 'SEM_EVIDENCIA':
      return semEvidencia
  }
}

// D68: os quatro estados variam de forma independente; estado sem dado nunca é "sucesso" (invariante 9).
export function estadosDePublicacao(e: EntradaDosEstados): EstadosDePublicacao {
  const a = e.autorizacao
  return {
    qa: estadoDoQa(e.qa),
    autorizacao: !a
      ? { codigo: 'nao-autorizada', texto: 'Não autorizada para PROD', tom: 'neutro' }
      : a.revogadaEm
        ? {
            codigo: 'revogada',
            texto: 'Autorização revogada: a composição mudou',
            tom: 'atencao',
          }
        : { codigo: 'autorizada', texto: 'Autorizada para PROD', tom: 'sucesso' },
    deploy: estadoDoDeploy(e),
    verificacao: !e.verificacao
      ? { codigo: 'nao-verificada', texto: 'Não verificada em produção', tom: 'neutro' }
      : {
          codigo: 'verificada',
          texto:
            e.verificacao.origem === 'MANUAL'
              ? 'Verificada manualmente em produção'
              : 'Verificada em produção por evidência',
          tom: 'sucesso',
        },
  }
}

export function resumirEstadosDaMilestone(estados: readonly EstadosDePublicacao[]): {
  total: number
  qaAprovado: number
  autorizadas: number
  emProd: number
  verificadas: number
  emProdSemAutorizacao: number
} {
  const conta = (f: (e: EstadosDePublicacao) => boolean) => estados.filter(f).length
  return {
    total: estados.length,
    qaAprovado: conta((e) => e.qa.codigo === 'aprovada' || e.qa.codigo === 'parcial'),
    autorizadas: conta((e) => e.autorizacao.codigo === 'autorizada'),
    emProd: conta((e) => e.deploy.codigo === 'implantada' || e.deploy.codigo === 'divergente'),
    verificadas: conta((e) => e.verificacao.codigo === 'verificada'),
    emProdSemAutorizacao: conta((e) => e.deploy.codigo === 'divergente'),
  }
}

export function descreverItemDesconhecido(i: ItemDesconhecido): string {
  switch (i.tipo) {
    case 'commit-sem-pr':
      return `Commit ${i.commit.slice(0, 7)} não pertence a nenhum pull request mergeado.`
    case 'pr-sem-issue':
      return `O pull request #${i.pr} (commit ${i.commit.slice(0, 7)}) não referencia nenhuma issue.`
    case 'issue-nao-espelhada':
      return `O pull request #${i.pr} referencia a issue #${i.numero}, que não está espelhada na Central.`
    case 'comparacao-truncada':
      return 'A comparação de commits foi truncada pelo GitHub; a lista pode estar incompleta.'
    case 'historico-divergente':
      return i.status === 'behind'
        ? 'A versão em QA está atrás da base; o histórico não é linear.'
        : 'O histórico da versão em QA divergiu da base.'
    case 'sem-base':
      return 'Não há base de comparação (nenhuma autorização anterior nem versão em PROD).'
  }
}
