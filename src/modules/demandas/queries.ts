import type { EstadoDoPedido } from '@/modules/fila-de-publicacao/model'
import { estadoNoFio } from '@/modules/fila-de-publicacao/contrato'
import { autorizar, exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { moduloAtivo } from '@/lib/modulos'
import { esperasDasDemandas, formatarIdade, type ItemDeEspera } from '@/modules/inicio/model'
import {
  avisosDoImpacto,
  cabecalhoDaEntrega,
  cartoesDasPartes,
  ehDeHoje,
  faixaDaEspera,
  faixaDoQueFalta,
  linkDoArtefato,
  montarGrupos,
  quadrosAteOAr,
  quadrosDeImpacto,
  quemFez,
  textoDaOrdem,
  textoDoEvento,
  trilhoDaDemanda,
  avisoDeFabricaSemBuscar,
  demandasQueVemAi,
  linhaDaTabela,
  ordenarPorEstado,
  type DemandaNaLista,
  type DemandaNaTabela,
  type OpcaoDeFiltro,
  type TabelaDeDemandas,
  type DemandaQueVemAi,
  type PaginaDaDemanda,
  type TelaDeDemandas,
  type ExtrasDasPartes,
  type TriagemDaDemanda,
} from './apresentacao'
import { fraseDaDemanda, grupoAteOAr } from './partes'
import { comoParte } from './partes-service'
import { cabecalhosDoArquivo, lerArquivo } from './arquivos'
import {
  type Destino,
  type EstadoDaTabela,
  type EtapaDefinida,
  type FiltrosDaTabela,
  type Espera,
  type Nivel,
  type TipoDeDemanda,
} from './model'

export type PublicacaoDaDemanda = {
  estado: EstadoDoPedido
  commit: string | null
  noArDesde: Date | null
}

/** O pedido mais novo ligado à demanda; um pedido dispensado vale o do atendente. */
export async function publicacaoDaDemanda(demandaId: string): Promise<PublicacaoDaDemanda | null> {
  const pedido = await db.pedidoDePublicacao.findFirst({
    where: { demandaId },
    orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
    select: {
      estado: true,
      commit: true,
      concluidoEm: true,
      atendidoPorId: true,
    },
  })
  if (!pedido) return null
  const efetivo = pedido.atendidoPorId
    ? ((await db.pedidoDePublicacao.findUnique({
        where: { id: pedido.atendidoPorId },
        select: { estado: true, commit: true, concluidoEm: true },
      })) ?? pedido)
    : pedido
  return {
    estado: estadoNoFio(efetivo.estado),
    commit: efetivo.commit,
    noArDesde: efetivo.estado === 'PUBLICADO' ? efetivo.concluidoEm : null,
  }
}

/** As demandas que esperam o Paulo, para o "Espera você" do Início: duas consultas, não uma por demanda. */
export async function esperasDeDemandas(sujeito: Sujeito, agora: Date): Promise<ItemDeEspera[]> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  const [demandas, recebidas, fonte] = await Promise.all([
    db.demanda.findMany({
      where: { encerrada: null, espera: { not: null }, projeto: { arquivadoEm: null } },
      select: {
        id: true,
        titulo: true,
        espera: true,
        esperaMotivo: true,
        esperaDesde: true,
        atualizadaEm: true,
        etapaAtual: true,
        etapas: true,
        projeto: { select: { nome: true } },
      },
    }),
    db.demanda.aggregate({
      where: { encerrada: null, etapaAtual: 'recebida', projeto: { arquivadoEm: null } },
      _count: true,
      _min: { criadaEm: true },
    }),
    db.fonteDaFabrica.aggregate({
      where: { revogadaEm: null },
      _max: { demandasBuscadasEm: true },
    }),
  ])
  return esperasDasDemandas(
    demandas.map((d) => ({
      id: d.id,
      titulo: d.titulo,
      projeto: d.projeto.nome,
      espera: d.espera as Espera,
      esperaMotivo: d.esperaMotivo,
      esperaDesde: d.esperaDesde ?? d.atualizadaEm,
      rotuloDaEtapa:
        (d.etapas as unknown as EtapaDefinida[]).find((e) => e.chave === d.etapaAtual)?.rotulo ??
        d.etapaAtual,
    })),
    {
      buscouEm: fonte._max.demandasBuscadasEm,
      recebidasParadas: recebidas._count,
      recebidaMaisAntigaDesde: recebidas._min.criadaEm,
    },
    agora,
  )
}

const minusculo = <T extends string>(v: string) => v.toLowerCase() as T
const DIA_MS = 24 * 60 * 60_000
const LIMITE_DE_ORIENTADAS = 200

const COM_AS_PARTES = {
  partes: { include: { repositorio: { select: { nomeCompleto: true } } } },
} as const

/**
 * A tela Demandas (spec "demanda até o ar", 5.3): os quatro números e os grupos — as abertas e as
 * que fecharam no ar nos últimos 30 dias. As encerradas como `entregue` antes das partes ficam
 * de fora até a migração (Task 9) levá-las ao `no_ar`.
 */
export async function obterListaDeDemandas(
  sujeito: Sujeito,
  filtro: Destino | null,
  agora: Date,
  /** Com filtros de tabela: além dos grupos, a tabela filtrada e ordenada. */
  tabela: FiltrosDaTabela | null = null,
): Promise<TelaDeDemandas> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  const ativo = { projeto: { arquivadoEm: null } }
  const selecao = {
    id: true,
    titulo: true,
    tipo: true,
    etapas: true,
    temTela: true,
    etapaAtual: true,
    concluidas: true,
    espera: true,
    encerrada: true,
    destino: true,
    criadaEm: true,
    esperaDesde: true,
    atualizadaEm: true,
    naoChegouDesde: true,
    noArEm: true,
    desenhoAprovado: true,
    projeto: { select: { nome: true } },
    ...COM_AS_PARTES,
  } as const
  const umDiaEMeio = new Date(agora.getTime() - 1.5 * DIA_MS)
  const trintaDias = new Date(agora.getTime() - 30 * DIA_MS)
  const [abertas, noAr, orientadas, recebidas, fonte, opcoes, daTabela] = await Promise.all([
    db.demanda.findMany({ where: { ...ativo, encerrada: null }, select: selecao }),
    db.demanda.findMany({
      where: { ...ativo, encerrada: 'no_ar', noArEm: { gte: trintaDias } },
      select: selecao,
    }),
    // As encerradas como orientadas, com teto; o corte do dia é `ehDeHoje`.
    db.demanda.findMany({
      where: { ...ativo, encerrada: 'orientada', atualizadaEm: { gte: umDiaEMeio } },
      orderBy: { atualizadaEm: 'desc' },
      take: LIMITE_DE_ORIENTADAS,
      select: selecao,
    }),
    db.demanda.aggregate({
      where: { ...ativo, encerrada: null, etapaAtual: 'recebida' },
      _count: true,
      _min: { criadaEm: true },
    }),
    db.fonteDaFabrica.aggregate({
      where: { revogadaEm: null },
      _max: { demandasBuscadasEm: true },
    }),
    opcoesDosFiltros(),
    tabela
      ? db.demanda.findMany({
          where: { ...ativo, ...ondeDaTabela(tabela, agora) },
          orderBy: ordemDaTabela(tabela),
          take: LIMITE_DA_TABELA + 1,
          select: {
            ...selecao,
            repositorio: { select: { nomeCompleto: true } },
            projeto: {
              select: {
                nome: true,
                clientes: { select: { cliente: { select: { nome: true } } } },
              },
            },
          },
        })
      : null,
  ])

  const naLista = (d: (typeof abertas)[number]): DemandaNaLista => ({
    id: d.id,
    titulo: d.titulo,
    tipo: d.tipo ? minusculo<TipoDeDemanda>(d.tipo) : null,
    projeto: d.projeto.nome,
    etapas: d.etapas as unknown as EtapaDefinida[],
    temTela: d.temTela,
    etapaAtual: d.etapaAtual,
    concluidas: d.concluidas,
    espera: d.espera as Espera | null,
    encerrada: d.encerrada as DemandaNaLista['encerrada'],
    destino: d.destino ? minusculo<Destino>(d.destino) : null,
    criadaEm: d.criadaEm,
    esperaDesde: d.esperaDesde,
    atualizadaEm: d.atualizadaEm,
    partes: d.partes.map(comoParte),
    naoChegouDesde: d.naoChegouDesde,
    noArEm: d.noArEm,
    desenhoAprovado: d.desenhoAprovado,
  })

  const todas = [...abertas, ...noAr].map(naLista)
  const deHoje = orientadas.filter((d) => ehDeHoje(d.atualizadaEm, agora)).map(naLista)
  const semFiltro = montarGrupos(todas, agora)
  return {
    // Os números contam todas; o filtro só muda a lista.
    quadros: quadrosAteOAr(todas, agora),
    grupos: filtro
      ? montarGrupos(
          todas.filter((d) => d.destino === filtro),
          agora,
          filtro === 'orientada' ? deHoje : null,
        )
      : semFiltro,
    orientadasHoje: deHoje.length,
    fabricaSemBuscar: avisoDeFabricaSemBuscar(
      {
        buscouEm: fonte._max.demandasBuscadasEm,
        recebidasParadas: recebidas._count,
        recebidaMaisAntigaDesde: recebidas._min.criadaEm,
      },
      agora,
    ),
    podeCriar: autorizar(sujeito, 'projetos.gerenciar'),
    opcoes,
    tabela: daTabela && tabela ? montarTabela(daTabela, tabela, agora) : null,
  }

  function montarTabela(
    linhas: NonNullable<typeof daTabela>,
    f: FiltrosDaTabela,
    quando: Date,
  ): TabelaDeDemandas {
    const visiveis = linhas.slice(0, LIMITE_DA_TABELA).map((d): DemandaNaTabela => ({
      ...naLista(d),
      clientes: d.projeto.clientes.map((c) => c.cliente.nome).sort((a, b) => a.localeCompare(b)),
      repositorios: [
        ...new Set([
          d.repositorio.nomeCompleto,
          ...d.partes.map((p) => p.repositorio.nomeCompleto),
        ]),
      ],
    }))
    const prontas = visiveis.map((d) => linhaDaTabela(d, quando))
    return {
      linhas: f.ordem === 'estado' ? ordenarPorEstado(prontas, f.sentido) : prontas,
      truncada: linhas.length > LIMITE_DA_TABELA,
    }
  }
}

const LIMITE_DA_TABELA = 200
const DIAS_DO_PERIODO = { '30d': 30, '90d': 90, tudo: null } as const

const ONDE_DO_ESTADO: Record<EstadoDaTabela, object> = {
  espera_voce: { encerrada: null, espera: { not: null } },
  nao_chegou: { encerrada: null, espera: null, naoChegouDesde: { not: null } },
  a_caminho: { encerrada: null, espera: null, naoChegouDesde: null },
  no_ar: { encerrada: 'no_ar' },
  encerrada: { encerrada: { in: ['orientada', 'descartada', 'entregue'] } },
}

/** O `where` da tabela: cada filtro escolhido vira uma condição; o período corta as encerradas pela última atualização. */
function ondeDaTabela(f: FiltrosDaTabela, agora: Date) {
  const dias = DIAS_DO_PERIODO[f.periodo]
  return {
    AND: [
      // O período corta só as encerradas: aberta parada há meses é justamente o que se procura.
      dias === null
        ? {}
        : {
            OR: [
              { encerrada: null },
              { atualizadaEm: { gte: new Date(agora.getTime() - dias * DIA_MS) } },
            ],
          },
      f.cliente ? { projeto: { clientes: { some: { clienteId: f.cliente } } } } : {},
      f.projeto ? { projetoId: f.projeto } : {},
      f.repositorio
        ? {
            OR: [
              { repositorioId: f.repositorio },
              { partes: { some: { repositorioId: f.repositorio } } },
            ],
          }
        : {},
      f.tipo ? { tipo: f.tipo.toUpperCase() as never } : {},
      f.destino ? { destino: f.destino.toUpperCase() as never } : {},
      f.texto ? { titulo: { contains: f.texto, mode: 'insensitive' as const } } : {},
      f.estado ? ONDE_DO_ESTADO[f.estado] : {},
    ],
  }
}

/** A ordem no banco; "estado" busca pelas mais recentes e reordena depois, em memória. */
function ordemDaTabela(f: FiltrosDaTabela) {
  const campo =
    f.ordem === 'demanda' ? 'titulo' : f.ordem === 'criada' ? 'criadaEm' : 'atualizadaEm'
  const sentido = f.ordem === 'estado' ? 'desc' : f.sentido
  return [{ [campo]: sentido }, { id: 'asc' as const }]
}

/** As opções dos seletores: clientes, projetos e repositórios ativos, por nome. */
async function opcoesDosFiltros(): Promise<TelaDeDemandas['opcoes']> {
  const [clientes, projetos, repositorios] = await Promise.all([
    db.cliente.findMany({
      where: { arquivadoEm: null },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true },
    }),
    db.projeto.findMany({
      where: { arquivadoEm: null },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true },
    }),
    db.repositorioGitHub.findMany({
      where: { projetoId: { not: null }, removidoDaInstalacaoEm: null },
      orderBy: { nomeCompleto: 'asc' },
      select: { id: true, nomeCompleto: true },
    }),
  ])
  const opcao = (valor: string, rotulo: string): OpcaoDeFiltro => ({ valor, rotulo })
  return {
    clientes: clientes.map((c) => opcao(c.id, c.nome)),
    projetos: projetos.map((p) => opcao(p.id, p.nome)),
    repositorios: repositorios.map((r) => opcao(r.id, r.nomeCompleto)),
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIMITE_DO_HISTORICO = 100

/** O último de cada tela entre as capturas vivas, desktop antes do celular. */
function capturasPorTela(
  capturas: readonly { id: string; tela: string | null; criadoEm: Date }[],
): PaginaDaDemanda['capturas'] {
  const telas = ['desktop', 'celular'] as const
  return telas.flatMap((tela) => {
    const ultima = capturas
      .filter((c) => c.tela === tela)
      .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())[0]
    return ultima ? [{ id: ultima.id, tela }] : []
  })
}

const CONSERTO_EM_CURSO = ['ABERTO', 'EM_CURSO', 'COM_PR'] as const

/** O que os passos das partes leem além da linha: o pedido corrente e o PR do conserto em curso. */
async function extrasDasPartes(
  partes: readonly {
    id: string
    chave: string
    planoPrUrl: string | null
    pedidoId: string | null
    conferidaPorId: string | null
  }[],
): Promise<Omit<ExtrasDasPartes, 'desenho'>> {
  const pedidoIds = partes.flatMap((p) => (p.pedidoId ? [p.pedidoId] : []))
  const [pedidos, consertos] = await Promise.all([
    pedidoIds.length > 0
      ? db.pedidoDePublicacao.findMany({
          where: { id: { in: pedidoIds } },
          select: { id: true, estado: true },
        })
      : [],
    partes.length > 0
      ? db.pedidoDeConserto.findMany({
          where: {
            parteId: { in: partes.map((p) => p.id) },
            estado: { in: [...CONSERTO_EM_CURSO] },
            prUrl: { not: null },
          },
          orderBy: { abertoEm: 'desc' },
          select: { parteId: true, prUrl: true },
        })
      : [],
  ])
  const extras: Omit<ExtrasDasPartes, 'desenho'> = {
    planos: {},
    consertos: {},
    pedidos: {},
    conferidas: {},
  }
  for (const p of partes) {
    if (p.planoPrUrl) extras.planos[p.chave] = p.planoPrUrl
    if (p.conferidaPorId) extras.conferidas[p.chave] = true
    const pedido = pedidos.find((x) => x.id === p.pedidoId)
    if (pedido) extras.pedidos[p.chave] = estadoNoFio(pedido.estado)
    const conserto = consertos.find((c) => c.parteId === p.id)
    if (conserto?.prUrl) extras.consertos[p.chave] = conserto.prUrl
  }
  return extras
}

/**
 * A página da demanda: cabeçalho, trilho, faixa do que espera o Paulo, impacto da triagem,
 * desenho, capturas e histórico. Demanda que não existe → null.
 */
export async function obterPaginaDaDemanda(
  sujeito: Sujeito,
  id: string,
  agora: Date,
): Promise<PaginaDaDemanda | null> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  if (!UUID.test(id)) return null
  const d = await db.demanda.findUnique({
    where: { id },
    include: {
      projeto: { select: { nome: true } },
      ...COM_AS_PARTES,
      arquivos: {
        where: { tipo: { in: ['DESENHO', 'CAPTURA'] } },
        select: {
          id: true,
          tipo: true,
          nome: true,
          conteudo: true,
          tela: true,
          versao: true,
          criadoEm: true,
          apagadoEm: true,
        },
      },
      eventos: {
        orderBy: { seq: 'desc' },
        take: LIMITE_DO_HISTORICO,
        select: { seq: true, tipo: true, origem: true, dados: true, em: true },
      },
    },
  })
  if (!d) return null

  const etapas = d.etapas as unknown as EtapaDefinida[]
  // `entregue` é a encerrada antes das partes; até a migração ela aparece como fechada.
  const entregue = d.encerrada === 'entregue'
  const fechada = entregue || d.encerrada === 'no_ar'
  const destino = d.destino ? minusculo<Destino>(d.destino) : null
  const partes = d.partes.map(comoParte)
  const naLista: DemandaNaLista = {
    id: d.id,
    titulo: d.titulo,
    tipo: d.tipo ? minusculo<TipoDeDemanda>(d.tipo) : null,
    projeto: d.projeto.nome,
    etapas,
    temTela: d.temTela,
    etapaAtual: d.etapaAtual,
    concluidas: d.concluidas,
    espera: d.espera as Espera | null,
    encerrada: d.encerrada as DemandaNaLista['encerrada'],
    destino,
    criadaEm: d.criadaEm,
    esperaDesde: d.esperaDesde,
    atualizadaEm: d.atualizadaEm,
    partes,
    naoChegouDesde: d.naoChegouDesde,
    noArEm: d.noArEm,
    desenhoAprovado: d.desenhoAprovado,
  }

  // O último ajuste vem do histórico inteiro, não só da página dele.
  const ajuste =
    d.espera === 'aprovar_desenho'
      ? await db.eventoDaDemanda.findFirst({
          where: { demandaId: d.id, tipo: 'ajuste_pedido' },
          orderBy: { seq: 'desc' },
          select: { dados: true, em: true },
        })
      : null
  const textoDoAjuste = (ajuste?.dados as { texto?: unknown } | undefined)?.texto

  // A aprovação do desenho, do histórico inteiro, para o passo "Desenho aprovado" da parte da tela.
  const aprovacao =
    d.temTela && d.desenhoAprovado !== null
      ? await db.eventoDaDemanda.findFirst({
          where: { demandaId: d.id, tipo: 'desenho_aprovado' },
          orderBy: { seq: 'desc' },
          select: { em: true },
        })
      : null
  // A parte da tela é a de entrada (a do repositório da demanda, a primeira criada).
  const entrada = d.partes
    .filter((p) => p.repositorioId === d.repositorioId && p.estado !== 'DESCARTADA')
    .sort((a, b) => a.criadaEm.getTime() - b.criadaEm.getTime())[0]

  // O PR da trava vem do último `travada`, também do histórico inteiro.
  const trava =
    d.espera === 'travada'
      ? await db.eventoDaDemanda.findFirst({
          where: { demandaId: d.id, tipo: 'travada' },
          orderBy: { seq: 'desc' },
          select: { dados: true },
        })
      : null
  const urlDaTrava = (trava?.dados as { url?: unknown } | undefined)?.url

  const publicacao =
    entregue && moduloAtivo('fila-de-publicacao') ? await publicacaoDaDemanda(d.id) : null

  const versaoMostrada = fechada ? (d.desenhoAprovado ?? d.versaoDoDesenho) : d.versaoDoDesenho
  const desenho = d.arquivos.find(
    (a) => a.tipo === 'DESENHO' && a.apagadoEm === null && a.versao === versaoMostrada,
  )
  const capturas = d.arquivos.filter((a) => a.tipo === 'CAPTURA')
  const vivas = capturas.filter((c) => c.apagadoEm === null)
  const apagadasEm = capturas.reduce<Date | null>(
    (max, c) => (c.apagadoEm && (!max || c.apagadoEm > max) ? c.apagadoEm : max),
    null,
  )

  const triagem = d.triagem as unknown as TriagemDaDemanda | null
  const podeAgir = autorizar(sujeito, 'projetos.gerenciar')
  const faixa = d.encerrada
    ? null
    : faixaDaEspera(
        {
          id: d.id,
          espera: naLista.espera,
          esperaMotivo: d.esperaMotivo,
          versaoDoDesenho: d.versaoDoDesenho,
          ultimoAjuste:
            ajuste && typeof textoDoAjuste === 'string'
              ? { texto: textoDoAjuste, em: ajuste.em }
              : null,
          urlDaTrava: typeof urlDaTrava === 'string' ? urlDaTrava : null,
          etapaAtual: d.etapaAtual,
          etapas,
        },
        agora,
      )
  // A faixa "Falta" vale para a demanda aberta com parte que não chegou, mesmo esperando o Paulo;
  // "Conferi no ar" só aparece quando a faixa da espera não tem ação (uma ação principal só).
  const falta = faixaDoQueFalta({
    grupo: d.encerrada === null && d.naoChegouDesde ? 'nao_chegou' : grupoAteOAr(naLista, agora),
    partes,
    podeConferir: podeAgir && (faixa === null || faixa.acoes.length === 0),
  })

  return {
    id: d.id,
    titulo: d.titulo,
    subtitulo: fechada
      ? d.projeto.nome
      : `${d.projeto.nome} · aberta ${formatarIdade(d.criadaEm, agora)}`,
    entrega: entregue
      ? cabecalhoDaEntrega(publicacao, agora)
      : d.encerrada === 'no_ar'
        ? `✓ ${partes.length > 0 ? fraseDaDemanda(partes).texto : 'No ar'}`
        : null,
    trilho: trilhoDaDemanda(naLista),
    etapaAtual: d.etapaAtual,
    faixa,
    falta,
    ordem: textoDaOrdem(partes),
    partes: cartoesDasPartes(partes, {
      ...(await extrasDasPartes(d.partes)),
      desenho:
        d.temTela && entrada ? { chave: entrada.chave, aprovadoEm: aprovacao?.em ?? null } : null,
    }),
    impacto: { quadros: quadrosDeImpacto(triagem), ...avisosDoImpacto(triagem) },
    desenho: desenho
      ? {
          arquivoId: desenho.id,
          versao: versaoMostrada,
          nome: desenho.nome,
          ehHtml: desenho.conteudo.split(';')[0]?.trim().toLowerCase() === 'text/html',
        }
      : null,
    artefatoUrl: linkDoArtefato(d.artefatoUrl),
    capturas: capturasPorTela(vivas),
    capturasApagadasEm: vivas.length === 0 ? apagadasEm : null,
    temTela: d.temTela,
    historico: d.eventos.map((e) => ({
      id: String(e.seq),
      evento: textoDoEvento(e.tipo, e.dados),
      quem: quemFez(e.origem),
      quando: e.em,
    })),
    podeAgir,
    descartada: d.encerrada === 'descartada',
    podeEncerrar: podeAgir && d.encerrada === null,
  }
}

/**
 * Um arquivo da demanda para a rota de exibição: só da própria demanda e não apagado; o corpo
 * vai em fluxo e os cabeçalhos são os de `cabecalhosDoArquivo` (CSP sandbox no HTML).
 */
export async function obterArquivoParaExibir(
  sujeito: Sujeito,
  demandaId: string,
  arquivoId: string,
): Promise<{ corpo: ReadableStream<Uint8Array>; cabecalhos: Record<string, string> } | null> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  if (!UUID.test(demandaId) || !UUID.test(arquivoId)) return null
  const a = await db.arquivoDaDemanda.findFirst({
    where: { id: arquivoId, demandaId, apagadoEm: null },
    select: { nome: true, conteudo: true },
  })
  if (!a) return null
  const corpo = await lerArquivo(demandaId, arquivoId)
  if (!corpo) return null
  return { corpo, cabecalhos: cabecalhosDoArquivo(a.conteudo, a.nome) }
}

export interface FormularioDeDemanda {
  projetos: {
    id: string
    nome: string
    nivelPadrao: Nivel
    repositorios: { id: string; nomeCompleto: string }[]
  }[]
}

/** O que o formulário "Nova demanda" oferece: projetos ativos com repositório, e o nível padrão de cada um. */
export async function obterFormularioDeDemanda(sujeito: Sujeito): Promise<FormularioDeDemanda> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  const projetos = await db.projeto.findMany({
    where: { arquivadoEm: null, repositorios: { some: { removidoDaInstalacaoEm: null } } },
    orderBy: { nome: 'asc' },
    select: {
      id: true,
      nome: true,
      nivelPadraoDeDemanda: true,
      repositorios: {
        where: { removidoDaInstalacaoEm: null },
        orderBy: { nomeCompleto: 'asc' },
        select: { id: true, nomeCompleto: true },
      },
    },
  })
  return {
    projetos: projetos.map((p) => ({
      id: p.id,
      nome: p.nome,
      nivelPadrao: minusculo<Nivel>(p.nivelPadraoDeDemanda),
      repositorios: p.repositorios,
    })),
  }
}

export interface DemandasDoProjeto {
  modeloId: string
  nivelPadrao: Nivel
  modelos: { id: string; nome: string; etapas: { chave: string; rotulo: string }[] }[]
}

/** Os modelos de etapas e o que o projeto usa (o padrão quando não escolheu). */
export async function obterDemandasDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
): Promise<DemandasDoProjeto> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  const projeto = await db.projeto.findUnique({
    where: { id: projetoId },
    select: { modeloDeEtapasId: true, nivelPadraoDeDemanda: true },
  })
  if (!projeto) throw new ErroDeDominio('Projeto não encontrado.')
  const modelos = await db.modeloDeEtapas.findMany({
    orderBy: [{ padrao: 'desc' }, { nome: 'asc' }],
    select: {
      id: true,
      nome: true,
      padrao: true,
      etapas: { orderBy: { ordem: 'asc' }, select: { chave: true, rotulo: true } },
    },
  })
  const atual =
    modelos.find((m) => m.id === projeto.modeloDeEtapasId) ?? modelos.find((m) => m.padrao)
  return {
    modeloId: atual?.id ?? '',
    nivelPadrao: minusculo<Nivel>(projeto.nivelPadraoDeDemanda),
    modelos: modelos.map(({ id, nome, etapas }) => ({ id, nome, etapas })),
  }
}

/** As demandas abertas que a Fábrica ainda está fazendo, para a tela Publicação. */
export async function obterDemandasQueVemAi(sujeito: Sujeito): Promise<DemandaQueVemAi[]> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  const abertas = await db.demanda.findMany({
    where: { encerrada: null, projeto: { arquivadoEm: null } },
    select: {
      id: true,
      titulo: true,
      tipo: true,
      etapas: true,
      temTela: true,
      etapaAtual: true,
      concluidas: true,
      espera: true,
      encerrada: true,
      destino: true,
      criadaEm: true,
      esperaDesde: true,
      atualizadaEm: true,
      projeto: { select: { nome: true } },
    },
  })
  return demandasQueVemAi(
    abertas.map((d) => ({
      id: d.id,
      titulo: d.titulo,
      tipo: d.tipo ? minusculo<TipoDeDemanda>(d.tipo) : null,
      projeto: d.projeto.nome,
      etapas: d.etapas as unknown as EtapaDefinida[],
      temTela: d.temTela,
      etapaAtual: d.etapaAtual,
      concluidas: d.concluidas,
      espera: d.espera as Espera | null,
      encerrada: null,
      destino: d.destino ? minusculo<Destino>(d.destino) : null,
      criadaEm: d.criadaEm,
      esperaDesde: d.esperaDesde,
      atualizadaEm: d.atualizadaEm,
      partes: [],
      naoChegouDesde: null,
      noArEm: null,
      desenhoAprovado: null,
    })),
  )
}
