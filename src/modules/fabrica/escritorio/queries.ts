// Dados da tela do escritório da Fábrica: retrato, demandas abertas, títulos das seeds, histórico e gestão.
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { type EtapaDefinida, inicioDaEspera } from '@/modules/demandas/model'
import { obterRetratoMaisRecente, type RetratoRecebido } from '../queries'
import { type DadosDaGestao, montarGestao } from './gestao'
import { gastoPorPlano, lerHistorico, lerLinhasDosPlanos } from './intervalos'
import { type DemandaDaTela, type Escritorio, montarEscritorio } from './model'

export interface DadosDoEscritorio {
  escritorio: Escritorio
  gestao: Record<string, DadosDaGestao>
  recebido: RetratoRecebido | null
}

const minutos = (de: Date, ate: Date) =>
  Math.max(0, Math.round((ate.getTime() - de.getTime()) / 60_000))

export async function obterEscritorio(sujeito: Sujeito, agora: Date): Promise<DadosDoEscritorio> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')

  const recebido = await obterRetratoMaisRecente(sujeito)
  const linhas = await db.demanda.findMany({
    where: { encerrada: null },
    select: {
      id: true,
      titulo: true,
      etapas: true,
      etapaAtual: true,
      espera: true,
      esperaDesde: true,
      atualizadaEm: true,
      criadaEm: true,
      repositorio: { select: { nomeCompleto: true } },
      projeto: { select: { nome: true } },
    },
  })
  const demandas: DemandaDaTela[] = linhas.map((d) => ({
    id: d.id,
    titulo: d.titulo,
    repositorio: d.repositorio.nomeCompleto,
    projeto: d.projeto.nome,
    marco:
      (d.etapas as unknown as EtapaDefinida[]).find((e) => e.chave === d.etapaAtual)?.marco ?? null,
    espera: d.espera,
    esperaDesde: inicioDaEspera(d),
  }))

  const retrato = recebido?.retrato
  const seedIds = (retrato?.planos ?? [])
    .flatMap((p) => p.fases.flatMap((f) => f.raias.map((r) => r.seedId)))
    .filter((s): s is string => s !== null)
  const seeds =
    seedIds.length === 0
      ? []
      : await db.seedDoRepositorio.findMany({
          where: { seedId: { in: seedIds } },
          select: { seedId: true, titulo: true },
        })
  const titulos = Object.fromEntries(seeds.map((s) => [s.seedId, s.titulo]))

  const linhasDoHistorico = await lerLinhasDosPlanos((retrato?.planos ?? []).map((p) => p.id))
  const escritorio = montarEscritorio(
    { recebido, demandas, titulos, historico: linhasDoHistorico },
    agora,
  )
  const gestao: Record<string, DadosDaGestao> = {}
  if (retrato && escritorio.andares.length > 0) {
    const historico = await lerHistorico()
    const gastos = await gastoPorPlano()
    const idsDasDemandas = escritorio.andares
      .map((a) => a.demandaId)
      .filter((d): d is string => d !== null)
    const eventos =
      idsDasDemandas.length === 0
        ? []
        : await db.eventoDaDemanda.findMany({
            where: { demandaId: { in: idsDasDemandas }, tipo: 'etapa_concluida' },
            orderBy: { em: 'asc' },
            select: { demandaId: true, dados: true, em: true },
          })
    const criadaEm = new Map(linhas.map((d) => [d.id, d.criadaEm]))
    for (const andar of escritorio.andares) {
      const plano = retrato.planos.find((p) => p.id === andar.planoId)
      if (!plano) continue
      let anterior = andar.demandaId ? criadaEm.get(andar.demandaId) : undefined
      const etapasDaDemanda = eventos
        .filter((ev) => ev.demandaId === andar.demandaId)
        .map((ev) => {
          const marco = (ev.dados as { marco?: unknown } | null)?.marco
          const realMin = anterior ? minutos(anterior, ev.em) : null
          anterior = ev.em
          return { etapa: typeof marco === 'string' ? marco : 'etapa', realMin }
        })
      gestao[andar.planoId] = montarGestao({
        andar,
        plano,
        retrato,
        historico,
        etapasDaDemanda,
        agora,
        gastoRegistrado: gastos[plano.id],
      })
    }
  }
  return { escritorio, gestao, recebido }
}
