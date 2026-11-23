import { formatarIdade } from '@/modules/inicio/model'
import {
  FABRICA_SEM_BUSCAR_MS,
  compararNaFila,
  etapasAplicaveis,
  type Destino,
  type EtapaDefinida,
  type Encerramento,
  type Espera,
  type Marco,
  type Nivel,
  type Origem,
  type TipoDeDemanda,
} from './model'

export type TomDaDemanda = 'erro' | 'atencao' | 'informacao' | 'execucao' | 'neutro'

/** O que a tela Demandas lê de cada demanda. */
export interface DemandaNaLista {
  id: string
  titulo: string
  tipo: TipoDeDemanda | null
  projeto: string
  etapas: readonly EtapaDefinida[]
  temTela: boolean
  etapaAtual: string
  concluidas: readonly string[]
  espera: Espera | null
  encerrada: Encerramento | null
  destino: Destino | null
  criadaEm: Date
  esperaDesde: Date | null
  atualizadaEm: Date
}

export type PontoDoTrilho = 'feito' | 'atual' | 'espera' | 'travado' | 'futuro'

export interface QuadroDeEntrada {
  chave: 'recebidas' | 'orientadas' | 'urgente' | 'lote' | 'agentes' | 'decisao'
  n: number
  rotulo: string
  meta: string
  filtro: string | null
}

export interface LinhaDeDemanda {
  id: string
  href: string
  titulo: string
  projeto: string
  icone: ReturnType<typeof iconeDoTipo>
  trilho: ReturnType<typeof trilho>
  estado: { texto: string; tom: TomDaDemanda }
  idade: string
}

export type ChaveDoGrupo = 'espera_voce' | 'em_andamento' | 'na_fila'

export interface GrupoDeDemandas {
  chave: ChaveDoGrupo | 'orientadas_hoje'
  titulo: 'Espera você' | 'Em andamento' | 'Na fila' | 'Orientadas hoje'
  contagem: string
  linhas: LinhaDeDemanda[]
}

export interface TelaDeDemandas {
  quadros: QuadroDeEntrada[]
  grupos: GrupoDeDemandas[]
  fabricaSemBuscar: string | null
  podeCriar: boolean
}

const FUSO = 'America/Sao_Paulo'
const DIA = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO })

/** O mesmo dia do calendário de São Paulo. */
export function ehDeHoje(data: Date, agora: Date): boolean {
  return DIA.format(data) === DIA.format(agora)
}

const ICONE: Record<TipoDeDemanda, { letra: 'B' | 'I' | 'A' | 'F'; tom: TomDaDemanda }> = {
  defeito: { letra: 'B', tom: 'erro' },
  ideia: { letra: 'I', tom: 'atencao' },
  ajuste: { letra: 'A', tom: 'informacao' },
  funcao_nova: { letra: 'F', tom: 'execucao' },
}

export function iconeDoTipo(tipo: TipoDeDemanda | null): {
  letra: 'B' | 'I' | 'A' | 'F' | '?'
  tom: TomDaDemanda
} {
  return tipo ? ICONE[tipo] : { letra: '?', tom: 'neutro' }
}

function etapaAtualDe(d: DemandaNaLista): EtapaDefinida | undefined {
  return d.etapas.find((e) => e.chave === d.etapaAtual)
}

export function grupoDaDemanda(d: DemandaNaLista): ChaveDoGrupo | null {
  if (d.encerrada) return null
  if (d.espera !== null) return 'espera_voce'
  if (etapaAtualDe(d)?.marco === 'recebida') return 'na_fila'
  return 'em_andamento'
}

export const TEXTO_DA_ESPERA: Record<Exclude<Espera, 'concluir_etapa'>, string> = {
  aprovar_desenho: 'Aprovar desenho',
  planejar_comigo: 'Planejar comigo',
  decidir_destino: 'Decidir destino',
  travada: 'Travada',
  teste_falhou: 'Teste falhou',
}

const TEXTO_DO_MARCO: Record<Marco, string> = {
  recebida: 'Triagem',
  planejada: 'Planejando',
  desenho: 'Desenhando',
  desenvolvida: 'Desenvolvendo',
  testada: 'Testando no navegador',
  entregue: 'Entregando',
}

const travou = (espera: Espera | null) => espera === 'travada' || espera === 'teste_falhou'

export function rotuloDoEstado(d: DemandaNaLista): { texto: string; tom: TomDaDemanda } {
  const etapa = etapaAtualDe(d)
  const rotulo = etapa?.rotulo ?? d.etapaAtual
  if (d.espera !== null) {
    const texto = d.espera === 'concluir_etapa' ? `Concluir ${rotulo}` : TEXTO_DA_ESPERA[d.espera]
    return { texto, tom: travou(d.espera) ? 'erro' : 'atencao' }
  }
  if (d.encerrada === 'orientada') return { texto: 'Orientada', tom: 'neutro' }
  if (d.encerrada === 'descartada') return { texto: 'Encerrada', tom: 'neutro' }
  const marco = etapa?.marco ?? null
  if (marco === 'recebida') return { texto: TEXTO_DO_MARCO.recebida, tom: 'neutro' }
  if (marco === null) return { texto: `Em ${rotulo}`, tom: 'execucao' }
  return { texto: TEXTO_DO_MARCO[marco], tom: 'execucao' }
}

export function trilho(
  etapas: readonly EtapaDefinida[],
  d: DemandaNaLista,
): { chave: string; rotulo: string; ponto: PontoDoTrilho }[] {
  const posicaoAtual = etapas.findIndex((e) => e.chave === d.etapaAtual)
  return etapas.map((e, i) => {
    let ponto: PontoDoTrilho = 'futuro'
    if (
      d.encerrada === 'entregue' ||
      d.concluidas.includes(e.chave) ||
      i < posicaoAtual ||
      // A orientada termina na triagem: o ponto dela está feito.
      (d.encerrada === 'orientada' && i === posicaoAtual)
    ) {
      ponto = 'feito'
    } else if (i === posicaoAtual) {
      if (travou(d.espera)) ponto = 'travado'
      else if (d.espera !== null) ponto = 'espera'
      else ponto = 'atual'
    }
    return { chave: e.chave, rotulo: e.rotulo, ponto }
  })
}

const semHa = (idade: string) => idade.replace(/^há /, '')

export function fluxoDeEntrada(e: {
  hoje: readonly { origem: Origem; destino: Destino | null; encerrada: string | null }[]
  decidindo: readonly { esperaDesde: Date }[]
  horaDoLote: string
  vagas: { ocupadas: number; efetivas: number } | null
  agora: Date
}): QuadroDeEntrada[] {
  const conta = (f: (h: (typeof e.hoje)[number]) => boolean) => e.hoje.filter(f).length
  const voce = conta((h) => h.origem === 'flow')
  const sessoes = conta((h) => h.origem === 'sessao')
  const maisAntiga = e.decidindo.reduce<Date | null>(
    (min, d) => (min === null || d.esperaDesde < min ? d.esperaDesde : min),
    null,
  )
  return [
    {
      chave: 'recebidas',
      n: e.hoje.length,
      rotulo: 'Recebidas',
      meta: `você ${voce} · sessões ${sessoes}`,
      filtro: null,
    },
    {
      chave: 'orientadas',
      n: conta((h) => h.destino === 'orientada' || h.encerrada === 'orientada'),
      rotulo: 'Orientadas',
      meta: 'sem ir à Fábrica',
      filtro: 'orientada',
    },
    {
      chave: 'urgente',
      n: conta((h) => h.destino === 'urgente'),
      rotulo: 'Urgente',
      meta: 'na frente da fila',
      filtro: 'urgente',
    },
    {
      chave: 'lote',
      n: conta((h) => h.destino === 'lote_da_noite'),
      rotulo: 'Lote da noite',
      meta: `publica às ${e.horaDoLote}`,
      filtro: 'lote_da_noite',
    },
    {
      chave: 'agentes',
      n: conta((h) => h.destino === 'fila_de_agentes'),
      rotulo: 'Fila de agentes',
      meta: e.vagas
        ? `${e.vagas.ocupadas} de ${e.vagas.efetivas} vagas`
        : 'sem notícias da Fábrica',
      filtro: 'fila_de_agentes',
    },
    {
      chave: 'decisao',
      n: e.decidindo.length,
      rotulo: 'Decisão sua',
      meta: maisAntiga
        ? `a mais antiga: ${semHa(formatarIdade(maisAntiga, e.agora))}`
        : 'nada esperando',
      filtro: 'decisao_do_paulo',
    },
  ]
}

const TITULO_DO_GRUPO: Record<ChaveDoGrupo, GrupoDeDemandas['titulo']> = {
  espera_voce: 'Espera você',
  em_andamento: 'Em andamento',
  na_fila: 'Na fila',
}

function desdeDe(d: DemandaNaLista, grupo: GrupoDeDemandas['chave']): Date {
  if (grupo === 'espera_voce') return d.esperaDesde ?? d.atualizadaEm
  if (grupo === 'na_fila') return d.criadaEm
  return d.atualizadaEm
}

function linhaDe(d: DemandaNaLista, grupo: GrupoDeDemandas['chave'], agora: Date): LinhaDeDemanda {
  return {
    id: d.id,
    href: `/demandas/${d.id}`,
    titulo: d.titulo,
    projeto: d.projeto,
    icone: iconeDoTipo(d.tipo),
    trilho: trilho(etapasAplicaveis(d.etapas, d.temTela), d),
    estado: rotuloDoEstado(d),
    idade: semHa(formatarIdade(desdeDe(d, grupo), agora)),
  }
}

/**
 * "Espera você": a que espera há mais tempo primeiro; "Em andamento": a que andou por último
 * primeiro; "Na fila": urgente primeiro e depois a mais antiga, a ordem em que entram.
 */
export function montarGrupos(
  demandas: readonly DemandaNaLista[],
  agora: Date,
  /** Só com o filtro "orientada": as encerradas como orientadas hoje, num quarto grupo. */
  orientadasHoje: readonly DemandaNaLista[] | null = null,
): GrupoDeDemandas[] {
  const por: Record<ChaveDoGrupo, DemandaNaLista[]> = {
    espera_voce: [],
    em_andamento: [],
    na_fila: [],
  }
  for (const d of demandas) {
    const g = grupoDaDemanda(d)
    if (g) por[g].push(d)
  }
  por.espera_voce.sort(
    (a, b) => desdeDe(a, 'espera_voce').getTime() - desdeDe(b, 'espera_voce').getTime(),
  )
  por.em_andamento.sort((a, b) => b.atualizadaEm.getTime() - a.atualizadaEm.getTime())
  por.na_fila.sort(compararNaFila)
  const grupos: GrupoDeDemandas[] = (Object.keys(por) as ChaveDoGrupo[]).map((chave) => ({
    chave,
    titulo: TITULO_DO_GRUPO[chave],
    contagem: chave === 'na_fila' ? 'entram na ordem' : String(por[chave].length),
    linhas: por[chave].map((d) => linhaDe(d, chave, agora)),
  }))
  if (orientadasHoje === null) return grupos
  const orientadas = orientadasHoje
    .filter((d) => d.encerrada === 'orientada')
    .sort((a, b) => b.atualizadaEm.getTime() - a.atualizadaEm.getTime())
  return [
    ...grupos,
    {
      chave: 'orientadas_hoje',
      titulo: 'Orientadas hoje',
      contagem: String(orientadas.length),
      linhas: orientadas.map((d) => linhaDe(d, 'orientadas_hoje', agora)),
    },
  ]
}

/** A mesma regra do Início: só avisa com recebida parada além do limite e a Fábrica sem buscar. */
export function avisoDeFabricaSemBuscar(
  f: { buscouEm: Date | null; recebidasParadas: number; recebidaMaisAntigaDesde: Date | null },
  agora: Date,
): string | null {
  const passou = (desde: Date) => agora.getTime() - desde.getTime() > FABRICA_SEM_BUSCAR_MS
  if (f.recebidasParadas === 0 || f.recebidaMaisAntigaDesde === null) return null
  if (!passou(f.recebidaMaisAntigaDesde)) return null
  if (f.buscouEm === null) return 'a Fábrica nunca buscou demandas'
  if (!passou(f.buscouEm)) return null
  return `a Fábrica não busca ${formatarIdade(f.buscouEm, agora)}`
}

// ——— Página da demanda ———

/** O que a página lê da triagem; o resto do JSON da triagem não aparece aqui. */
export interface TriagemDaDemanda {
  tamanho: 'pequeno' | 'medio' | 'grande'
  mexeEm: string
  risco: 'baixo' | 'medio' | 'alto'
  dados: 'nenhum' | 'so_leitura' | 'escrita' | 'migracao'
  impacto: { podeQuebrar: readonly string[]; autorizacao: boolean; caminhoProtegido: boolean }
}

export interface QuadroDeImpacto {
  rotulo: 'Tamanho' | 'Mexe em' | 'Risco' | 'Dados'
  valor: string
}

const TAMANHO: Record<TriagemDaDemanda['tamanho'], string> = {
  pequeno: 'Pequeno',
  medio: 'Médio',
  grande: 'Grande',
}
const RISCO: Record<TriagemDaDemanda['risco'], string> = {
  baixo: 'Baixo',
  medio: 'Médio',
  alto: 'Alto',
}
const DADOS: Record<TriagemDaDemanda['dados'], string> = {
  nenhum: 'Nenhum',
  so_leitura: 'Só leitura',
  escrita: 'Escrita',
  migracao: 'Migração',
}

export function quadrosDeImpacto(triagem: TriagemDaDemanda | null): QuadroDeImpacto[] {
  if (!triagem) return []
  return [
    { rotulo: 'Tamanho', valor: TAMANHO[triagem.tamanho] },
    { rotulo: 'Mexe em', valor: triagem.mexeEm },
    { rotulo: 'Risco', valor: RISCO[triagem.risco] },
    { rotulo: 'Dados', valor: DADOS[triagem.dados] },
  ]
}

/** O que vai abaixo dos quadros: a lista curta do que pode quebrar e as pílulas de atenção. */
export function avisosDoImpacto(triagem: TriagemDaDemanda | null): {
  podeQuebrar: string[]
  pilulas: string[]
} {
  if (!triagem) return { podeQuebrar: [], pilulas: [] }
  const pilulas: string[] = []
  if (triagem.impacto.autorizacao) pilulas.push('mexe em autorização')
  if (triagem.impacto.caminhoProtegido) pilulas.push('caminho protegido')
  return { podeQuebrar: [...triagem.impacto.podeQuebrar], pilulas }
}

export type AcaoDaFaixa = 'aprovar' | 'ajuste' | 'destino' | 'retomar' | 'concluir'

export interface FaixaDaEspera {
  titulo: string
  contexto: string
  acoes: AcaoDaFaixa[]
  /** Só na travada: o PR da trava (`https://github.com/…`). */
  prUrl?: string
  /** Só na trava por pergunta do orquestrador: a retomada leva a resposta do Paulo ao plano. */
  responder?: true
}

/** O começo do motivo da trava quando o orquestrador fez uma pergunta (`MOTIVO_PERGUNTA` do kit). */
export const PREFIXO_DA_PERGUNTA = 'o orquestrador perguntou'

export interface DemandaEmEspera {
  id: string
  espera: Espera | null
  esperaMotivo: string | null
  versaoDoDesenho: number
  ultimoAjuste: { texto: string; em: Date } | null
  /** O `dados.url` do último evento `travada`, como veio. */
  urlDaTrava: string | null
  etapaAtual: string
  etapas: readonly EtapaDefinida[]
}

const DIA_DO_MES = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
})

/** "DD/MM" no fuso de São Paulo. */
export function diaEMes(data: Date): string {
  return DIA_DO_MES.format(data)
}

/** Hoje → "há 2 h"; o dia anterior em São Paulo → "ontem"; antes → "em DD/MM". */
export function quandoFoi(data: Date, agora: Date): string {
  if (ehDeHoje(data, agora)) return formatarIdade(data, agora)
  if (ehDeHoje(data, new Date(agora.getTime() - 24 * 60 * 60_000))) return 'ontem'
  return `em ${diaEMes(data)}`
}

export function faixaDaEspera(d: DemandaEmEspera, agora: Date): FaixaDaEspera | null {
  switch (d.espera) {
    case null:
      return null
    case 'aprovar_desenho': {
      if (d.versaoDoDesenho === 0) {
        // "Planejar comigo" com o artefato do Claude: não há versão da Fábrica.
        return {
          titulo: 'O artefato do Claude está pronto para você aprovar',
          contexto: 'O desenho é o artefato da sessão: abra o link abaixo',
          acoes: ['aprovar', 'ajuste'],
        }
      }
      const versao = `versão ${d.versaoDoDesenho}`
      const a = d.ultimoAjuste
      return {
        titulo: 'O desenho está pronto para você aprovar',
        contexto: a ? `${versao} · ajuste pedido ${quandoFoi(a.em, agora)}: "${a.texto}"` : versao,
        acoes: ['aprovar', 'ajuste'],
      }
    }
    case 'planejar_comigo':
      return {
        titulo: 'Esta demanda espera uma sessão de planejamento com você',
        contexto: `Na sessão do Claude Code do projeto, use o id ${d.id}`,
        acoes: [],
      }
    case 'decidir_destino':
      return {
        titulo: 'A triagem deixou o destino com você',
        contexto: d.esperaMotivo ?? '',
        acoes: ['destino'],
      }
    case 'travada': {
      const prUrl = linkDoGithub(d.urlDaTrava)
      const pergunta = d.esperaMotivo?.startsWith(PREFIXO_DA_PERGUNTA) === true
      return {
        titulo: d.esperaMotivo ?? 'A demanda travou',
        contexto: pergunta
          ? 'Leia a pergunta no PR e responda abaixo. Sem resposta, ele segue o caminho padrão que propôs.'
          : '',
        acoes: ['retomar'],
        ...(prUrl ? { prUrl } : {}),
        ...(pergunta ? { responder: true as const } : {}),
      }
    }
    case 'teste_falhou':
      return {
        titulo: 'O teste no navegador falhou duas vezes',
        contexto: d.esperaMotivo ?? '',
        acoes: ['retomar'],
      }
    case 'concluir_etapa': {
      const rotulo = d.etapas.find((e) => e.chave === d.etapaAtual)?.rotulo ?? d.etapaAtual
      return {
        titulo: `Conclua ${rotulo} quando estiver pronto`,
        contexto: '',
        acoes: ['concluir'],
      }
    }
  }
}

export interface PublicacaoNaEntrega {
  estado: string
  commit: string | null
  noArDesde: Date | null
}

const PUBLICACAO_NA_FILA = new Set(['na_fila', 'verificando', 'publicando'])

export function cabecalhoDaEntrega(publicacao: PublicacaoNaEntrega | null, agora: Date): string {
  if (publicacao?.estado === 'publicado' && publicacao.noArDesde) {
    return `✓ Entregue · no ar há ${semHa(formatarIdade(publicacao.noArDesde, agora))}`
  }
  if (publicacao && PUBLICACAO_NA_FILA.has(publicacao.estado)) {
    return '✓ Entregue · publicação na fila'
  }
  return '✓ Entregue'
}

/** O link do artefato só sai para `https://claude.ai/…`, sem usuário nem porta (de novo na tela). */
export function linkDoArtefato(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const ok =
      u.protocol === 'https:' && u.hostname === 'claude.ai' && !u.username && !u.password && !u.port
    return ok ? u.href : null
  } catch {
    return null
  }
}

/** O link da trava só sai para `https://github.com/…`, sem usuário nem porta. */
export function linkDoGithub(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const ok =
      u.protocol === 'https:' &&
      u.hostname === 'github.com' &&
      !u.username &&
      !u.password &&
      !u.port
    return ok ? u.href : null
  } catch {
    return null
  }
}

export const ROTULO_DO_NIVEL: Record<Nivel, string> = {
  planejar_comigo: 'Planejar comigo',
  aprovar_desenho: 'Aprovar desenho',
  vai_sozinho: 'Vai sozinho',
}

export const ROTULO_DO_DESTINO: Record<Destino, string> = {
  urgente: 'Urgente',
  lote_da_noite: 'Lote da noite',
  fila_de_agentes: 'Fila de agentes',
  decisao_do_paulo: 'Decisão sua',
  orientada: 'Orientada',
}

const QUEM_ABRIU: Record<Origem, string> = {
  flow: 'você',
  sessao: 'uma sessão',
  fabrica: 'a Fábrica',
  usuario: 'um usuário',
}

export function chipDeAbertura(origem: Origem, criadaEm: Date, agora: Date): string {
  return `aberta por ${QUEM_ABRIU[origem]} · ${formatarIdade(criadaEm, agora)}`
}

/** "PR #318" do último PR da lista; url sem número → null. */
export function chipDoPr(prs: readonly string[]): string | null {
  const numero = prs.at(-1)?.match(/\/pull\/(\d+)(?:[/?#]|$)/)?.[1]
  return numero ? `PR #${numero}` : null
}

const TEXTO_DO_EVENTO: Record<string, string> = {
  criada: 'Demanda aberta',
  anexo: 'Anexo recebido',
  triagem: 'Triagem feita',
  triagem_falhou: 'A triagem falhou',
  destino_decidido: 'Destino escolhido',
  plano_criado: 'Plano criado',
  plano_entregue: 'Plano entregue',
  desenho_pronto: 'Desenho enviado',
  desenho_aprovado: 'Desenho aprovado',
  ajuste_pedido: 'Ajuste pedido',
  etapa_concluida: 'Etapa concluída',
  etapa_concluida_pelo_paulo: 'Etapa concluída',
  travada: 'Travou',
  destravada: 'Destravou',
  retomada: 'Retomada',
  teste: 'Teste no navegador',
  entregue: 'Entregue',
  encerrada_pelo_paulo: 'Demanda encerrada',
}

const QUEM_FEZ: Record<string, string> = {
  fabrica: 'a Fábrica',
  paulo: 'você',
  sessao: 'uma sessão',
  flow: 'você',
  usuario: 'um usuário',
}

const LIMITE_DA_RESPOSTA_NO_HISTORICO = 120

export function textoDoEvento(tipo: string, dados: unknown): string {
  const d = (dados ?? {}) as Record<string, unknown>
  if (tipo === 'retomada' && typeof d.resposta === 'string' && d.resposta.trim()) {
    const r = d.resposta.trim()
    const curta =
      r.length > LIMITE_DA_RESPOSTA_NO_HISTORICO
        ? `${r.slice(0, LIMITE_DA_RESPOSTA_NO_HISTORICO)}…`
        : r
    return `Retomada com resposta: ${curta}`
  }
  if (tipo === 'teste')
    return d.resultado === 'passou' ? 'Teste no navegador passou' : 'Teste no navegador falhou'
  if ((tipo === 'desenho_aprovado' || tipo === 'ajuste_pedido') && typeof d.versao === 'number') {
    const qual = d.versao === 0 ? 'artefato do Claude' : `versão ${d.versao}`
    return `${TEXTO_DO_EVENTO[tipo]} (${qual})`
  }
  if (
    tipo === 'destino_decidido' &&
    typeof d.destino === 'string' &&
    d.destino in ROTULO_DO_DESTINO
  ) {
    return `Destino: ${ROTULO_DO_DESTINO[d.destino as Destino]}`
  }
  return TEXTO_DO_EVENTO[tipo] ?? tipo
}

export function quemFez(origem: string): string {
  return QUEM_FEZ[origem] ?? origem
}

export interface DesenhoNaPagina {
  arquivoId: string
  versao: number
  nome: string
  ehHtml: boolean
}

export interface EventoNoHistorico {
  id: string
  evento: string
  quem: string
  quando: Date
}

export interface PaginaDaDemanda {
  id: string
  titulo: string
  icone: ReturnType<typeof iconeDoTipo>
  chips: string[]
  /** Só na entregue: "✓ Entregue · …". */
  entrega: string | null
  trilho: ReturnType<typeof trilho>
  etapaAtual: string
  faixa: FaixaDaEspera | null
  impacto: { quadros: QuadroDeImpacto[]; podeQuebrar: string[]; pilulas: string[] }
  /** Na entregue, o desenho aprovado; antes disso, a versão mais nova. */
  desenho: DesenhoNaPagina | null
  artefatoUrl: string | null
  capturas: { id: string; tela: 'desktop' | 'celular' }[]
  capturasApagadasEm: Date | null
  temTela: boolean
  historico: EventoNoHistorico[]
  podeAgir: boolean
  /** O Paulo encerrou a demanda antes do fim. */
  descartada: boolean
  /** "Encerrar demanda": quem gerencia, com a demanda ainda aberta. */
  podeEncerrar: boolean
}
