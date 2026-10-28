import type {
  EstadoComposicao,
  EstadoItemHomologacao,
  SeveridadeAlerta,
  TipoRecurso,
} from '@prisma/client'
import { autorizar, type Acao, type Sujeito } from '@/lib/auth/autorizar'
import { formatarDataHora } from '@/lib/data'
import type { TomDeEstado } from '@/lib/ui/badge-de-estado'
import { apresentarEstado, type EstadoIntegracao } from '@/modules/github/model'
import type { ItemChecklist } from '@/modules/projetos/model'

export type TipoDePendencia =
  'homologacao' | 'autorizacao-prod' | 'divergencia' | 'alerta' | 'integracao' | 'configuracao'

export const ORDEM_DE_PRIORIDADE: readonly TipoDePendencia[] = [
  'homologacao',
  'autorizacao-prod',
  'divergencia',
  'alerta',
  'integracao',
  'configuracao',
]

export const TITULOS_DOS_GRUPOS: Record<TipoDePendencia, string> = {
  homologacao: 'Homologações',
  'autorizacao-prod': 'Autorizações de PROD',
  divergencia: 'Divergências de deploy',
  alerta: 'Alertas ativos',
  integracao: 'Integrações',
  configuracao: 'Configuração incompleta',
}

export const LIMITE_POR_GRUPO = 5
export const LIMITE_EXPANDIDO = 50

export interface Pendencia {
  id: string
  tipo: TipoDePendencia
  titulo: string
  contexto: string
  href: string
  estado: { texto: string; tom: Exclude<TomDeEstado, 'sucesso'> }
  indicador: string | null
  peso: number
  desde: Date
}

export type EntradaDePendencias =
  | { tipo: TipoDePendencia; itens: readonly Pendencia[]; total: number }
  | { tipo: TipoDePendencia; falha: true }

export interface GrupoDePendencias {
  tipo: TipoDePendencia
  titulo: string
  total: number
  itens: Pendencia[]
  falha: boolean
  verTodas: { rotulo: string; href: string } | null
  aviso: string | null
  recolher: { rotulo: string; href: string } | null
}

function compararPendencias(a: Pendencia, b: Pendencia): number {
  return (
    a.peso - b.peso ||
    a.desde.getTime() - b.desde.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

function montarGrupo(
  entrada: EntradaDePendencias,
  expandido: TipoDePendencia | null,
): GrupoDePendencias {
  const titulo = TITULOS_DOS_GRUPOS[entrada.tipo]
  if ('falha' in entrada) {
    return {
      tipo: entrada.tipo,
      titulo,
      total: 0,
      itens: [],
      falha: true,
      verTodas: null,
      aviso: null,
      recolher: null,
    }
  }

  const ordenados = [...entrada.itens].sort(compararPendencias)
  const ancora = `grupo-${entrada.tipo}`
  const base = { tipo: entrada.tipo, titulo, total: entrada.total, falha: false }

  if (entrada.tipo === 'alerta') {
    return {
      ...base,
      itens: ordenados.slice(0, LIMITE_POR_GRUPO),
      verTodas:
        entrada.total > LIMITE_POR_GRUPO
          ? { rotulo: `Ver os ${entrada.total} alertas ativos`, href: '/infraestrutura/alertas' }
          : null,
      aviso: null,
      recolher: null,
    }
  }

  if (expandido === entrada.tipo) {
    return {
      ...base,
      itens: ordenados.slice(0, LIMITE_EXPANDIDO),
      verTodas: null,
      aviso:
        entrada.total > LIMITE_EXPANDIDO
          ? `Mostrando ${LIMITE_EXPANDIDO} de ${entrada.total}.`
          : null,
      recolher: { rotulo: 'Mostrar menos', href: `/#${ancora}` },
    }
  }

  return {
    ...base,
    itens: ordenados.slice(0, LIMITE_POR_GRUPO),
    verTodas:
      entrada.total > LIMITE_POR_GRUPO
        ? {
            rotulo: `Ver todas (${entrada.total})`,
            href: `/?grupo=${entrada.tipo}#${ancora}`,
          }
        : null,
    aviso: null,
    recolher: null,
  }
}

export function priorizarPendencias(
  entradas: readonly EntradaDePendencias[],
  expandido: TipoDePendencia | null,
): GrupoDePendencias[] {
  return ORDEM_DE_PRIORIDADE.flatMap((tipo) => {
    const entrada = entradas.find((e) => e.tipo === tipo)
    if (!entrada) {
      return []
    }
    if (!('falha' in entrada) && entrada.itens.length === 0 && entrada.total === 0) {
      return []
    }
    return [montarGrupo(entrada, expandido)]
  })
}

export function lerGrupoExpandido(
  searchParams: Record<string, string | string[] | undefined>,
  visiveis: readonly TipoDePendencia[],
): TipoDePendencia | null {
  const valor = searchParams.grupo
  if (typeof valor !== 'string') {
    return null
  }
  return visiveis.find((tipo) => tipo === valor) ?? null
}

const ACAO_DE_LEITURA: Record<TipoDePendencia, Acao> = {
  homologacao: 'clientes.ler',
  'autorizacao-prod': 'publicacao.autorizar',
  divergencia: 'publicacao.autorizar',
  alerta: 'infraestrutura.ler',
  integracao: 'projetos.gerenciar',
  configuracao: 'projetos.gerenciar',
}

export function tiposDePendenciaVisiveis(sujeito: Sujeito): TipoDePendencia[] {
  return ORDEM_DE_PRIORIDADE.filter((tipo) => autorizar(sujeito, ACAO_DE_LEITURA[tipo]))
}

export type NaturezaDeHomologacao =
  'testar' | 'retestar' | 'disponibilizar' | 'triar' | 'confirmar-reteste'

export function naturezasElegiveis(sujeito: Sujeito, clienteId: string): NaturezaDeHomologacao[] {
  const naturezas: NaturezaDeHomologacao[] = []
  if (autorizar(sujeito, 'homologacao.solicitar_correcao', { clienteId })) {
    naturezas.push('testar', 'retestar')
  }
  if (autorizar(sujeito, 'homologacao.disponibilizar', { clienteId })) {
    naturezas.push('disponibilizar')
  }
  if (autorizar(sujeito, 'homologacao.triar')) {
    naturezas.push('triar', 'confirmar-reteste')
  }
  return naturezas
}

export interface LinhaDeHomologacao {
  itemId: string
  homologacaoId: string
  estado: EstadoItemHomologacao
  // Solicitação de correção do item, quando relevante (base §3.8, item 7).
  solicitacao: 'ABERTA' | 'RESPONDIDA_SEM_TAREFA' | null
  // Há TarefaGitHub PENDENTE para a solicitação: a triagem já foi feita.
  temTarefaPendente: boolean
  atualizadoEm: Date
  cliente: { id: string; nome: string }
  projeto: { id: string; nome: string }
  milestone: { id: string; titulo: string }
  issue: { id: string; numero: number; titulo: string }
}

const ESTADO_DA_NATUREZA: Record<NaturezaDeHomologacao, Pendencia['estado']> = {
  testar: { texto: 'Pendente de teste', tom: 'informacao' },
  retestar: { texto: 'Aguardando reteste', tom: 'atencao' },
  triar: { texto: 'Correção a triar', tom: 'atencao' },
  'confirmar-reteste': { texto: 'Reteste a confirmar', tom: 'atencao' },
  disponibilizar: { texto: 'Aguardando disponibilização', tom: 'neutro' },
}

function naturezaDaLinha(l: LinhaDeHomologacao): NaturezaDeHomologacao | null {
  switch (l.estado) {
    case 'PENDENTE_DE_TESTE':
      return 'testar'
    case 'AGUARDANDO_RETESTE':
      return 'retestar'
    case 'AGUARDANDO_DISPONIBILIZACAO':
      return 'disponibilizar'
    case 'CORRECAO_SOLICITADA':
      if (l.solicitacao === 'ABERTA' && !l.temTarefaPendente) {
        return 'triar'
      }
      return l.solicitacao === 'RESPONDIDA_SEM_TAREFA' ? 'confirmar-reteste' : null
    case 'APROVADA':
      return null
  }
}

export function agruparHomologacoes(
  linhas: readonly LinhaDeHomologacao[],
  sujeito: Sujeito,
): Pendencia[] {
  const grupos = new Map<
    string,
    { natureza: NaturezaDeHomologacao; linhas: LinhaDeHomologacao[] }
  >()

  for (const l of linhas) {
    const natureza = naturezaDaLinha(l)
    if (!natureza || !naturezasElegiveis(sujeito, l.cliente.id).includes(natureza)) {
      continue
    }
    const chave = `${l.homologacaoId}:${natureza}`
    const grupo = grupos.get(chave)
    if (grupo) {
      grupo.linhas.push(l)
    } else {
      grupos.set(chave, { natureza, linhas: [l] })
    }
  }

  return [...grupos.entries()].map(([chave, { natureza, linhas: itens }]) => {
    const primeira = itens[0]!
    const { cliente, projeto, milestone } = primeira
    const desde = new Date(Math.min(...itens.map((i) => i.atualizadoEm.getTime())))
    const base = `/clientes/${cliente.id}/projetos/${projeto.id}/entregas`
    const comum = {
      id: `homologacao:${chave}`,
      tipo: 'homologacao',
      estado: ESTADO_DA_NATUREZA[natureza],
      peso: 0,
      desde,
    } as const

    if (itens.length === 1) {
      return {
        ...comum,
        titulo: `#${primeira.issue.numero} ${primeira.issue.titulo}`,
        contexto: `${cliente.nome} · ${projeto.nome} · ${milestone.titulo}`,
        href: `${base}/issues/${primeira.issue.id}?milestone=${milestone.id}`,
        indicador: null,
      }
    }
    return {
      ...comum,
      titulo: milestone.titulo,
      contexto: `${cliente.nome} · ${projeto.nome}`,
      href: `${base}/milestones/${milestone.id}?aba=homologacao`,
      indicador: `${itens.length} issues`,
    }
  })
}

export function pendenciaDeAutorizacao(c: {
  composicaoId: string
  estado: EstadoComposicao
  calculadaEm: Date
  projeto: { id: string; nome: string }
  repositorio: string
  versao: { id: string; rotulo: string }
}): Pendencia {
  return {
    id: `autorizacao-prod:${c.composicaoId}`,
    tipo: 'autorizacao-prod',
    titulo: `Autorizar ${c.versao.rotulo} em PROD`,
    contexto: `${c.projeto.nome} · ${c.repositorio} · composição calculada em ${formatarDataHora(c.calculadaEm)}`,
    href: `/projetos/${c.projeto.id}/publicacoes?versao=${c.versao.id}`,
    estado:
      c.estado === 'IDENTIFICADA'
        ? { texto: 'Aguardando autorização', tom: 'informacao' }
        : { texto: 'Verificação humana necessária', tom: 'atencao' },
    indicador: null,
    peso: 0,
    desde: c.calculadaEm,
  }
}

export function pendenciaDeDivergencia(d: {
  id: string
  detectadaEm: Date
  projeto: { id: string; nome: string }
  repositorio: string
  rotulo: string
}): Pendencia {
  return {
    id: `divergencia:${d.id}`,
    tipo: 'divergencia',
    titulo: `Deploy em PROD sem autorização registrada: ${d.rotulo}`,
    contexto: `${d.projeto.nome} · ${d.repositorio} · detectada em ${formatarDataHora(d.detectadaEm)}`,
    href: `/projetos/${d.projeto.id}/publicacoes#divergencia-${d.id}`,
    estado: { texto: 'Não reconhecida', tom: 'atencao' },
    indicador: null,
    peso: 0,
    desde: d.detectadaEm,
  }
}

const SEVERIDADE: Record<SeveridadeAlerta, { estado: Pendencia['estado']; peso: number }> = {
  CRITICA: { estado: { texto: 'Crítica', tom: 'erro' }, peso: 0 },
  ALTA: { estado: { texto: 'Alta', tom: 'erro' }, peso: 1 },
  MEDIA: { estado: { texto: 'Média', tom: 'atencao' }, peso: 2 },
  BAIXA: { estado: { texto: 'Baixa', tom: 'neutro' }, peso: 3 },
}

export function pendenciaDeAlerta(a: {
  id: string
  titulo: string
  severidade: SeveridadeAlerta
  primeiraOcorrenciaEm: Date
  ocorrencias: number
  recurso: string | null
  projeto: string | null
}): Pendencia {
  const { estado, peso } = SEVERIDADE[a.severidade]
  return {
    id: `alerta:${a.id}`,
    tipo: 'alerta',
    titulo: a.titulo,
    contexto: `${a.recurso ?? 'Sem recurso associado'} · ${a.projeto ?? 'Sem projeto associado'} · desde ${formatarDataHora(a.primeiraOcorrenciaEm)}`,
    href: `/infraestrutura/alertas#alerta-${a.id}`,
    estado,
    indicador: a.ocorrencias > 1 ? `${a.ocorrencias} ocorrências` : null,
    peso,
    desde: a.primeiraOcorrenciaEm,
  }
}

const GRAVIDADE_DA_INTEGRACAO: Partial<Record<EstadoIntegracao, number>> = {
  conectada: 0,
  'sem-dados-recentes': 1,
  indisponivel: 2,
}

export function pendenciaDeIntegracao(
  p: { id: string; nome: string },
  repositorios: readonly { estado: EstadoIntegracao; sincronizadoEm: Date | null }[],
): Pendencia | null {
  let pior: EstadoIntegracao = 'conectada'
  for (const r of repositorios) {
    if ((GRAVIDADE_DA_INTEGRACAO[r.estado] ?? 0) > (GRAVIDADE_DA_INTEGRACAO[pior] ?? 0)) {
      pior = r.estado
    }
  }
  if (pior === 'conectada') {
    return null
  }

  const apresentado = apresentarEstado(pior)
  const sincronizacoes = repositorios.flatMap((r) => (r.sincronizadoEm ? [r.sincronizadoEm] : []))
  const maisAntiga =
    sincronizacoes.length > 0 ? new Date(Math.min(...sincronizacoes.map((d) => d.getTime()))) : null

  return {
    id: `integracao:${p.id}`,
    tipo: 'integracao',
    titulo: `GitHub — ${p.nome}`,
    contexto: maisAntiga
      ? `Última sincronização: ${formatarDataHora(maisAntiga)}`
      : 'Nenhuma sincronização concluída',
    href: `/projetos/${p.id}/configuracao#repositorios`,
    estado: {
      texto: apresentado.texto,
      tom: apresentado.tom === 'sucesso' ? 'neutro' : apresentado.tom,
    },
    indicador: null,
    peso: 0,
    desde: maisAntiga ?? new Date(0),
  }
}

export function pendenciaDeConfiguracao(
  p: { id: string; nome: string; criadoEm: Date },
  checklist: readonly ItemChecklist[],
): Pendencia | null {
  const pendentes = checklist.filter((i) => i.estado === 'pendente')
  if (pendentes.length === 0) {
    return null
  }
  const algumConcluido = checklist.some((i) => i.estado === 'concluido')
  return {
    id: `configuracao:${p.id}`,
    tipo: 'configuracao',
    titulo: p.nome,
    contexto: `Falta: ${pendentes.map((i) => i.titulo).join(', ')}`,
    href: `/projetos/${p.id}`,
    estado: { texto: algumConcluido ? 'Parcial' : 'Não configurado', tom: 'neutro' },
    indicador: null,
    peso: 0,
    desde: p.criadoEm,
  }
}

export interface Indicador {
  rotulo: string
  valor: string
  detalhe: string
  semDados: boolean
}

export interface DadosDoResumoDeProjetos {
  escopo: 'global' | 'cliente'
  projetosAtivos: number
  configuracaoIncompleta: number | null
  milestonesAtivas: number | null
  homologacoesEmAndamento: number
  github: {
    configurada: boolean
    vinculados: number
    semDadosRecentes: number
    indisponiveis: number
    sincronizacaoMaisAntiga: Date | null
  } | null
}

function plural(n: number, singular: string, pluralDe: string): string {
  return `${n} ${n === 1 ? singular : pluralDe}`
}

function indicadorGitHub(github: NonNullable<DadosDoResumoDeProjetos['github']>): Indicador {
  const rotulo = 'GitHub'
  if (!github.configurada) {
    return {
      rotulo,
      valor: 'Sem dados',
      detalhe: 'A GitHub App da Central ainda não está configurada.',
      semDados: true,
    }
  }
  const valor = plural(github.vinculados, 'repositório', 'repositórios')
  if (github.vinculados === 0) {
    return { rotulo, valor, detalhe: 'Nenhum repositório vinculado.', semDados: false }
  }
  const problemas = [
    github.semDadosRecentes > 0 ? `${github.semDadosRecentes} sem dados recentes` : null,
    github.indisponiveis > 0 ? plural(github.indisponiveis, 'indisponível', 'indisponíveis') : null,
  ].filter((parte): parte is string => parte !== null)
  if (problemas.length > 0) {
    return { rotulo, valor, detalhe: problemas.join(' · '), semDados: false }
  }
  const antiga = github.sincronizacaoMaisAntiga
  return {
    rotulo,
    valor,
    detalhe: antiga
      ? `Sincronização mais antiga: ${formatarDataHora(antiga)}`
      : 'Nenhuma sincronização concluída.',
    semDados: false,
  }
}

export function indicadoresDeProjetos(d: DadosDoResumoDeProjetos): Indicador[] {
  const homologacoes: Indicador = {
    rotulo: 'Homologações em andamento',
    valor: String(d.homologacoesEmAndamento),
    detalhe: 'milestones em homologação, por cliente',
    semDados: false,
  }
  if (d.escopo === 'cliente') {
    return [
      {
        rotulo: 'Projetos dos seus clientes',
        valor: String(d.projetosAtivos),
        detalhe:
          d.projetosAtivos === 0 ? 'Nenhum projeto dos seus clientes.' : 'projetos não arquivados',
        semDados: false,
      },
      homologacoes,
    ]
  }
  const indicadores: Indicador[] = [
    {
      rotulo: 'Projetos ativos',
      valor: String(d.projetosAtivos),
      detalhe: d.projetosAtivos === 0 ? 'Nenhum projeto cadastrado.' : 'projetos não arquivados',
      semDados: false,
    },
  ]
  if (d.configuracaoIncompleta !== null) {
    indicadores.push({
      rotulo: 'Configuração incompleta',
      valor: String(d.configuracaoIncompleta),
      detalhe: 'projetos com itens pendentes no checklist',
      semDados: false,
    })
  }
  if (d.milestonesAtivas !== null) {
    indicadores.push({
      rotulo: 'Milestones ativas',
      valor: String(d.milestonesAtivas),
      detalhe: 'milestones não arquivadas',
      semDados: false,
    })
  }
  indicadores.push(homologacoes)
  if (d.github) {
    indicadores.push(indicadorGitHub(d.github))
  }
  return indicadores
}

export interface DadosDoResumoDeInfraestrutura {
  recursosPorTipo: Partial<Record<TipoRecurso, number>>
  alertasAtivos: number
  alertasCriticos: number
  alertasReconhecidos: number
  fontesDeAlertas: number
  alertasJaRegistrados: number
}

const TIPOS_DE_RECURSO: readonly { tipo: TipoRecurso; singular: string; plural: string }[] = [
  { tipo: 'SERVIDOR', singular: 'servidor', plural: 'servidores' },
  { tipo: 'CONTAINER', singular: 'container', plural: 'containers' },
  { tipo: 'BANCO', singular: 'banco', plural: 'bancos' },
  { tipo: 'STORAGE', singular: 'storage', plural: 'storages' },
  { tipo: 'OUTRO', singular: 'outro', plural: 'outros' },
]

function indicadorDeRecursos(porTipo: DadosDoResumoDeInfraestrutura['recursosPorTipo']): Indicador {
  const partes = TIPOS_DE_RECURSO.flatMap(({ tipo, singular, plural: pluralDe }) => {
    const n = porTipo[tipo] ?? 0
    return n > 0 ? [plural(n, singular, pluralDe)] : []
  })
  const total = TIPOS_DE_RECURSO.reduce((soma, { tipo }) => soma + (porTipo[tipo] ?? 0), 0)
  return {
    rotulo: 'Recursos',
    valor: String(total),
    detalhe: total === 0 ? 'Nenhum recurso cadastrado.' : partes.join(' · '),
    semDados: false,
  }
}

function indicadorDeAlertas(d: DadosDoResumoDeInfraestrutura): Indicador {
  const rotulo = 'Alertas ativos'
  if (d.fontesDeAlertas === 0 && d.alertasJaRegistrados === 0) {
    return {
      rotulo,
      valor: 'Sem dados',
      detalhe: 'Nenhuma fonte de alertas configurada.',
      semDados: true,
    }
  }
  const partes = [
    d.alertasCriticos > 0 ? plural(d.alertasCriticos, 'crítico', 'críticos') : null,
    d.alertasReconhecidos > 0
      ? `${plural(d.alertasReconhecidos, 'reconhecido', 'reconhecidos')} ainda ${
          d.alertasReconhecidos === 1 ? 'ativo' : 'ativos'
        } na origem`
      : null,
  ].filter((parte): parte is string => parte !== null)
  let detalhe = partes.join(' · ')
  if (detalhe === '') {
    detalhe =
      d.alertasAtivos === 0 ? 'Nenhum alerta ativo nas fontes configuradas.' : 'Nenhum crítico.'
  }
  return { rotulo, valor: String(d.alertasAtivos), detalhe, semDados: false }
}

export function indicadoresDeInfraestrutura(d: DadosDoResumoDeInfraestrutura): Indicador[] {
  return [
    indicadorDeRecursos(d.recursosPorTipo),
    indicadorDeAlertas(d),
    {
      rotulo: 'Saúde dos recursos',
      valor: 'Sem dados',
      detalhe: 'A Central ainda não recebe métricas; consulte o Beszel de cada recurso.',
      semDados: true,
    },
  ]
}
