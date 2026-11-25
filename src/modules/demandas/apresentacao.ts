import type { EstadoDoPedido } from '@/modules/fila-de-publicacao/model'
import { formatarIdade } from '@/modules/inicio/model'
import {
  FABRICA_SEM_BUSCAR_MS,
  type Destino,
  type EtapaDefinida,
  type Encerramento,
  type Espera,
  type Marco,
  type Nivel,
  type Origem,
  type TipoDeDemanda,
} from './model'
import {
  MOTIVOS,
  conferivelPeloPaulo,
  fraseDaDemanda,
  grupoAteOAr,
  trilhoAteOAr,
  type GrupoAteOAr,
  type Parte,
  type PontoAteOAr,
} from './partes'

export type TomDaDemanda = 'erro' | 'atencao' | 'informacao' | 'execucao' | 'sucesso' | 'neutro'

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
  /** As partes, em qualquer ordem; a tela as põe na ordem de publicação. */
  partes: readonly Parte[]
  naoChegouDesde: Date | null
  noArEm: Date | null
  /** A versão do desenho aprovada, se houver. */
  desenhoAprovado: number | null
}

export type TomDaParte = 'ok' | 'andando' | 'nao' | 'neutro'

export interface ChipDaParte {
  chave: string
  texto: string
  tom: TomDaParte
}

export interface LinhaDeDemanda {
  id: string
  href: string
  titulo: string
  projeto: string
  partes: ChipDaParte[]
  trilho: PontoAteOAr[]
  estado: { texto: string; tom: TomDaDemanda }
  idade: string
}

export interface GrupoDeDemandas {
  chave: GrupoAteOAr | 'orientadas_hoje'
  titulo: 'Espera você' | 'Não chegou ao ar' | 'A caminho' | 'No ar' | 'Orientadas hoje'
  contagem: string
  linhas: LinhaDeDemanda[]
}

export interface QuadroAteOAr {
  chave: GrupoAteOAr
  numero: number
  rotulo: string
  meta: string
}

export interface TelaDeDemandas {
  quadros: QuadroAteOAr[]
  grupos: GrupoDeDemandas[]
  /** Quantas demandas foram orientadas hoje (o filtro "orientada" as mostra). */
  orientadasHoje: number
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
  /** `P` só no Decidir, para os avisos da publicação. */
  letra: 'B' | 'I' | 'A' | 'F' | '?' | 'P'
  tom: TomDaDemanda
} {
  return tipo ? ICONE[tipo] : { letra: '?', tom: 'neutro' }
}

function etapaAtualDe(d: DemandaNaLista): EtapaDefinida | undefined {
  return d.etapas.find((e) => e.chave === d.etapaAtual)
}

type GrupoDaFabrica = 'espera_voce' | 'em_andamento' | 'na_fila'

/** O grupo do "vem aí" da tela Publicação: o que a Fábrica ainda está fazendo. */
export function grupoDaDemanda(d: DemandaNaLista): GrupoDaFabrica | null {
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
  no_ar: 'Indo ao ar',
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

export interface DemandaQueVemAi {
  id: string
  titulo: string
  projeto: string
  estado: { texto: string; tom: TomDaDemanda }
}

const ORDEM_DO_GRUPO = { espera_voce: 0, em_andamento: 1, na_fila: 2 } as const

/** O que a Fábrica ainda está fazendo (as abertas): o que espera você, depois o que anda, depois a triagem. */
export function demandasQueVemAi(demandas: readonly DemandaNaLista[]): DemandaQueVemAi[] {
  return demandas
    .flatMap((d) => {
      const grupo = grupoDaDemanda(d)
      return grupo === null || !(grupo in ORDEM_DO_GRUPO)
        ? []
        : [{ d, ordem: ORDEM_DO_GRUPO[grupo as keyof typeof ORDEM_DO_GRUPO] }]
    })
    .sort((a, b) => a.ordem - b.ordem || b.d.atualizadaEm.getTime() - a.d.atualizadaEm.getTime())
    .map(({ d }) => ({ id: d.id, titulo: d.titulo, projeto: d.projeto, estado: rotuloDoEstado(d) }))
}

// "há menos de 1 min" vira "agora": a coluna da idade é estreita.
const semHa = (idade: string) =>
  idade === 'há menos de 1 min' ? 'agora' : idade.replace(/^há /, '')

// ——— Lista até o ar (spec "demanda até o ar", 5.2 e 5.3) ———

const ORDEM_DOS_GRUPOS: readonly GrupoAteOAr[] = ['espera_voce', 'nao_chegou', 'a_caminho', 'no_ar']

const TITULO_DO_GRUPO: Record<GrupoAteOAr, GrupoDeDemandas['titulo']> = {
  espera_voce: 'Espera você',
  nao_chegou: 'Não chegou ao ar',
  a_caminho: 'A caminho',
  no_ar: 'No ar',
}

const ativas = (partes: readonly Parte[]) => partes.filter((p) => p.estado !== 'descartada')

/** A ordem de publicação: segue `dependeDe`; `ordem` desempata (e decide num ciclo). */
export function ordemDePublicacao(partes: readonly Parte[]): Parte[] {
  const restantes = [...partes].sort((a, b) => a.ordem - b.ordem || a.chave.localeCompare(b.chave))
  const chaves = new Set(partes.map((p) => p.chave))
  const publicadas = new Set<string>()
  const ordem: Parte[] = []
  while (restantes.length > 0) {
    const i = restantes.findIndex((p) =>
      p.dependeDe.every((d) => !chaves.has(d) || publicadas.has(d)),
    )
    const [p] = restantes.splice(Math.max(i, 0), 1)
    if (!p) break
    ordem.push(p)
    publicadas.add(p.chave)
  }
  return ordem
}

const CURTO_DO_MOTIVO: Record<string, string> = {
  [MOTIVOS.publicacaoDispensada]: 'dispensada',
  [MOTIVOS.nuncaPublicada]: 'sem publicação',
  [MOTIVOS.publicadaSemConferir]: 'sem conferir',
  [MOTIVOS.publicacaoFalhou]: 'falhou',
}

function curtoDoMotivo(motivo: string | null): string {
  if (motivo === null) return 'não chegou'
  if (motivo.startsWith('PR aberto')) return 'PR aberto'
  return CURTO_DO_MOTIVO[motivo] ?? 'não chegou'
}

function chipDe(p: Parte): Omit<ChipDaParte, 'chave'> {
  switch (p.estado) {
    case 'planejando':
      return { texto: 'planejando', tom: 'neutro' }
    case 'em_curso':
      return { texto: 'em curso', tom: 'andando' }
    case 'feita':
      return { texto: 'feita', tom: 'neutro' }
    case 'publicando':
      return { texto: 'publicando', tom: 'andando' }
    case 'no_ar':
      return { texto: 'no ar', tom: 'ok' }
    case 'nao_chegou':
      return { texto: curtoDoMotivo(p.motivo), tom: 'nao' }
    case 'descartada':
      return { texto: 'descartada', tom: 'neutro' }
  }
}

/** `<chave> · <estado curto>` de cada parte, na ordem de publicação; a descartada não aparece. */
export function chipsDasPartes(partes: readonly Parte[]): ChipDaParte[] {
  return ordemDePublicacao(ativas(partes)).map((p) => ({ chave: p.chave, ...chipDe(p) }))
}

const marcoConcluido = (d: DemandaNaLista, marco: Marco) =>
  d.etapas.some((e) => e.marco === marco && d.concluidas.includes(e.chave))

/** Os quatro pontos (pedida, plano, feita, no ar); a orientada para na triagem. */
export function trilhoDaDemanda(d: DemandaNaLista): PontoAteOAr[] {
  if (d.encerrada === 'orientada') return ['cheio', 'vazio', 'vazio', 'vazio']
  // Encerrada como entregue antes das partes: feita, mas sem a conferência no site.
  if (d.encerrada === 'entregue') return ['cheio', 'cheio', 'cheio', 'cheio']
  const atual = etapaAtualDe(d)
  return [
    ...trilhoAteOAr(
      {
        triada:
          marcoConcluido(d, 'recebida') || (atual !== undefined && atual.marco !== 'recebida'),
        temTela: d.temTela,
        desenhoAprovado: d.desenhoAprovado !== null || marcoConcluido(d, 'desenho'),
        testePassou: marcoConcluido(d, 'testada'),
      },
      d.partes,
    ),
  ]
}

/**
 * A frase da linha: o motivo da parte mais atrasada. "Espera você" fala do que o Paulo tem a
 * fazer; "A caminho" sem motivo fala da etapa, porque "Falta a parte" lá seria alarme falso.
 */
function fraseDaLinha(
  d: DemandaNaLista,
  grupo: GrupoDeDemandas['chave'],
): { texto: string; tom: TomDaDemanda } {
  if (grupo === 'espera_voce' || grupo === 'orientadas_hoje' || ativas(d.partes).length === 0) {
    return rotuloDoEstado(d)
  }
  const frase = fraseDaDemanda(d.partes)
  if (grupo === 'a_caminho' && d.partes.some((p) => frase.texto === MOTIVOS.falta(p.chave))) {
    return rotuloDoEstado(d)
  }
  return frase
}

function desdeDe(d: DemandaNaLista, grupo: GrupoDeDemandas['chave']): Date {
  if (grupo === 'espera_voce') return d.esperaDesde ?? d.atualizadaEm
  if (grupo === 'nao_chegou') return d.naoChegouDesde ?? d.atualizadaEm
  if (grupo === 'no_ar') return d.noArEm ?? d.atualizadaEm
  return d.atualizadaEm
}

function linhaDe(d: DemandaNaLista, grupo: GrupoDeDemandas['chave'], agora: Date): LinhaDeDemanda {
  const desde = desdeDe(d, grupo)
  return {
    id: d.id,
    href: `/demandas/${d.id}`,
    titulo: d.titulo,
    projeto: d.projeto,
    partes: chipsDasPartes(d.partes),
    trilho: trilhoDaDemanda(d),
    estado: fraseDaLinha(d, grupo),
    idade:
      grupo === 'no_ar' && ehDeHoje(desde, agora) ? 'hoje' : semHa(formatarIdade(desde, agora)),
  }
}

/**
 * Espera você no topo; depois Não chegou ao ar (a mais antiga primeiro), A caminho (a que andou
 * por último primeiro) e No ar (a mais recente primeiro).
 */
export function montarGrupos(
  demandas: readonly DemandaNaLista[],
  agora: Date,
  /** Só com o filtro "orientada": as encerradas como orientadas hoje, num grupo no fim. */
  orientadasHoje: readonly DemandaNaLista[] | null = null,
): GrupoDeDemandas[] {
  const por: Record<GrupoAteOAr, DemandaNaLista[]> = {
    espera_voce: [],
    nao_chegou: [],
    a_caminho: [],
    no_ar: [],
  }
  for (const d of demandas) {
    const g = grupoAteOAr(d, agora)
    if (g) por[g].push(d)
  }
  const t = (d: DemandaNaLista, g: GrupoAteOAr) => desdeDe(d, g).getTime()
  por.espera_voce.sort((a, b) => t(a, 'espera_voce') - t(b, 'espera_voce'))
  por.nao_chegou.sort((a, b) => t(a, 'nao_chegou') - t(b, 'nao_chegou'))
  por.a_caminho.sort((a, b) => t(b, 'a_caminho') - t(a, 'a_caminho'))
  por.no_ar.sort((a, b) => t(b, 'no_ar') - t(a, 'no_ar'))
  const grupos: GrupoDeDemandas[] = ORDEM_DOS_GRUPOS.map((chave) => ({
    chave,
    titulo: TITULO_DO_GRUPO[chave],
    contagem: String(por[chave].length),
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

const QUADROS: readonly { chave: GrupoAteOAr; rotulo: string; meta: string }[] = [
  { chave: 'no_ar', rotulo: 'No ar', meta: 'conferidas no site' },
  { chave: 'a_caminho', rotulo: 'A caminho', meta: 'Fábrica trabalhando' },
  { chave: 'nao_chegou', rotulo: 'Não chegou ao ar', meta: 'feita, mas falta algo' },
  { chave: 'espera_voce', rotulo: 'Espera você', meta: '' },
]

const DIA_MS = 24 * 60 * 60_000

/** "há 4 dias", "há 1 dia"; menos de um dia, a idade curta ("há 6 h"). */
function haQuantosDias(desde: Date, agora: Date): string {
  const dias = Math.floor((agora.getTime() - desde.getTime()) / DIA_MS)
  if (dias < 1) return formatarIdade(desde, agora)
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`
}

/** Os quatro números do topo: a contagem de cada grupo; "Espera você" diz há quanto a mais antiga espera. */
export function quadrosAteOAr(demandas: readonly DemandaNaLista[], agora: Date): QuadroAteOAr[] {
  const por = new Map<GrupoAteOAr, DemandaNaLista[]>()
  for (const d of demandas) {
    const g = grupoAteOAr(d, agora)
    if (g) por.set(g, [...(por.get(g) ?? []), d])
  }
  return QUADROS.map((q) => {
    const doGrupo = por.get(q.chave) ?? []
    let meta = q.meta
    if (q.chave === 'espera_voce') {
      const maisAntiga = doGrupo
        .map((d) => desdeDe(d, 'espera_voce'))
        .sort((a, b) => a.getTime() - b.getTime())[0]
      meta = maisAntiga ? haQuantosDias(maisAntiga, agora) : 'nada esperando'
    }
    return { chave: q.chave, numero: doGrupo.length, rotulo: q.rotulo, meta }
  })
}

// ——— Detalhe até o ar (5.4) ———

const ADIANTAMENTO: Record<Parte['estado'], number> = {
  planejando: 0,
  em_curso: 1,
  feita: 2,
  nao_chegou: 2,
  publicando: 3,
  no_ar: 4,
  descartada: 5,
}

function maisAtrasada(partes: readonly Parte[]): Parte | undefined {
  const ordem = ordemDePublicacao(ativas(partes))
  return [...ordem].sort(
    (a, b) =>
      ADIANTAMENTO[a.estado] - ADIANTAMENTO[b.estado] || ordem.indexOf(a) - ordem.indexOf(b),
  )[0]
}

export interface FaixaDoQueFalta {
  titulo: string
  contexto: string
  /** A chave da parte que o Paulo pode dar como no ar ("Conferi no ar"); null sem ação. */
  conferir: string | null
}

function oQueAconteceCom(p: Parte): string {
  switch (p.estado) {
    case 'planejando':
      return 'A Fábrica está planejando essa parte.'
    case 'em_curso':
      return 'A Fábrica está fazendo essa parte.'
    case 'feita':
      return 'Feita; falta publicar.'
    case 'publicando':
      return `${p.motivo ?? 'Publicando'}.`
    default:
      return `${p.motivo ?? 'Não chegou ao ar'}.`
  }
}

/** A faixa "Falta": só com a demanda em "Não chegou ao ar"; a parte mais atrasada e o que acontece com ela. */
export function faixaDoQueFalta(e: {
  grupo: GrupoAteOAr | null
  partes: readonly Parte[]
  podeConferir: boolean
}): FaixaDoQueFalta | null {
  if (e.grupo !== 'nao_chegou') return null
  const atrasada = maisAtrasada(e.partes)
  if (!atrasada) return null
  const n = ativas(e.partes).length
  const objetivo = atrasada.objetivo.trim()
  const conferivel = ordemDePublicacao(ativas(e.partes)).find(conferivelPeloPaulo)
  return {
    titulo: `Falta: a parte do ${atrasada.chave}${objetivo ? ` (${objetivo})` : ''}`,
    contexto:
      oQueAconteceCom(atrasada) + (n > 1 ? ` A demanda só fecha com as ${n} partes no ar.` : ''),
    conferir: e.podeConferir && conferivel ? conferivel.chave : null,
  }
}

/** "Ordem de publicação: back antes do front"; com uma parte só, nada. */
export function textoDaOrdem(partes: readonly Parte[]): string | null {
  const chaves = ordemDePublicacao(ativas(partes)).map((p) => p.chave)
  if (chaves.length < 2) return null
  if (chaves.length === 2) return `Ordem de publicação: ${chaves[0]} antes do ${chaves[1]}`
  return `Ordem de publicação: ${chaves.join(' → ')}`
}

export interface PassoDaParte {
  rotulo: string
  ponto: PontoAteOAr
  detalhe: string | null
  links: { texto: string; href: string }[]
}

export interface CartaoDaParte {
  chave: string
  titulo: string
  repositorio: string
  estado: { texto: string; tom: TomDaParte }
  passos: PassoDaParte[]
}

/** O que vem do banco para os passos, por chave da parte. */
export interface ExtrasDasPartes {
  /** O PR do plano da parte. */
  planos: Record<string, string>
  /** O PR do conserto em curso da publicação da parte. */
  consertos: Record<string, string>
  /** O estado do pedido de publicação corrente da parte. */
  pedidos: Record<string, EstadoDoPedido>
  /** A parte foi dada como no ar pelo Paulo ("Conferi no ar"). */
  conferidas: Record<string, boolean>
  /** Demanda com tela: a parte que tem a tela e quando o desenho foi aprovado (null: pendente). */
  desenho: { chave: string; aprovadoEm: Date | null } | null
}

const ROTULO_DO_PEDIDO: Record<EstadoDoPedido, string> = {
  na_fila: 'na fila',
  verificando: 'verificando',
  publicando: 'publicando',
  publicado: 'publicado',
  recusado: 'recusado',
  dispensado: 'dispensado',
  falhou: 'falhou',
  cancelado: 'cancelado',
}

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const link = (texto: string, url: string | undefined) => {
  const href = linkDoGithub(url ?? null)
  return href ? [{ texto, href }] : []
}

function passoDaPublicacao(p: Parte, x: ExtrasDasPartes): PassoDaParte {
  switch (p.estado) {
    case 'no_ar': {
      const sha = p.commitNoAr ?? p.commitAlvo
      const detalhe = [
        x.conferidas[p.chave] ? 'conferida por você' : null,
        p.noArEm && diaEMes(p.noArEm),
      ]
        .filter(Boolean)
        .join(' · ')
      return {
        rotulo: sha ? MOTIVOS.noAr(sha) : 'No ar',
        ponto: 'verde',
        detalhe: detalhe || null,
        links: [],
      }
    }
    case 'nao_chegou':
      return { rotulo: p.motivo ?? 'Não chegou ao ar', ponto: 'vermelho', detalhe: null, links: [] }
    case 'publicando': {
      const pedido = x.pedidos[p.chave]
      return {
        rotulo: p.motivo ?? 'Publicando',
        ponto: 'andando',
        detalhe: pedido ? ROTULO_DO_PEDIDO[pedido] : null,
        links: link('conserto', x.consertos[p.chave]),
      }
    }
    default:
      return { rotulo: 'Publicada e conferida no site', ponto: 'vazio', detalhe: null, links: [] }
  }
}

const COM_PRS: ReadonlySet<Parte['estado']> = new Set([
  'feita',
  'publicando',
  'no_ar',
  'nao_chegou',
])

/** Um cartão por parte, na ordem de publicação: plano, PRs e publicação com conferência. */
export function cartoesDasPartes(partes: readonly Parte[], x: ExtrasDasPartes): CartaoDaParte[] {
  const ordem = ordemDePublicacao(ativas(partes))
  return ordem.map((p, i) => {
    const faltam = p.dependeDe.filter((d) =>
      ordem.some((o) => o.chave === d && o.estado !== 'no_ar'),
    )
    const abertos = p.prs.filter((pr) => pr.estado === 'aberto').length
    return {
      chave: p.chave,
      titulo: `${i + 1} · ${maiuscula(p.chave)}`,
      repositorio: p.repositorio.split('/').pop() ?? p.repositorio,
      estado:
        p.estado !== 'no_ar' && faltam.length > 0
          ? { texto: `espera o ${faltam.join(' e o ')}`, tom: 'andando' }
          : chipDe(p),
      passos: [
        ...(x.desenho?.chave === p.chave
          ? [
              {
                rotulo: 'Desenho aprovado',
                ponto: x.desenho.aprovadoEm ? ('cheio' as const) : ('vazio' as const),
                detalhe: x.desenho.aprovadoEm ? diaEMes(x.desenho.aprovadoEm) : null,
                links: [],
              },
            ]
          : []),
        {
          rotulo: 'Plano da parte',
          ponto: p.estado === 'planejando' ? 'andando' : 'cheio',
          detalhe: null,
          links: link('plano', x.planos[p.chave]),
        },
        {
          rotulo: 'PRs mergeados',
          ponto: COM_PRS.has(p.estado) ? 'cheio' : p.estado === 'em_curso' ? 'andando' : 'vazio',
          detalhe: abertos > 0 ? `${abertos} aberto${abertos > 1 ? 's' : ''}` : null,
          links: p.prs.flatMap((pr) => link(`#${pr.numero}`, pr.url)),
        },
        passoDaPublicacao(p, x),
      ],
    }
  })
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
  entrega_parcial: 'Entregar o que funciona; o que faltou virou uma demanda nova',
  no_ar: 'No ar',
  migrada: 'Demanda migrada',
  partes_planejadas: 'Partes planejadas',
}

const TEXTO_DO_EVENTO_DA_PARTE: Record<string, (chave: string) => string> = {
  parte_planejada: (c) => `Parte ${c} planejada`,
  parte_feita: (c) => `Parte ${c} feita`,
  parte_conferida_pelo_paulo: (c) => `Parte ${c} conferida pelo Paulo`,
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
  const daParte = TEXTO_DO_EVENTO_DA_PARTE[tipo]
  if (daParte && typeof d.chave === 'string') return daParte(d.chave)
  if (tipo === 'retomada' && typeof d.resposta === 'string' && d.resposta.trim()) {
    const r = d.resposta.trim()
    const curta =
      r.length > LIMITE_DA_RESPOSTA_NO_HISTORICO
        ? `${r.slice(0, LIMITE_DA_RESPOSTA_NO_HISTORICO)}…`
        : r
    return `Retomada com resposta: ${curta}`
  }
  if (tipo === 'migrada' && typeof d.texto === 'string') return d.texto
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
  /** "Projeto Alfa · aberta há 1 d". */
  subtitulo: string
  /** Só na fechada: "✓ No ar · c5c01ba" (ou "✓ Entregue · …" nas antigas). */
  entrega: string | null
  trilho: PontoAteOAr[]
  etapaAtual: string
  faixa: FaixaDaEspera | null
  /** A faixa "Falta", com a ação "Conferi no ar" quando cabe e nenhuma outra ação está na tela. */
  falta: FaixaDoQueFalta | null
  /** "Ordem de publicação: back antes do front"; null com uma parte. */
  ordem: string | null
  partes: CartaoDaParte[]
  impacto: { quadros: QuadroDeImpacto[]; podeQuebrar: string[]; pilulas: string[] }
  /** Na fechada, o desenho aprovado; antes disso, a versão mais nova. */
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
