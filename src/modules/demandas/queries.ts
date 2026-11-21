import type { EstadoDoPedido } from '@/modules/fila-de-publicacao/model'
import { estadoNoFio } from '@/modules/fila-de-publicacao/contrato'
import { HORA_DO_LOTE_PADRAO } from '@/modules/fila-de-publicacao/model'
import { autorizar, exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { moduloAtivo } from '@/lib/modulos'
import { obterRetratoMaisRecente } from '@/modules/fabrica/queries'
import { esperasDasDemandas, type ItemDeEspera } from '@/modules/inicio/model'
import {
  ROTULO_DO_DESTINO,
  ROTULO_DO_NIVEL,
  avisosDoImpacto,
  cabecalhoDaEntrega,
  chipDeAbertura,
  chipDoPr,
  ehDeHoje,
  faixaDaEspera,
  fluxoDeEntrada,
  iconeDoTipo,
  linkDoArtefato,
  montarGrupos,
  quadrosDeImpacto,
  quemFez,
  textoDoEvento,
  trilho,
  avisoDeFabricaSemBuscar,
  type DemandaNaLista,
  type PaginaDaDemanda,
  type TelaDeDemandas,
  type TriagemDaDemanda,
} from './apresentacao'
import { cabecalhosDoArquivo, lerArquivo } from './arquivos'
import {
  etapasAplicaveis,
  type Destino,
  type EtapaDefinida,
  type Espera,
  type Nivel,
  type Origem,
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

/** A tela Demandas: o fluxo de entrada de hoje, os três grupos e o aviso da Fábrica parada. */
export async function obterListaDeDemandas(
  sujeito: Sujeito,
  filtro: Destino | null,
  agora: Date,
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
    projeto: { select: { nome: true } },
  } as const
  const umDiaEMeio = new Date(agora.getTime() - 1.5 * DIA_MS)
  const [abertas, orientadas, recentes, decidindo, config, retrato, recebidas, fonte] =
    await Promise.all([
      db.demanda.findMany({
        where: {
          ...ativo,
          encerrada: null,
          ...(filtro ? { destino: filtro.toUpperCase() as Uppercase<Destino> } : {}),
        },
        select: selecao,
      }),
      // Só com o filtro "orientada": as encerradas como orientadas, com teto; o corte do dia é `ehDeHoje`.
      filtro === 'orientada'
        ? db.demanda.findMany({
            where: { ...ativo, encerrada: 'orientada', atualizadaEm: { gte: umDiaEMeio } },
            orderBy: { atualizadaEm: 'desc' },
            take: LIMITE_DE_ORIENTADAS,
            select: selecao,
          })
        : null,
      // Um dia e meio para trás cobre o começo do dia em São Paulo; o corte exato é `ehDeHoje`.
      db.demanda.findMany({
        where: { ...ativo, criadaEm: { gte: umDiaEMeio } },
        select: { origem: true, destino: true, encerrada: true, criadaEm: true },
      }),
      db.demanda.findMany({
        where: { ...ativo, encerrada: null, espera: 'decidir_destino' },
        select: { esperaDesde: true, atualizadaEm: true },
      }),
      db.configuracaoDePublicacao.findFirst({
        orderBy: { horaDoLote: 'asc' },
        select: { horaDoLote: true },
      }),
      obterRetratoMaisRecente(sujeito).catch(() => null),
      db.demanda.aggregate({
        where: { ...ativo, encerrada: null, etapaAtual: 'recebida' },
        _count: true,
        _min: { criadaEm: true },
      }),
      db.fonteDaFabrica.aggregate({
        where: { revogadaEm: null },
        _max: { demandasBuscadasEm: true },
      }),
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
  })

  const vagas = retrato?.retrato.vagas
  return {
    quadros: fluxoDeEntrada({
      hoje: recentes
        .filter((d) => ehDeHoje(d.criadaEm, agora))
        .map((d) => ({
          origem: minusculo<Origem>(d.origem),
          destino: d.destino ? minusculo<Destino>(d.destino) : null,
          encerrada: d.encerrada,
        })),
      decidindo: decidindo.map((d) => ({ esperaDesde: d.esperaDesde ?? d.atualizadaEm })),
      horaDoLote: config?.horaDoLote ?? HORA_DO_LOTE_PADRAO,
      vagas: vagas ? { ocupadas: vagas.ocupadas, efetivas: vagas.efetivas } : null,
      agora,
    }),
    grupos: montarGrupos(
      abertas.map(naLista),
      agora,
      orientadas && orientadas.filter((d) => ehDeHoje(d.atualizadaEm, agora)).map(naLista),
    ),
    fabricaSemBuscar: avisoDeFabricaSemBuscar(
      {
        buscouEm: fonte._max.demandasBuscadasEm,
        recebidasParadas: recebidas._count,
        recebidaMaisAntigaDesde: recebidas._min.criadaEm,
      },
      agora,
    ),
    podeCriar: autorizar(sujeito, 'projetos.gerenciar'),
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
  const entregue = d.encerrada === 'entregue'
  const nivel = minusculo<Nivel>(d.nivel)
  const destino = d.destino ? minusculo<Destino>(d.destino) : null
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

  const versaoMostrada = entregue ? (d.desenhoAprovado ?? d.versaoDoDesenho) : d.versaoDoDesenho
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
  const chips = entregue
    ? [
        d.projeto.nome,
        ROTULO_DO_NIVEL[nivel],
        chipDoPr(d.prs),
        publicacao?.estado === 'publicado' && publicacao.commit
          ? `publicado ${publicacao.commit.slice(0, 7)}`
          : null,
      ]
    : [
        d.projeto.nome,
        ROTULO_DO_NIVEL[nivel],
        destino ? ROTULO_DO_DESTINO[destino] : null,
        chipDeAbertura(minusculo<Origem>(d.origem), d.criadaEm, agora),
      ]

  return {
    id: d.id,
    titulo: d.titulo,
    icone: iconeDoTipo(naLista.tipo),
    chips: chips.filter((c): c is string => c !== null),
    entrega: entregue ? cabecalhoDaEntrega(publicacao, agora) : null,
    trilho: trilho(etapasAplicaveis(etapas, d.temTela), naLista),
    etapaAtual: d.etapaAtual,
    faixa: d.encerrada
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
        ),
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
