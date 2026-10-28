import type { Prisma } from '@prisma/client'
import { ehCorrecaoBloqueadora, podeAprovarMilestone, type EntradaDeAprovacao } from './model'

export interface BaseDaAprovacao {
  milestone: { projetoId: string; titulo: string; arquivadaEm: Date | null }
  cliente: { nome: string }
  homologacao: {
    id: string
    estado: 'EM_ANDAMENTO' | 'APROVADA'
    aprovadaEm: Date | null
    aprovadaPor: string | null
  } | null
  entrada: EntradaDeAprovacao
  avaliacao: ReturnType<typeof podeAprovarMilestone>
  versoes: { id: string; rotulo: string; repositorio: string }[]
  // Ids das versões avaliadas dos itens do cliente, ordenados e unidos por vírgula: o servidor
  // recusa a aprovação se o conjunto mudou desde que a página foi aberta.
  versoesEsperadas: string
  issuesFechadas: number
  issuesNoEscopo: number
  bloqueadoras: number
}

// Leitura única do que decide a aprovação (D22): a tela e o service usam a mesma, o service dentro
// da transação que grava. Devolve nulo quando o cliente não está associado à milestone do projeto.
export async function carregarBaseDaAprovacao(
  cliente: Prisma.TransactionClient,
  e: { clienteId: string; projetoId?: string; milestoneId: string },
): Promise<BaseDaAprovacao | null> {
  const milestone = await cliente.milestone.findFirst({
    where: {
      id: e.milestoneId,
      ...(e.projetoId ? { projetoId: e.projetoId } : {}),
      clientes: { some: { clienteId: e.clienteId } },
    },
    select: {
      projetoId: true,
      titulo: true,
      arquivadaEm: true,
      issues: {
        select: { foraDoEscopo: true, issue: { select: { id: true, estado: true } } },
      },
      clientes: {
        where: { clienteId: e.clienteId },
        select: { cliente: { select: { nome: true } } },
      },
      homologacoes: {
        where: { clienteId: e.clienteId },
        select: {
          id: true,
          estado: true,
          aprovadaEm: true,
          aprovadaPor: { select: { nome: true } },
          itens: {
            select: {
              estado: true,
              versaoAvaliada: {
                select: { id: true, rotulo: true, repositorio: { select: { nomeCompleto: true } } },
              },
              solicitacoes: { select: { id: true, estado: true, foraDoEscopo: true } },
            },
          },
        },
      },
    },
  })
  const associacao = milestone?.clientes[0]
  if (!milestone || !associacao) {
    return null
  }
  const homologacao = milestone.homologacoes[0] ?? null
  const itens = homologacao?.itens ?? []

  const entrada: EntradaDeAprovacao = {
    estado: homologacao?.estado ?? 'EM_ANDAMENTO',
    issuesDoEscopo: milestone.issues.map((v) => ({
      issueId: v.issue.id,
      estado: v.issue.estado,
      foraDoEscopo: v.foraDoEscopo,
    })),
    itensDisponibilizados: itens.filter((i) => i.estado !== 'AGUARDANDO_DISPONIBILIZACAO').length,
    solicitacoes: itens.flatMap((i) => i.solicitacoes),
  }

  const versoesPorId = new Map<string, { id: string; rotulo: string; repositorio: string }>()
  for (const i of itens) {
    if (i.versaoAvaliada) {
      versoesPorId.set(i.versaoAvaliada.id, {
        id: i.versaoAvaliada.id,
        rotulo: i.versaoAvaliada.rotulo,
        repositorio: i.versaoAvaliada.repositorio.nomeCompleto,
      })
    }
  }
  const versoes = [...versoesPorId.values()].sort(
    (a, b) => a.repositorio.localeCompare(b.repositorio) || a.rotulo.localeCompare(b.rotulo),
  )

  const escopo = new Map<string, boolean>()
  for (const i of entrada.issuesDoEscopo) {
    if (i.foraDoEscopo) continue
    escopo.set(i.issueId, (escopo.get(i.issueId) ?? false) || i.estado === 'ABERTA')
  }

  return {
    milestone: {
      projetoId: milestone.projetoId,
      titulo: milestone.titulo,
      arquivadaEm: milestone.arquivadaEm,
    },
    cliente: { nome: associacao.cliente.nome },
    homologacao: homologacao
      ? {
          id: homologacao.id,
          estado: homologacao.estado,
          aprovadaEm: homologacao.aprovadaEm,
          aprovadaPor: homologacao.aprovadaPor?.nome ?? null,
        }
      : null,
    entrada,
    avaliacao: podeAprovarMilestone(entrada),
    versoes,
    versoesEsperadas: [...versoesPorId.keys()].sort().join(','),
    issuesFechadas: [...escopo.values()].filter((aberta) => !aberta).length,
    issuesNoEscopo: escopo.size,
    bloqueadoras: entrada.solicitacoes.filter(ehCorrecaoBloqueadora).length,
  }
}
