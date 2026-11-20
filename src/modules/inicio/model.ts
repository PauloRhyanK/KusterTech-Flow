import type { EstadoComposicao, EstadoItemHomologacao } from '@prisma/client'
import { autorizar, type Acao, type Sujeito } from '@/lib/auth/autorizar'
import { formatarDataHora } from '@/lib/data'
import type { TomDeEstado } from '@/lib/ui/badge-de-estado'
import { minutosDeAtraso, retratoDesatualizado } from '@/modules/fabrica/model'
import type { RetratoRecebido } from '@/modules/fabrica/queries'
import { apresentarEstado, type EstadoIntegracao } from '@/modules/github/model'
import { FABRICA_SEM_BUSCAR_MS, type Espera } from '@/modules/demandas/model'
import type { AvisoDePublicacao } from '@/modules/fila-de-publicacao/apresentacao'
import type { AvisoDaMaquina } from '@/modules/oficina/model'

export type TipoDeEspera =
  | 'decisao'
  | 'demanda'
  | 'plano-pausado'
  | 'aviso-da-oficina'
  | 'fabrica-sem-noticias'
  | 'publicacao'
  | 'integracao'
  | 'homologacao'
  | 'autorizacao-prod'
  | 'divergencia'

export const ORDEM_DOS_TIPOS: readonly TipoDeEspera[] = [
  'decisao',
  'demanda',
  'plano-pausado',
  'aviso-da-oficina',
  'fabrica-sem-noticias',
  'publicacao',
  'integracao',
  'homologacao',
  'autorizacao-prod',
  'divergencia',
]

export const ROTULO_DO_TIPO: Record<TipoDeEspera, string> = {
  decisao: 'Decisão',
  demanda: 'Demanda',
  'plano-pausado': 'Plano pausado',
  'aviso-da-oficina': 'Oficina',
  'fabrica-sem-noticias': 'Fábrica',
  publicacao: 'Publicação',
  integracao: 'Integração',
  homologacao: 'Homologação',
  'autorizacao-prod': 'Autorização',
  divergencia: 'Divergência',
}

export const LIMITE_DE_ESPERA = 20

export const ACAO_DE_LEITURA: Record<TipoDeEspera, Acao> = {
  decisao: 'desenvolvimento.ler',
  demanda: 'desenvolvimento.ler',
  'plano-pausado': 'desenvolvimento.ler',
  'fabrica-sem-noticias': 'desenvolvimento.ler',
  publicacao: 'desenvolvimento.ler',
  'aviso-da-oficina': 'infraestrutura.ler',
  integracao: 'projetos.gerenciar',
  homologacao: 'clientes.ler',
  'autorizacao-prod': 'publicacao.autorizar',
  divergencia: 'publicacao.autorizar',
}

type TomDeEspera = Exclude<TomDeEstado, 'sucesso'>

export interface ItemDeEspera {
  id: string
  tipo: TipoDeEspera
  titulo: string
  contexto: string
  href: string
  externo: boolean
  rotuloDoLink: string
  tom: TomDeEspera
  desde: Date | null
}

export type FonteDeEspera =
  { tipo: TipoDeEspera; itens: readonly ItemDeEspera[] } | { tipo: TipoDeEspera; falha: true }

export interface EsperaVoce {
  itens: ItemDeEspera[]
  total: number
  ocultos: number
  fontesComFalha: TipoDeEspera[]
}

function compararItens(a: ItemDeEspera, b: ItemDeEspera): number {
  const porTipo = ORDEM_DOS_TIPOS.indexOf(a.tipo) - ORDEM_DOS_TIPOS.indexOf(b.tipo)
  if (porTipo !== 0) return porTipo
  if (a.desde && b.desde) {
    const porData = a.desde.getTime() - b.desde.getTime()
    if (porData !== 0) return porData
  } else if (a.desde || b.desde) {
    return a.desde ? -1 : 1
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function montarEsperaVoce(fontes: readonly FonteDeEspera[]): EsperaVoce {
  const todos: ItemDeEspera[] = []
  const falhas = new Set<TipoDeEspera>()
  for (const fonte of fontes) {
    if ('falha' in fonte) falhas.add(fonte.tipo)
    else todos.push(...fonte.itens)
  }
  todos.sort(compararItens)
  return {
    itens: todos.slice(0, LIMITE_DE_ESPERA),
    total: todos.length,
    ocultos: Math.max(0, todos.length - LIMITE_DE_ESPERA),
    fontesComFalha: ORDEM_DOS_TIPOS.filter((tipo) => falhas.has(tipo)),
  }
}

const MINUTO_MS = 60_000

// Os avisos da fila de publicação levam à tela Publicação; o que traz link próprio (o PR do
// conserto) leva a ele.
export function esperasDaPublicacao(avisos: readonly AvisoDePublicacao[]): ItemDeEspera[] {
  return avisos.map((aviso) => ({
    id: `publicacao:${aviso.id}`,
    tipo: 'publicacao',
    titulo: aviso.titulo,
    contexto: aviso.contexto,
    ...(aviso.rotuloDoLink
      ? { href: aviso.href, externo: aviso.externo, rotuloDoLink: aviso.rotuloDoLink }
      : { href: '/publicacao', externo: false, rotuloDoLink: 'Ver a publicação' }),
    tom: aviso.tom,
    desde: aviso.desde,
  }))
}

export function formatarIdade(desde: Date, agora: Date): string {
  const minutos = Math.floor((agora.getTime() - desde.getTime()) / MINUTO_MS)
  if (minutos < 1) return 'há menos de 1 min'
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `há ${horas} h`
  return `há ${Math.floor(horas / 24)} d`
}

export interface LinhaDeDemanda {
  id: string
  titulo: string
  projeto: string
  espera: Espera
  esperaMotivo: string | null
  esperaDesde: Date
  rotuloDaEtapa: string
}

function tituloDaEspera(l: LinhaDeDemanda): string {
  switch (l.espera) {
    case 'aprovar_desenho':
      return `Aprovar o desenho de ${l.titulo}`
    case 'planejar_comigo':
      return `Planejar ${l.titulo} com você`
    case 'decidir_destino':
      return `Decidir o destino de ${l.titulo}`
    case 'travada':
      return `${l.titulo} travou`
    case 'teste_falhou':
      return `${l.titulo}: o teste no navegador falhou duas vezes`
    case 'concluir_etapa':
      return `Concluir ${l.rotuloDaEtapa} de ${l.titulo}`
  }
}

// Uma espera por demanda, mais um aviso quando a Fábrica deixou de buscar demandas com
// recebidas esperando a triagem.
export function esperasDasDemandas(
  linhas: readonly LinhaDeDemanda[],
  fabrica: { buscouEm: Date | null; recebidasParadas: number },
  agora: Date,
): ItemDeEspera[] {
  const itens: ItemDeEspera[] = linhas.map((l) => ({
    id: `demanda:${l.id}`,
    tipo: 'demanda',
    titulo: tituloDaEspera(l),
    contexto: `${l.projeto} · ${l.esperaMotivo ?? formatarIdade(l.esperaDesde, agora)}`,
    href: `/demandas/${l.id}`,
    externo: false,
    rotuloDoLink: 'Ver a demanda',
    tom: l.espera === 'travada' || l.espera === 'teste_falhou' ? 'erro' : 'atencao',
    desde: l.esperaDesde,
  }))
  const parada =
    fabrica.buscouEm === null ||
    agora.getTime() - fabrica.buscouEm.getTime() > FABRICA_SEM_BUSCAR_MS
  if (fabrica.recebidasParadas > 0 && parada) {
    const n = fabrica.recebidasParadas
    itens.push({
      id: 'fabrica-sem-buscar-demandas',
      tipo: 'fabrica-sem-noticias',
      titulo: fabrica.buscouEm
        ? `A Fábrica não busca demandas ${formatarIdade(fabrica.buscouEm, agora)}`
        : 'A Fábrica nunca buscou demandas',
      contexto: `${n} ${n === 1 ? 'demanda esperando' : 'demandas esperando'} a triagem`,
      href: '/demandas',
      externo: false,
      rotuloDoLink: 'Ver as demandas',
      tom: 'atencao',
      desde: fabrica.buscouEm,
    })
  }
  return itens
}

// Os mesmos estados de `planosEmCurso`: concluídos e removidos não esperam ninguém.
const PLANO_EM_CURSO: readonly RetratoRecebido['retrato']['planos'][number]['estado'][] = [
  'ativo',
  'admitindo',
  'pausado',
  'aguardando',
]

// Itens da Fábrica, só de planos em curso: uma decisão por `decisoes[]`, um por plano pausado e um quando o retrato
// está atrasado. Sem retrato não há item: a seção "Fábrica agora" explica.
export function esperasDaFabrica(
  recebido: RetratoRecebido | null,
  agora: Date,
  nomeDoProjeto: (repo: string) => string | null,
): ItemDeEspera[] {
  if (recebido === null) return []
  const itens: ItemDeEspera[] = []

  for (const plano of recebido.retrato.planos) {
    if (!PLANO_EM_CURSO.includes(plano.estado)) continue
    const contexto = `${nomeDoProjeto(plano.repo) ?? plano.repo} · ${plano.feature}`
    plano.decisoes.forEach((decisao, i) => {
      itens.push({
        id: `decisao:${plano.id}:${i}`,
        tipo: 'decisao',
        titulo: decisao.titulo,
        contexto,
        href: decisao.url,
        externo: true,
        rotuloDoLink: 'Responder no GitHub',
        tom: 'atencao',
        desde: null,
      })
    })
    if (plano.pausado) {
      itens.push({
        id: `plano-pausado:${plano.id}`,
        tipo: 'plano-pausado',
        titulo: plano.pausado,
        contexto,
        href: '/fabrica',
        externo: false,
        rotuloDoLink: 'Abrir a Fábrica',
        tom: 'atencao',
        desde: null,
      })
    }
  }

  if (retratoDesatualizado(recebido.recebidoEm, agora)) {
    itens.push({
      id: 'fabrica-sem-noticias',
      tipo: 'fabrica-sem-noticias',
      titulo: `A Fábrica não envia dados há ${minutosDeAtraso(recebido.recebidoEm, agora)} min`,
      contexto: `Último retrato recebido em ${formatarDataHora(recebido.recebidoEm)}`,
      href: '/fabrica',
      externo: false,
      rotuloDoLink: 'Abrir a Fábrica',
      tom: 'atencao',
      desde: recebido.recebidoEm,
    })
  }
  return itens
}

const ORIGEM_DO_AVISO: Record<AvisoDaMaquina['tipo'], string> = {
  memoria: 'Memória da máquina local',
  disco: 'Disco da máquina local',
  limpeza: 'Limpeza diária',
  arquivo: 'Registrado pela máquina local',
}

export function esperasDaOficina(
  avisos: readonly AvisoDaMaquina[],
  hrefDaMaquina: string,
): ItemDeEspera[] {
  return avisos.map((aviso, i) => ({
    id: `aviso-da-oficina:${i}:${aviso.tipo}`,
    tipo: 'aviso-da-oficina',
    titulo: aviso.mensagem,
    contexto: ORIGEM_DO_AVISO[aviso.tipo],
    href: hrefDaMaquina,
    externo: false,
    rotuloDoLink: 'Ver a máquina',
    tom: 'atencao',
    desde: aviso.desde,
  }))
}

// --- Fontes dos módulos congelados: só são consultadas com o módulo ativo. ---

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

const ESTADO_DA_NATUREZA: Record<NaturezaDeHomologacao, { texto: string; tom: TomDeEspera }> = {
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
): ItemDeEspera[] {
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
    const estado = ESTADO_DA_NATUREZA[natureza]
    const base = `/clientes/${cliente.id}/projetos/${projeto.id}/entregas`
    const comum = {
      id: `homologacao:${chave}`,
      tipo: 'homologacao',
      externo: false,
      rotuloDoLink: 'Abrir',
      tom: estado.tom,
      desde: new Date(Math.min(...itens.map((i) => i.atualizadoEm.getTime()))),
    } as const

    if (itens.length === 1) {
      return {
        ...comum,
        titulo: `#${primeira.issue.numero} ${primeira.issue.titulo}`,
        contexto: `${estado.texto} · ${cliente.nome} · ${projeto.nome} · ${milestone.titulo}`,
        href: `${base}/issues/${primeira.issue.id}?milestone=${milestone.id}`,
      }
    }
    return {
      ...comum,
      titulo: milestone.titulo,
      contexto: `${estado.texto} · ${cliente.nome} · ${projeto.nome} · ${itens.length} issues`,
      href: `${base}/milestones/${milestone.id}?aba=homologacao`,
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
}): ItemDeEspera {
  const identificada = c.estado === 'IDENTIFICADA'
  const estado = identificada ? 'Aguardando autorização' : 'Verificação humana necessária'
  return {
    id: `autorizacao-prod:${c.composicaoId}`,
    tipo: 'autorizacao-prod',
    titulo: `Autorizar ${c.versao.rotulo} em PROD`,
    contexto: `${estado} · ${c.projeto.nome} · ${c.repositorio}`,
    href: `/projetos/${c.projeto.id}/publicacoes?versao=${c.versao.id}`,
    externo: false,
    rotuloDoLink: 'Abrir',
    tom: identificada ? 'informacao' : 'atencao',
    desde: c.calculadaEm,
  }
}

export function pendenciaDeDivergencia(d: {
  id: string
  detectadaEm: Date
  projeto: { id: string; nome: string }
  repositorio: string
  rotulo: string
}): ItemDeEspera {
  return {
    id: `divergencia:${d.id}`,
    tipo: 'divergencia',
    titulo: `Deploy em PROD sem autorização registrada: ${d.rotulo}`,
    contexto: `${d.projeto.nome} · ${d.repositorio}`,
    href: `/projetos/${d.projeto.id}/publicacoes#divergencia-${d.id}`,
    externo: false,
    rotuloDoLink: 'Abrir',
    tom: 'atencao',
    desde: d.detectadaEm,
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
): ItemDeEspera | null {
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
      ? `${apresentado.texto} · última sincronização ${formatarDataHora(maisAntiga)}`
      : `${apresentado.texto} · nenhuma sincronização concluída`,
    href: `/projetos/${p.id}/configuracao#repositorios`,
    externo: false,
    rotuloDoLink: 'Abrir o projeto',
    tom: apresentado.tom === 'sucesso' ? 'neutro' : apresentado.tom,
    desde: maisAntiga,
  }
}

// --- "Seus projetos" do perfil escopado por cliente. ---

export interface Indicador {
  rotulo: string
  valor: string
  detalhe: string
}

// `homologacoesEmAndamento` é nulo quando o módulo de homologação está congelado.
export function indicadoresDeProjetos(d: {
  projetosAtivos: number
  homologacoesEmAndamento: number | null
}): Indicador[] {
  const indicadores: Indicador[] = [
    {
      rotulo: 'Projetos dos seus clientes',
      valor: String(d.projetosAtivos),
      detalhe:
        d.projetosAtivos === 0 ? 'Nenhum projeto dos seus clientes.' : 'projetos não arquivados',
    },
  ]
  if (d.homologacoesEmAndamento !== null) {
    indicadores.push({
      rotulo: 'Homologações em andamento',
      valor: String(d.homologacoesEmAndamento),
      detalhe: 'milestones em homologação, por cliente',
    })
  }
  return indicadores
}
