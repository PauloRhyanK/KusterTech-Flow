import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { type RetratoV1, retratoV1Schema } from './contrato'

export interface RetratoRecebido {
  retrato: RetratoV1
  geradoEm: Date
  recebidoEm: Date
}

// O retrato mais recente entre as fontes não revogadas; null se não há nenhum válido.
export async function obterRetratoMaisRecente(sujeito: Sujeito): Promise<RetratoRecebido | null> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')

  const linha = await db.retratoDaFabrica.findFirst({
    where: { fonte: { revogadaEm: null } },
    orderBy: { recebidoEm: 'desc' },
    select: { geradoEm: true, recebidoEm: true, conteudo: true },
  })
  if (linha === null) return null

  const lido = retratoV1Schema.safeParse(linha.conteudo)
  if (!lido.success) return null
  return { retrato: lido.data, geradoEm: linha.geradoEm, recebidoEm: linha.recebidoEm }
}

export async function listarFontesDaFabrica(sujeito: Sujeito) {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')

  return db.fonteDaFabrica.findMany({
    orderBy: { criadoEm: 'desc' },
    select: { id: true, nome: true, criadoEm: true, ultimoUsoEm: true, revogadaEm: true },
  })
}
