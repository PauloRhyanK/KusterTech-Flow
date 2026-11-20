import type { EstadoDoPedido } from '@/modules/fila-de-publicacao/model'
import { estadoNoFio } from '@/modules/fila-de-publicacao/contrato'
import { HORA_DO_LOTE_PADRAO } from '@/modules/fila-de-publicacao/model'
import { autorizar, exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { obterRetratoMaisRecente } from '@/modules/fabrica/queries'
import { esperasDasDemandas, type ItemDeEspera } from '@/modules/inicio/model'
import {
  avisoDeFabricaSemBuscar,
  ehDeHoje,
  fluxoDeEntrada,
  montarGrupos,
  type DemandaNaLista,
  type TelaDeDemandas,
} from './apresentacao'
import type { Destino, EtapaDefinida, Espera, Origem, TipoDeDemanda } from './model'

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

/** A tela Demandas: o fluxo de entrada de hoje, os três grupos e o aviso da Fábrica parada. */
export async function obterListaDeDemandas(
  sujeito: Sujeito,
  filtro: Destino | null,
  agora: Date,
): Promise<TelaDeDemandas> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  const ativo = { projeto: { arquivadoEm: null } }
  const [abertas, recentes, decidindo, config, retrato, recebidas, fonte] = await Promise.all([
    db.demanda.findMany({
      where: {
        ...ativo,
        encerrada: null,
        ...(filtro ? { destino: filtro.toUpperCase() as Uppercase<Destino> } : {}),
      },
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
    }),
    // Um dia e meio para trás cobre o começo do dia em São Paulo; o corte exato é `ehDeHoje`.
    db.demanda.findMany({
      where: { ...ativo, criadaEm: { gte: new Date(agora.getTime() - 1.5 * DIA_MS) } },
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

  const demandas: DemandaNaLista[] = abertas.map((d) => ({
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
  }))

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
    grupos: montarGrupos(demandas, agora),
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
