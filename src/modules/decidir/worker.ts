import { db } from '@/lib/db'
import { limparParciais } from '@/modules/demandas/worker'
import { lerRetratoMaisRecente } from '@/modules/fabrica/queries'
import { encerrarConversa } from './confirmacao'
import { montarPilha } from './model'
import { decisoesDoRetrato, demandasEsperando } from './queries'

const RESOLVIDO_FORA = 'Resolvido por outro caminho.'
const LOTE = 200

/**
 * Encerra como `resolvida_fora` toda conversa aberta cujo item saiu da pilha (a demanda saiu da
 * espera, a decisão saiu do retrato): o cartão `PROPOSTO` vira `SUBSTITUIDO` e o histórico ganha
 * "Resolvido por outro caminho.". Adiado e guardado continuam na pilha. Sem retrato válido não se
 * conclui nada sobre as issues da Fábrica; só as demandas são conferidas.
 */
export async function arquivarConversasResolvidas(agora: Date): Promise<number> {
  const [demandas, recebido] = await Promise.all([demandasEsperando(), lerRetratoMaisRecente()])
  const { itens, guardados } = montarPilha({
    demandas,
    decisoes: decisoesDoRetrato(recebido?.retrato ?? null),
    marcas: [],
    agora,
    nomeDoProjeto: () => null,
  })
  const naPilha = new Set([...itens, ...guardados].map((i) => i.chave))

  let encerradas = 0
  // Em páginas, por id: conversas novas não ficam atrás das mais antigas.
  for (let cursor: string | undefined; ;) {
    const abertas = await db.conversa.findMany({
      where: { encerradaEm: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: LOTE,
      select: { id: true, chave: true },
    })
    if (abertas.length === 0) break
    cursor = abertas.at(-1)!.id
    for (const { id, chave } of abertas) {
      if (naPilha.has(chave)) continue
      if (recebido === null && chave.startsWith('issue:')) continue
      const encerrou = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "Conversa" WHERE id = ${id} FOR UPDATE`
        const c = await tx.conversa.findUnique({ where: { id }, select: { encerradaEm: true } })
        if (!c || c.encerradaEm) return false
        // Um cartão sendo confirmado agora é de quem o confirma; a próxima rodada vê o resultado.
        const confirmando = await tx.cartaoDeFecho.count({
          where: { conversaId: id, estado: 'CONFIRMANDO' },
        })
        if (confirmando > 0) return false
        await tx.cartaoDeFecho.updateMany({
          where: { conversaId: id, estado: 'PROPOSTO' },
          data: { estado: 'SUBSTITUIDO' },
        })
        await encerrarConversa(tx, id, 'resolvida_fora', RESOLVIDO_FORA, agora)
        return true
      })
      if (encerrou) encerradas += 1
    }
  }
  return encerradas
}

/** `.parcial` de imagens que ficaram para trás em `<dir>/conversas/<id>/`, como na limpeza das demandas. */
export function limparParciaisDeConversas(agora: Date): Promise<number> {
  return limparParciais(agora, 'conversas')
}
