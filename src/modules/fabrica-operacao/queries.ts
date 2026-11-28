/** Leitura do estado do motor novo para a tela Operação. Só leitura; exige `desenvolvimento.ler`. */
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import type { EstadoDaEtapa } from './etapas'
import { montarPainel, type DadosDoPainel, type Painel } from './painel'

const DIA_MS = 24 * 60 * 60 * 1000

/** Início do dia em Brasília (UTC−3, sem horário de verão desde 2019). */
function inicioDoDia(agora: Date): Date {
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000)
  brasilia.setUTCHours(0, 0, 0, 0)
  return new Date(brasilia.getTime() + 3 * 60 * 60 * 1000)
}

export async function obterPainelDeOperacao(sujeito: Sujeito, agora: Date): Promise<Painel> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')

  const [demandas, workers, noAr] = await Promise.all([
    db.demanda.findMany({
      where: { motor: 'v2', encerrada: null },
      orderBy: { criadaEm: 'asc' },
      select: {
        id: true,
        titulo: true,
        projeto: { select: { nome: true } },
        planoOperacional: {
          select: {
            revisoes: {
              where: { aprovadaEm: { not: null } },
              orderBy: { numero: 'desc' },
              take: 1,
              select: {
                etapas: {
                  orderBy: [{ criadaEm: 'asc' }, { chave: 'asc' }],
                  select: {
                    chave: true,
                    papel: true,
                    estado: true,
                    motivo: true,
                    proximaTentativaEm: true,
                    execucoes: {
                      where: { encerradaEm: null },
                      select: { iniciadaEm: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    db.workerDaFabrica.findMany({
      where: { revogadoEm: null },
      orderBy: { nome: 'asc' },
      select: {
        nome: true,
        ultimoSinalEm: true,
        execucoes: {
          where: { encerradaEm: null },
          take: 1,
          select: {
            etapa: {
              select: {
                chave: true,
                revisao: {
                  select: { plano: { select: { demanda: { select: { titulo: true } } } } },
                },
              },
            },
          },
        },
      },
    }),
    db.demanda.findMany({
      where: {
        motor: 'v2',
        noArEm: { gte: inicioDoDia(agora), lt: new Date(inicioDoDia(agora).getTime() + DIA_MS) },
      },
      orderBy: { noArEm: 'asc' },
      select: { titulo: true },
    }),
  ])

  const dados: DadosDoPainel = {
    demandas: demandas.map((d) => ({
      id: d.id,
      titulo: d.titulo,
      projeto: d.projeto.nome,
      etapas: (d.planoOperacional?.revisoes[0]?.etapas ?? []).map((e) => ({
        chave: e.chave,
        papel: e.papel,
        estado: e.estado as EstadoDaEtapa,
        motivo: e.motivo,
        proximaTentativaEm: e.proximaTentativaEm,
        execucaoDesde: e.execucoes[0]?.iniciadaEm ?? null,
      })),
    })),
    maquinas: workers.map((w) => {
      const ex = w.execucoes[0]
      return {
        nome: w.nome,
        ultimoSinalEm: w.ultimoSinalEm,
        tarefa: ex ? `${ex.etapa.chave} · ${ex.etapa.revisao.plano.demanda.titulo}` : null,
      }
    }),
    noArHoje: noAr,
  }
  return montarPainel(dados, agora)
}
