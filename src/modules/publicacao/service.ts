import { Prisma } from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { carregarPublicacaoDoRepositorio, prepararAvaliacao } from './avaliacao'
import { avaliarAutorizacaoProd } from './model'

export interface EntradaDeAutorizacaoProd {
  projetoId: string
  repositorioId: string
  versaoAlvoId: string
  composicaoId: string
  hashComposicao: string
  contextoConferido: boolean
  desconhecidosConferidos: boolean
  verificadasPorHumano: string[]
  justificativa: string | null
}

const COMPOSICAO_NAO_ENCONTRADA = 'Composição não encontrada.'
const VERSAO_MUDOU =
  'A versão em QA mudou desde que você abriu esta tela. Revise antes de autorizar.'
const COMPOSICAO_MUDOU =
  'A composição mudou desde que você abriu esta tela. Revise antes de autorizar.'
const RECALCULANDO = 'A composição está sendo recalculada. Tente de novo em instantes.'
const JA_AUTORIZADA = 'Esta versão já está autorizada.'
const CONFLITO = 'Outra autorização foi registrada agora há pouco. Recarregue a página.'

// Autorizar PROD (D28–D31): registra a decisão sobre a composição exata de uma versão. Não cria
// evidência de deploy nem muda o estado do deploy. Tudo é relido dentro da transação; da página
// aberta só vêm o hash e a versão que o usuário viu.
export async function autorizarPublicacao(
  sujeito: Sujeito,
  e: EntradaDeAutorizacaoProd,
  agora: Date = new Date(),
): Promise<{ autorizacaoId: string }> {
  exigirPermissao(sujeito, 'publicacao.autorizar')

  try {
    return await db.$transaction(
      async (tx) => {
        const composicao = await tx.composicaoDePublicacao.findUnique({
          where: { id: e.composicaoId },
        })
        if (
          !composicao ||
          composicao.projetoId !== e.projetoId ||
          composicao.repositorioId !== e.repositorioId ||
          composicao.versaoAlvoId !== e.versaoAlvoId
        ) {
          throw new ErroDeDominio(COMPOSICAO_NAO_ENCONTRADA)
        }

        const atual = await carregarPublicacaoDoRepositorio(tx, e.repositorioId, agora)
        if (
          !atual?.composicao ||
          !atual.situacao.candidata ||
          !atual.situacao.base ||
          atual.situacao.candidata.versaoId !== composicao.versaoAlvoId ||
          atual.situacao.base.commitBase !== composicao.commitBase
        ) {
          throw new ErroDeDominio(VERSAO_MUDOU)
        }
        if (composicao.hashComposicao !== e.hashComposicao) {
          throw new ErroDeDominio(COMPOSICAO_MUDOU)
        }
        if (atual.desatualizada) {
          throw new ErroDeDominio(RECALCULANDO)
        }
        if (atual.autorizacaoVigente) {
          throw new ErroDeDominio(JA_AUTORIZADA)
        }

        const preparada = await prepararAvaliacao(tx, {
          composicao: atual.composicao,
          integracao: atual.integracao,
        })
        const avaliacao = avaliarAutorizacaoProd({
          ...preparada.entrada,
          confirmacao: {
            contextoConferido: e.contextoConferido,
            desconhecidosConferidos: e.desconhecidosConferidos,
            verificadasPorHumano: e.verificadasPorHumano,
            justificativa: e.justificativa,
          },
        })
        if (!avaliacao.pode) {
          const motivo = avaliacao.bloqueios[0] ?? avaliacao.pendencias[0]
          throw new ErroDeDominio(`Não é possível autorizar: ${motivo}`)
        }

        const justificativa = e.justificativa?.trim() || null
        const autorizacao = await tx.autorizacaoProd.create({
          data: {
            projetoId: composicao.projetoId,
            repositorioId: composicao.repositorioId,
            versaoAlvoId: composicao.versaoAlvoId,
            composicaoId: composicao.id,
            commitBase: composicao.commitBase,
            hashComposicao: composicao.hashComposicao,
            autorId: sujeito.usuarioId,
            justificativa,
            composicaoAutorizada: composicao.itens as Prisma.InputJsonValue,
            criadaEm: agora,
            itens: {
              create: avaliacao.itens.flatMap((i) =>
                i.situacao ? [{ issueId: i.issueId, situacao: i.situacao }] : [],
              ),
            },
          },
          select: { id: true },
        })
        return { autorizacaoId: autorizacao.id }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2034') {
      throw new ErroDeDominio(CONFLITO)
    }
    throw erro
  }
}
