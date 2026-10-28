import { db } from '@/lib/db'
import { deployEhDivergente } from './model'

// Invariante 7 (decisão 9): deploy em PROD sem autorização válida no momento do registro vira uma
// `DivergenciaDeDeploy`. Determinística e idempotente: roda só sobre evidências ainda sem
// divergência e nunca apaga uma existente; autorização tardia não a remove.
export async function detectarDivergencias(agora: Date): Promise<{ novas: number }> {
  const evidencias = await db.evidenciaDeploy.findMany({
    where: {
      situacao: 'SUCESSO',
      ambiente: { tipo: 'PROD' },
      divergencia: null,
    },
    select: {
      id: true,
      versaoId: true,
      situacao: true,
      ocorridaEm: true,
      registradaEm: true,
      ambiente: { select: { criadoEm: true } },
      versao: { select: { autorizacoesProd: { select: { criadaEm: true, revogadaEm: true } } } },
    },
  })

  const divergentes = evidencias.filter((e) =>
    deployEhDivergente({
      ambienteCriadoEm: e.ambiente.criadoEm,
      evidencia: e,
      autorizacoes: e.versao.autorizacoesProd,
    }),
  )
  if (divergentes.length === 0) return { novas: 0 }

  const { count } = await db.divergenciaDeDeploy.createMany({
    data: divergentes.map((e) => ({
      evidenciaId: e.id,
      versaoId: e.versaoId,
      detectadaEm: agora,
    })),
    skipDuplicates: true,
  })
  return { novas: count }
}
