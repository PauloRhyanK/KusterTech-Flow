import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { normalizarRetrato, type RetratoV2, retratoSchema } from './contrato'

export interface RetratoRecebido {
  /** Sempre no formato v2; um v1 guardado vem normalizado (sem execuções). */
  retrato: RetratoV2
  versaoOriginal: 1 | 2
  geradoEm: Date
  recebidoEm: Date
}

// O retrato mais recente entre as fontes não revogadas; null se não há nenhum válido.
export async function obterRetratoMaisRecente(sujeito: Sujeito): Promise<RetratoRecebido | null> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  return lerRetratoMaisRecente()
}

/** Sem conferir permissão: só para quem já conferiu (ou o atendente, que não tem sujeito). */
export async function lerRetratoMaisRecente(): Promise<RetratoRecebido | null> {
  const linha = await db.retratoDaFabrica.findFirst({
    where: { fonte: { revogadaEm: null } },
    orderBy: { recebidoEm: 'desc' },
    select: { geradoEm: true, recebidoEm: true, conteudo: true },
  })
  if (linha === null) return null

  const lido = retratoSchema.safeParse(linha.conteudo)
  if (!lido.success) return null
  return {
    retrato: normalizarRetrato(lido.data),
    versaoOriginal: lido.data.versao,
    geradoEm: linha.geradoEm,
    recebidoEm: linha.recebidoEm,
  }
}

export async function listarFontesDaFabrica(sujeito: Sujeito) {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')

  return db.fonteDaFabrica.findMany({
    orderBy: { criadoEm: 'desc' },
    select: { id: true, nome: true, criadoEm: true, ultimoUsoEm: true, revogadaEm: true },
  })
}
