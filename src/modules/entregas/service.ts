import { Prisma } from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { normalizarNome } from '@/modules/clientes/model'
import {
  LIMITE_DE_ISSUES_POR_ADICAO,
  milestonesHerdadas,
  validarDescricaoDeMilestone,
  validarJustificativa,
  validarTituloDeMilestone,
} from './model'

type Tx = Prisma.TransactionClient

const TITULO_DUPLICADO = 'Já existe uma milestone com este título neste projeto.'

function ehViolacaoUnica(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002'
}

async function exigirProjetoAtivo(tx: Tx, projetoId: string): Promise<void> {
  const projeto = await tx.projeto.findUnique({
    where: { id: projetoId },
    select: { arquivadoEm: true },
  })
  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }
  if (projeto.arquivadoEm !== null) {
    throw new ErroDeDominio('Projeto arquivado não recebe milestones.')
  }
}

async function exigirMilestone(tx: Tx, milestoneId: string, opcoes: { aceitaArquivada?: boolean }) {
  const milestone = await tx.milestone.findUnique({
    where: { id: milestoneId },
    select: {
      id: true,
      titulo: true,
      projetoId: true,
      arquivadaEm: true,
      projeto: { select: { arquivadoEm: true } },
    },
  })
  if (!milestone) {
    throw new ErroDeDominio('Milestone não encontrada.')
  }
  if (milestone.projeto.arquivadoEm !== null) {
    throw new ErroDeDominio('Projeto arquivado não recebe milestones.')
  }
  if (milestone.arquivadaEm !== null && !opcoes.aceitaArquivada) {
    throw new ErroDeDominio('Milestone arquivada não recebe alterações.')
  }
  return milestone
}

async function exigirClienteAssociavel(tx: Tx, projetoId: string, clienteId: string) {
  const associacao = await tx.projetoCliente.findUnique({
    where: { projetoId_clienteId: { projetoId, clienteId } },
    select: { cliente: { select: { arquivadoEm: true } } },
  })
  if (!associacao) {
    throw new ErroDeDominio('O cliente precisa estar associado ao projeto.')
  }
  if (associacao.cliente.arquivadoEm !== null) {
    throw new ErroDeDominio('Cliente arquivado não pode ser associado.')
  }
}

export async function criarMilestone(
  sujeito: Sujeito,
  projetoId: string,
  dados: {
    titulo: string
    descricao?: string | null
    prazo?: Date | null
    clientesIds?: string[]
  },
): Promise<{ id: string }> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const titulo = validarTituloDeMilestone(dados.titulo)
  const descricao = validarDescricaoDeMilestone(dados.descricao)
  const clientesIds = [...new Set(dados.clientesIds ?? [])]

  try {
    return await db.$transaction(async (tx) => {
      await exigirProjetoAtivo(tx, projetoId)
      for (const clienteId of clientesIds) {
        await exigirClienteAssociavel(tx, projetoId, clienteId)
      }

      const criada = await tx.milestone.create({
        data: {
          projetoId,
          titulo,
          tituloNormalizado: normalizarNome(titulo),
          descricao,
          prazo: dados.prazo ?? null,
        },
        select: { id: true },
      })
      if (clientesIds.length > 0) {
        await tx.milestoneCliente.createMany({
          data: clientesIds.map((clienteId) => ({ milestoneId: criada.id, clienteId })),
        })
      }
      return { id: criada.id }
    })
  } catch (erro) {
    if (ehViolacaoUnica(erro)) {
      throw new ErroDeDominio(TITULO_DUPLICADO)
    }
    throw erro
  }
}

export async function editarMilestone(
  sujeito: Sujeito,
  milestoneId: string,
  dados: { titulo: string; descricao?: string | null; prazo?: Date | null },
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const titulo = validarTituloDeMilestone(dados.titulo)
  const descricao = validarDescricaoDeMilestone(dados.descricao)

  try {
    await db.$transaction(async (tx) => {
      await exigirMilestone(tx, milestoneId, {})
      await tx.milestone.update({
        where: { id: milestoneId },
        data: {
          titulo,
          tituloNormalizado: normalizarNome(titulo),
          descricao,
          prazo: dados.prazo ?? null,
        },
      })
    })
  } catch (erro) {
    if (ehViolacaoUnica(erro)) {
      throw new ErroDeDominio(TITULO_DUPLICADO)
    }
    throw erro
  }
}

export async function arquivarMilestone(sujeito: Sujeito, milestoneId: string): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  await db.$transaction(async (tx) => {
    const milestone = await tx.milestone.findUnique({
      where: { id: milestoneId },
      select: { arquivadaEm: true, projeto: { select: { arquivadoEm: true } } },
    })
    if (!milestone) {
      throw new ErroDeDominio('Milestone não encontrada.')
    }
    if (milestone.projeto.arquivadoEm !== null) {
      throw new ErroDeDominio('Projeto arquivado não recebe milestones.')
    }
    if (milestone.arquivadaEm === null) {
      await tx.milestone.update({ where: { id: milestoneId }, data: { arquivadaEm: new Date() } })
    }
  })
}

export async function reativarMilestone(sujeito: Sujeito, milestoneId: string): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  await db.$transaction(async (tx) => {
    const milestone = await exigirMilestone(tx, milestoneId, { aceitaArquivada: true })
    if (milestone.arquivadaEm !== null) {
      await tx.milestone.update({ where: { id: milestoneId }, data: { arquivadaEm: null } })
    }
  })
}

export async function associarClienteAMilestone(
  sujeito: Sujeito,
  milestoneId: string,
  clienteId: string,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  try {
    await db.$transaction(async (tx) => {
      const milestone = await exigirMilestone(tx, milestoneId, {})
      await exigirClienteAssociavel(tx, milestone.projetoId, clienteId)
      await tx.milestoneCliente.create({ data: { milestoneId, clienteId } })
    })
  } catch (erro) {
    if (ehViolacaoUnica(erro)) {
      throw new ErroDeDominio('Cliente já associado a esta milestone.')
    }
    throw erro
  }
}

export async function removerClienteDaMilestone(
  sujeito: Sujeito,
  milestoneId: string,
  clienteId: string,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  await db.$transaction(async (tx) => {
    await exigirMilestone(tx, milestoneId, {})
    await tx.milestoneCliente.deleteMany({ where: { milestoneId, clienteId } })
  })
}

export async function adicionarIssuesAMilestone(
  sujeito: Sujeito,
  milestoneId: string,
  issueIds: string[],
): Promise<{ adicionadas: number }> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const ids = [...new Set(issueIds)]
  if (ids.length === 0) {
    throw new ErroDeDominio('Selecione ao menos uma issue.')
  }
  if (ids.length > LIMITE_DE_ISSUES_POR_ADICAO) {
    throw new ErroDeDominio(`Adicione no máximo ${LIMITE_DE_ISSUES_POR_ADICAO} issues por vez.`)
  }

  return db.$transaction(async (tx) => {
    const milestone = await exigirMilestone(tx, milestoneId, {})
    const doProjeto = await tx.issueGitHub.count({
      where: { id: { in: ids }, repositorio: { projetoId: milestone.projetoId } },
    })
    if (doProjeto !== ids.length) {
      throw new ErroDeDominio('Issue não encontrada neste projeto.')
    }
    const { count } = await tx.milestoneIssue.createMany({
      data: ids.map((issueId) => ({ milestoneId, issueId, origem: 'MANUAL' as const })),
      skipDuplicates: true,
    })
    return { adicionadas: count }
  })
}

export async function removerIssueDaMilestone(
  sujeito: Sujeito,
  milestoneId: string,
  issueId: string,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  await db.$transaction(async (tx) => {
    await exigirMilestone(tx, milestoneId, {})
    const { count } = await tx.milestoneIssue.deleteMany({
      where: { milestoneId, issueId, origem: 'MANUAL' },
    })
    if (count === 0) {
      const restante = await tx.milestoneIssue.findUnique({
        where: { milestoneId_issueId: { milestoneId, issueId } },
        select: { origem: true },
      })
      if (restante?.origem === 'HERANCA_CORRECAO') {
        throw new ErroDeDominio('Correções herdadas não são removidas; marque como fora do escopo.')
      }
    }
  })
}

export async function criarVinculoDeCorrecao(
  tx: Tx,
  dados: { issueOriginalId: string; issueCorrecaoId: string; criadoPorId: string },
): Promise<{ milestonesHerdadas: number }> {
  const { issueOriginalId, issueCorrecaoId, criadoPorId } = dados
  if (issueOriginalId === issueCorrecaoId) {
    throw new ErroDeDominio('Uma issue não pode corrigir a si mesma.')
  }

  const [original, correcao] = await Promise.all([
    tx.issueGitHub.findUnique({
      where: { id: issueOriginalId },
      select: { numero: true, repositorio: { select: { projetoId: true } } },
    }),
    tx.issueGitHub.findUnique({
      where: { id: issueCorrecaoId },
      select: { repositorio: { select: { projetoId: true } } },
    }),
  ])
  if (!original || !correcao) {
    throw new ErroDeDominio('Issue não encontrada neste projeto.')
  }

  const existentes = await tx.issueVinculo.findMany({
    where: {
      OR: [
        { issueOriginalId, issueCorrecaoId },
        { issueOriginalId: issueCorrecaoId, issueCorrecaoId: issueOriginalId },
      ],
    },
    select: { issueOriginalId: true },
  })
  if (existentes.some((v) => v.issueOriginalId === issueOriginalId)) {
    throw new ErroDeDominio('Este vínculo de correção já existe.')
  }
  if (existentes.length > 0) {
    throw new ErroDeDominio(
      `A issue #${original.numero} já é registrada como correção desta issue.`,
    )
  }

  try {
    await tx.issueVinculo.create({ data: { issueOriginalId, issueCorrecaoId, criadoPorId } })
  } catch (erro) {
    if (ehViolacaoUnica(erro)) {
      throw new ErroDeDominio('Este vínculo de correção já existe.')
    }
    throw erro
  }

  const projetoId = correcao.repositorio.projetoId ?? null
  if (projetoId === null) {
    return { milestonesHerdadas: 0 }
  }

  const [daOriginal, daCorrecao] = await Promise.all([
    tx.milestoneIssue.findMany({
      where: { issueId: issueOriginalId, milestone: { projetoId } },
      orderBy: { criadoEm: 'asc' },
      select: {
        milestoneId: true,
        foraDoEscopo: true,
        milestone: { select: { arquivadaEm: true } },
      },
    }),
    tx.milestoneIssue.findMany({
      where: { issueId: issueCorrecaoId, milestone: { projetoId } },
      select: { milestoneId: true },
    }),
  ])
  const herdadas = milestonesHerdadas(
    daOriginal.map((l) => ({
      milestoneId: l.milestoneId,
      foraDoEscopo: l.foraDoEscopo,
      arquivada: l.milestone.arquivadaEm !== null,
    })),
    daCorrecao.map((l) => l.milestoneId),
  )
  if (herdadas.length > 0) {
    await tx.milestoneIssue.createMany({
      data: herdadas.map((milestoneId) => ({
        milestoneId,
        issueId: issueCorrecaoId,
        origem: 'HERANCA_CORRECAO' as const,
      })),
      skipDuplicates: true,
    })
  }
  return { milestonesHerdadas: herdadas.length }
}

export async function registrarCorrecao(
  sujeito: Sujeito,
  dados: {
    projetoId: string
    issueCorrecaoId: string
    repositorioOriginalId: string
    numeroOriginal: number
  },
): Promise<{ milestonesHerdadas: number }> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  return db.$transaction(async (tx) => {
    await exigirProjetoAtivo(tx, dados.projetoId)

    const correcao = await tx.issueGitHub.findFirst({
      where: { id: dados.issueCorrecaoId, repositorio: { projetoId: dados.projetoId } },
      select: { id: true },
    })
    if (!correcao) {
      throw new ErroDeDominio('Issue não encontrada neste projeto.')
    }

    const original = await tx.issueGitHub.findFirst({
      where: {
        repositorioId: dados.repositorioOriginalId,
        numero: dados.numeroOriginal,
        repositorio: { projetoId: dados.projetoId },
      },
      select: { id: true },
    })
    if (!original) {
      throw new ErroDeDominio(`Issue #${dados.numeroOriginal} não encontrada neste repositório.`)
    }

    return criarVinculoDeCorrecao(tx, {
      issueOriginalId: original.id,
      issueCorrecaoId: correcao.id,
      criadoPorId: sujeito.usuarioId,
    })
  })
}

export async function marcarForaDoEscopo(
  sujeito: Sujeito,
  dados: { milestoneId: string; issueId: string; justificativa: string },
): Promise<{ tituloDaMilestone: string }> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const justificativa = validarJustificativa(dados.justificativa)
  const { milestoneId, issueId } = dados

  return db.$transaction(async (tx) => {
    const milestone = await exigirMilestone(tx, milestoneId, {})
    const { count } = await tx.milestoneIssue.updateMany({
      where: { milestoneId, issueId, origem: 'HERANCA_CORRECAO', foraDoEscopo: false },
      data: { foraDoEscopo: true, justificativaForaDoEscopo: justificativa },
    })
    if (count === 0) {
      const linha = await tx.milestoneIssue.findUnique({
        where: { milestoneId_issueId: { milestoneId, issueId } },
        select: { origem: true, foraDoEscopo: true },
      })
      if (!linha) {
        throw new ErroDeDominio('Issue não encontrada neste projeto.')
      }
      if (linha.origem !== 'HERANCA_CORRECAO') {
        throw new ErroDeDominio('Só correções herdadas podem ser marcadas como fora do escopo.')
      }
      throw new ErroDeDominio('Esta correção já está fora do escopo.')
    }
    return { tituloDaMilestone: milestone.titulo }
  })
}

export async function voltarAoEscopo(
  sujeito: Sujeito,
  dados: { milestoneId: string; issueId: string },
): Promise<{ tituloDaMilestone: string }> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const { milestoneId, issueId } = dados

  return db.$transaction(async (tx) => {
    const milestone = await exigirMilestone(tx, milestoneId, {})
    const { count } = await tx.milestoneIssue.updateMany({
      where: { milestoneId, issueId, origem: 'HERANCA_CORRECAO', foraDoEscopo: true },
      data: { foraDoEscopo: false, justificativaForaDoEscopo: null },
    })
    if (count === 0) {
      const linha = await tx.milestoneIssue.findUnique({
        where: { milestoneId_issueId: { milestoneId, issueId } },
        select: { origem: true },
      })
      if (!linha) {
        throw new ErroDeDominio('Issue não encontrada neste projeto.')
      }
      throw new ErroDeDominio('Esta correção já está no escopo.')
    }
    return { tituloDaMilestone: milestone.titulo }
  })
}
