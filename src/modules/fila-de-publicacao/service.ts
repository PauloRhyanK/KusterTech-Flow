import { randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { hashDoTokenDaFabrica, validarNomeDaFonteDaFabrica } from '@/modules/fabrica/model'
import { PREFIXO_DO_TOKEN_DE_PUBLICACAO } from './contrato'

// O token é devolvido só aqui; no banco fica apenas o hash (mesmo hash da Fábrica).
export async function criarFonteDePublicacao(
  sujeito: Sujeito,
  nome: string,
): Promise<{ id: string; token: string }> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')

  const validado = validarNomeDaFonteDaFabrica(nome)
  if (!validado.ok) throw new ErroDeDominio(validado.erro)

  const token = `${PREFIXO_DO_TOKEN_DE_PUBLICACAO}${randomBytes(32).toString('base64url')}`
  const criada = await db.fonteDePublicacao.create({
    data: {
      nome: validado.nome,
      tokenHash: hashDoTokenDaFabrica(token),
      criadaPorId: sujeito.usuarioId,
    },
    select: { id: true },
  })
  return { id: criada.id, token }
}

export async function revogarFonteDePublicacao(sujeito: Sujeito, fonteId: string): Promise<void> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')

  const { count } = await db.fonteDePublicacao.updateMany({
    where: { id: fonteId, revogadaEm: null },
    data: { revogadaEm: new Date() },
  })
  if (count > 0) return

  const existe = await db.fonteDePublicacao.findUnique({
    where: { id: fonteId },
    select: { id: true },
  })
  throw new ErroDeDominio(existe ? 'Esta fonte já foi revogada.' : 'Fonte não encontrada.')
}

export async function listarFontesDePublicacao(sujeito: Sujeito) {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')

  return db.fonteDePublicacao.findMany({
    orderBy: { criadoEm: 'desc' },
    select: { id: true, nome: true, criadoEm: true, ultimoUsoEm: true, revogadaEm: true },
  })
}

/** Liga ou desliga a pausa de todas as filas; devolve `true` quando ficou pausada. */
export async function alternarPausaGeral(sujeito: Sujeito): Promise<boolean> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  return db.$transaction(async (tx) => {
    const atual = await tx.pausaGeralDePublicacao.findUnique({ where: { id: 1 } })
    const pausar = atual?.pausadaEm == null
    const dados = pausar
      ? { pausadaEm: new Date(), pausadaPorId: sujeito.usuarioId }
      : { pausadaEm: null, pausadaPorId: null }
    await tx.pausaGeralDePublicacao.upsert({
      where: { id: 1 },
      create: { id: 1, ...dados },
      update: dados,
    })
    return pausar
  })
}

// A mesma trava por repositório da recepção e do worker.
function comTrava<T>(
  repositorioId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${repositorioId}))`
    return fn(tx)
  })
}

const SEM_CONFIGURACAO = 'A publicação deste repositório não está configurada.'

/** A fila parada volta a andar; o estado é revalidado sob a trava. */
export async function retomarFila(sujeito: Sujeito, repositorioId: string): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  await comTrava(repositorioId, async (tx) => {
    const config = await tx.configuracaoDePublicacao.findUnique({
      where: { repositorioId },
      select: { situacao: true },
    })
    if (!config) throw new ErroDeDominio(SEM_CONFIGURACAO)
    if (config.situacao !== 'PARADO') throw new ErroDeDominio('Esta fila não está parada.')
    await tx.configuracaoDePublicacao.update({
      where: { repositorioId },
      data: { situacao: 'NORMAL', situacaoDesde: new Date(), situacaoMotivo: null },
    })
  })
}

/** Depois de um histórico reescrito: o que foi publicado antes de agora deixa de valer como "no ar". */
export async function redefinirNoAr(sujeito: Sujeito, repositorioId: string): Promise<void> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')

  await comTrava(repositorioId, async (tx) => {
    const { count } = await tx.configuracaoDePublicacao.updateMany({
      where: { repositorioId },
      data: { baseRedefinidaEm: new Date() },
    })
    if (count === 0) throw new ErroDeDominio(SEM_CONFIGURACAO)
  })
}
