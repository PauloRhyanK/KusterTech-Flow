// Leitura do quadro "Erros no ar" para a página Fábrica.
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import type { EtapaDefinida } from '@/modules/demandas/model'
import { montarQuadro, type QuadroDeErros } from './apresentacao'
import { lerConfiguracao, type Ponto } from './model'

const SETE_DIAS_MS = 7 * 24 * 60 * 60_000
const LIMITE_DE_ERROS = 200

export async function obterQuadroDeErros(
  sujeito: Sujeito,
  agora: Date,
  env: Record<string, string | undefined> = process.env,
): Promise<QuadroDeErros> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  const lida = lerConfiguracao(env)
  const slugs = lida.ok ? lida.config.projetos.map((p) => p.slug) : []
  if (slugs.length === 0) {
    return montarQuadro({ configurado: false, erros: [], leituras: [], slugs }, agora)
  }

  const [erros, leituras] = await Promise.all([
    db.erroDoGlitchTip.findMany({
      where: {
        projetoGlitchTip: { in: slugs },
        OR: [
          { resolvidoEm: null },
          { demanda: { noArEm: { gte: new Date(agora.getTime() - SETE_DIAS_MS) } } },
        ],
      },
      select: {
        issueId: true,
        projetoGlitchTip: true,
        titulo: true,
        onde: true,
        nivel: true,
        link: true,
        eventos: true,
        usuarios: true,
        primeiroEm: true,
        ultimoEm: true,
        resolvidoEm: true,
        esperaDesde: true,
        demandaId: true,
        demandaAnteriorId: true,
        serie: true,
        demanda: {
          select: { encerrada: true, noArEm: true, etapaAtual: true, etapas: true, prs: true },
        },
      },
      orderBy: { ultimoEm: 'desc' },
      take: LIMITE_DE_ERROS,
    }),
    db.leituraDoGlitchTip.findMany({ where: { projetoGlitchTip: { in: slugs } } }),
  ])

  return montarQuadro(
    {
      configurado: true,
      slugs,
      leituras,
      erros: erros.map((e) => ({
        ...e,
        serie: e.serie as unknown as Ponto[],
        demanda: e.demanda && {
          ...e.demanda,
          etapas: e.demanda.etapas as unknown as EtapaDefinida[],
        },
      })),
    },
    agora,
  )
}
