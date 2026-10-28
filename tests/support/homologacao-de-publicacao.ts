import { db } from '@/lib/db'

// Grava Homologacao, HomologacaoItem e eventos direto no banco, com `versaoAvaliadaId` = a versão
// alvo, sem passar pelo cenário do 5b (que cria outro Ambiente QA; errata 3.8, item 1). Idempotente
// por (cliente, milestone, issue): repetir muda o estado do item e acrescenta eventos.
export async function gravarHomologacaoDePublicacao(e: {
  clienteId: string
  milestoneId: string
  issueId: string
  versaoId: string
  adminId?: string
  aprovada: boolean
}): Promise<void> {
  const homologacao = await db.homologacao.upsert({
    where: { clienteId_milestoneId: { clienteId: e.clienteId, milestoneId: e.milestoneId } },
    create: { clienteId: e.clienteId, milestoneId: e.milestoneId },
    update: {},
  })
  const base = {
    clienteId: e.clienteId,
    milestoneId: e.milestoneId,
    issueId: e.issueId,
  }
  const entrada = await db.eventoTimeline.create({
    data: {
      ...base,
      tipo: 'ENTRADA_NA_FILA',
      visibilidade: 'INTERNA',
      origem: 'SISTEMA',
      estadoNovo: 'AGUARDANDO_DISPONIBILIZACAO',
    },
  })
  const disponibilizacao = await db.eventoTimeline.create({
    data: {
      ...base,
      versaoId: e.versaoId,
      tipo: 'DISPONIBILIZACAO',
      visibilidade: 'COMPARTILHAVEL',
      origem: 'HUMANO',
      autorId: e.adminId ?? null,
      estadoAnterior: 'AGUARDANDO_DISPONIBILIZACAO',
      estadoNovo: 'PENDENTE_DE_TESTE',
      eventoAnteriorId: entrada.id,
    },
  })
  let ultimoEventoId = disponibilizacao.id
  if (e.aprovada) {
    const aprovacao = await db.eventoTimeline.create({
      data: {
        ...base,
        versaoId: e.versaoId,
        tipo: 'APROVACAO',
        visibilidade: 'COMPARTILHAVEL',
        origem: 'HUMANO',
        autorId: e.adminId ?? null,
        estadoAnterior: 'PENDENTE_DE_TESTE',
        estadoNovo: 'APROVADA',
        eventoAnteriorId: disponibilizacao.id,
      },
    })
    ultimoEventoId = aprovacao.id
  }
  const dados = {
    estado: e.aprovada ? ('APROVADA' as const) : ('PENDENTE_DE_TESTE' as const),
    versaoAvaliadaId: e.versaoId,
    ultimoEventoId,
  }
  await db.homologacaoItem.upsert({
    where: { homologacaoId_issueId: { homologacaoId: homologacao.id, issueId: e.issueId } },
    create: { homologacaoId: homologacao.id, issueId: e.issueId, ...dados },
    update: dados,
  })
}
