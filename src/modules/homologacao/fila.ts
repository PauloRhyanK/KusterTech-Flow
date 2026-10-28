import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import type { TarefaDoWorker } from '@/worker/tarefas'
import { PRESENCAS_QUE_LIBERAM } from './model'
import { versoesCorrentesEmQA } from './versao-corrente'

interface Trio {
  clienteId: string
  milestoneId: string
  issueId: string
  versaoId: string
}

async function criarItem(trio: Trio, agora: Date): Promise<boolean> {
  try {
    return await db.$transaction(async (tx) => {
      const existente = await tx.homologacaoItem.findFirst({
        where: {
          issueId: trio.issueId,
          homologacao: { clienteId: trio.clienteId, milestoneId: trio.milestoneId },
        },
        select: { id: true },
      })
      if (existente) return false

      const homologacao = await tx.homologacao.upsert({
        where: {
          clienteId_milestoneId: { clienteId: trio.clienteId, milestoneId: trio.milestoneId },
        },
        create: { clienteId: trio.clienteId, milestoneId: trio.milestoneId },
        update: {},
        select: { id: true },
      })
      const item = await tx.homologacaoItem.create({
        data: {
          homologacaoId: homologacao.id,
          issueId: trio.issueId,
          estado: 'AGUARDANDO_DISPONIBILIZACAO',
          versaoAvaliadaId: trio.versaoId,
        },
        select: { id: true },
      })
      const evento = await tx.eventoTimeline.create({
        data: {
          clienteId: trio.clienteId,
          milestoneId: trio.milestoneId,
          issueId: trio.issueId,
          versaoId: trio.versaoId,
          tipo: 'ENTRADA_NA_FILA',
          visibilidade: 'INTERNA',
          origem: 'SISTEMA',
          criadoEm: agora,
          estadoNovo: 'AGUARDANDO_DISPONIBILIZACAO',
        },
        select: { id: true },
      })
      await tx.homologacaoItem.update({
        where: { id: item.id },
        data: { ultimoEventoId: evento.id },
      })
      return true
    })
  } catch (erro) {
    // Outra execução criou o mesmo item entre a leitura e a escrita.
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      return false
    }
    throw erro
  }
}

// Decisão 2 do 5a: cria os itens que faltam; nunca altera item existente.
export async function atualizarFilaDeHomologacao(agora: Date): Promise<{ itensCriados: number }> {
  const projetos = await db.projeto.findMany({
    where: { arquivadoEm: null, ambientes: { some: { tipo: 'QA' } } },
    select: { id: true },
  })

  let itensCriados = 0
  for (const projeto of projetos) {
    const correntes = await versoesCorrentesEmQA(projeto.id)
    if (correntes.size === 0) continue

    const presencas = await db.presencaIssueVersao.findMany({
      where: {
        versaoId: { in: [...correntes.values()].map((v) => v.id) },
        estado: { in: [...PRESENCAS_QUE_LIBERAM] },
      },
      select: { issueId: true, versaoId: true },
    })
    if (presencas.length === 0) continue
    const versaoPorIssue = new Map(presencas.map((p) => [p.issueId, p.versaoId]))

    // Decisão 5 do 5b: a issue de correção é testada pelo reteste do item original, sem item próprio.
    const vinculos = await db.milestoneIssue.findMany({
      where: {
        issueId: { in: [...versaoPorIssue.keys()] },
        issue: { corrige: { none: {} } },
        foraDoEscopo: false,
        milestone: { projetoId: projeto.id, arquivadaEm: null },
      },
      select: {
        milestoneId: true,
        issueId: true,
        milestone: {
          select: {
            clientes: { where: { cliente: { arquivadoEm: null } }, select: { clienteId: true } },
          },
        },
      },
    })

    for (const vinculo of vinculos) {
      for (const { clienteId } of vinculo.milestone.clientes) {
        const criado = await criarItem(
          {
            clienteId,
            milestoneId: vinculo.milestoneId,
            issueId: vinculo.issueId,
            versaoId: versaoPorIssue.get(vinculo.issueId)!,
          },
          agora,
        )
        if (criado) itensCriados += 1
      }
    }
  }
  return { itensCriados }
}

export const tarefaAtualizarFila: TarefaDoWorker = {
  nome: 'atualizar-fila-de-homologacao',
  async executar(agora) {
    const { itensCriados } = await atualizarFilaDeHomologacao(agora)
    if (itensCriados > 0) {
      log.info(
        { tarefa: 'atualizar-fila-de-homologacao', itensCriados },
        'fila de homologação atualizada',
      )
    }
  },
}
