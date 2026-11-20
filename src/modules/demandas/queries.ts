import type { EstadoDoPedido } from '@/modules/fila-de-publicacao/model'
import { estadoNoFio } from '@/modules/fila-de-publicacao/contrato'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { esperasDasDemandas, type ItemDeEspera } from '@/modules/inicio/model'
import type { EtapaDefinida, Espera } from './model'

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
