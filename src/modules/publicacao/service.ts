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

const DIVERGENCIA_NAO_ENCONTRADA = 'Divergência não encontrada.'
const JA_RECONHECIDA = 'Esta divergência já foi reconhecida.'
const VERSAO_NAO_ENCONTRADA = 'Versão não encontrada.'
const OBSERVACAO_INVALIDA = 'Descreva o que foi verificado (de 10 a 500 caracteres).'
const SEM_EVIDENCIA_EM_PROD = 'Registre primeiro a evidência de deploy desta versão em PROD.'

// Reconhecer não autoriza a versão e não apaga a divergência (invariante 7): só registra quem viu.
export async function reconhecerDivergencia(
  sujeito: Sujeito,
  e: { projetoId: string; divergenciaId: string },
  agora: Date = new Date(),
): Promise<void> {
  exigirPermissao(sujeito, 'publicacao.autorizar')

  const divergencia = await db.divergenciaDeDeploy.findFirst({
    where: { id: e.divergenciaId, versao: { projetoId: e.projetoId } },
    select: { id: true },
  })
  if (!divergencia) {
    throw new ErroDeDominio(DIVERGENCIA_NAO_ENCONTRADA)
  }
  const { count } = await db.divergenciaDeDeploy.updateMany({
    where: { id: divergencia.id, reconhecidaEm: null },
    data: { reconhecidaPorId: sujeito.usuarioId, reconhecidaEm: agora },
  })
  if (count === 0) {
    throw new ErroDeDominio(JA_RECONHECIDA)
  }
}

async function existeEvidenciaEmProd(versaoId: string): Promise<boolean> {
  const evidencia = await db.evidenciaDeploy.findFirst({
    where: { versaoId, situacao: 'SUCESSO', ambiente: { tipo: 'PROD' } },
    select: { id: true },
  })
  return evidencia !== null
}

// Verificação em produção (decisão 10): só insere, e só para versão com deploy bem-sucedido em PROD.
export async function registrarVerificacaoProd(
  sujeito: Sujeito,
  e: { projetoId: string; versaoId: string; observacao: string },
): Promise<void> {
  exigirPermissao(sujeito, 'publicacao.autorizar')

  const observacao = e.observacao.trim()
  if (observacao.length < 10 || observacao.length > 500) {
    throw new ErroDeDominio(OBSERVACAO_INVALIDA)
  }
  const versao = await db.versao.findFirst({
    where: { id: e.versaoId, projetoId: e.projetoId },
    select: { id: true },
  })
  if (!versao) {
    throw new ErroDeDominio(VERSAO_NAO_ENCONTRADA)
  }
  if (!(await existeEvidenciaEmProd(versao.id))) {
    throw new ErroDeDominio(SEM_EVIDENCIA_EM_PROD)
  }
  await db.verificacaoProd.create({
    data: { versaoId: versao.id, origem: 'MANUAL', autorId: sujeito.usuarioId, observacao },
  })
}

export type ResultadoDaVerificacaoPorEvidencia =
  | { tipo: 'registrada'; id: string }
  | { tipo: 'ambiente-nao-prod' | 'versao-desconhecida' | 'sem-evidencia' }

// Chamada só pela rota, depois de autenticar o token do ambiente (que é o "sujeito").
export async function registrarVerificacaoPorEvidencia(e: {
  ambienteId: string
  nomeCompleto: string
  commit: string
  observacao: string | null
}): Promise<ResultadoDaVerificacaoPorEvidencia> {
  const ambiente = await db.ambiente.findUnique({
    where: { id: e.ambienteId },
    select: { tipo: true, projetoId: true },
  })
  if (ambiente?.tipo !== 'PROD') {
    return { tipo: 'ambiente-nao-prod' }
  }
  const versao = await db.versao.findFirst({
    where: {
      projetoId: ambiente.projetoId,
      commitSha: e.commit.toLowerCase(),
      repositorio: {
        nomeCompleto: { equals: e.nomeCompleto, mode: 'insensitive' },
        projetoId: ambiente.projetoId,
        removidoDaInstalacaoEm: null,
      },
    },
    select: { id: true },
  })
  if (!versao) {
    return { tipo: 'versao-desconhecida' }
  }
  if (!(await existeEvidenciaEmProd(versao.id))) {
    return { tipo: 'sem-evidencia' }
  }
  const verificacao = await db.verificacaoProd.create({
    data: {
      versaoId: versao.id,
      origem: 'ENDPOINT',
      observacao: e.observacao?.trim() || null,
    },
    select: { id: true },
  })
  return { tipo: 'registrada', id: verificacao.id }
}
