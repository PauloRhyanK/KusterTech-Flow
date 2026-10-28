import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { assinaturaDaEntrada, type EstadoImplantacao } from '@/modules/ambientes/model'

export interface EntradaDoCenario {
  projetoId: string
  repositorioId: string
  issueIds: string[]
  clienteIds: string[]
  adminId: string
  prefixo: string
}

export interface CenarioDeHomologacao extends EntradaDoCenario {
  milestoneId: string
  ambienteQaId: string
  versaoV1Id: string
  homologacaoPorCliente: Record<string, string>
  // chave: `${clienteId}:${issueId}`
  itemPorClienteEIssue: Record<string, string>
}

function shaAleatorio(): string {
  return randomBytes(20).toString('hex')
}

async function gravarPresencas(
  c: Pick<EntradaDoCenario, 'adminId'>,
  versaoId: string,
  issueIds: readonly string[],
  estado: EstadoImplantacao,
  agora: Date,
): Promise<void> {
  // Presença manual leva `confirmadaPorId` e a assinatura da entrada, senão o worker a recalcula
  // contra o SHA aleatório e a issue vira VERIFICACAO_NECESSARIA (errata 3.8, item 4).
  await db.presencaIssueVersao.createMany({
    data: issueIds.map((issueId) => ({
      versaoId,
      issueId,
      estado,
      motivo: 'Cenário de teste',
      confirmadaPorId: estado === 'CONFIRMACAO_MANUAL' ? c.adminId : null,
      calculadaEm: agora,
      assinaturaEntrada: assinaturaDaEntrada([]),
    })),
  })
}

export async function registrarVersaoEmQa(
  c: CenarioDeHomologacao,
  rotulo: string,
  issueIds: readonly string[],
  ocorridaEm: Date,
  estado: EstadoImplantacao = 'CONFIRMACAO_MANUAL',
): Promise<string> {
  const versao = await db.versao.create({
    data: {
      projetoId: c.projetoId,
      repositorioId: c.repositorioId,
      commitSha: shaAleatorio(),
      rotulo: `${c.prefixo} ${rotulo}`,
    },
  })
  await db.evidenciaDeploy.create({
    data: {
      ambienteId: c.ambienteQaId,
      versaoId: versao.id,
      origem: 'MANUAL',
      situacao: 'SUCESSO',
      ocorridaEm,
      registradaEm: ocorridaEm,
      autorId: c.adminId,
    },
  })
  await gravarPresencas(c, versao.id, issueIds, estado, ocorridaEm)
  return versao.id
}

export async function criarCenarioDeHomologacao(
  e: EntradaDoCenario,
): Promise<CenarioDeHomologacao> {
  const agora = new Date()
  const titulo = `${e.prefixo} Milestone`
  const milestone = await db.milestone.create({
    data: { projetoId: e.projetoId, titulo, tituloNormalizado: titulo.toLowerCase() },
  })
  await db.milestoneCliente.createMany({
    data: e.clienteIds.map((clienteId) => ({ milestoneId: milestone.id, clienteId })),
  })
  await db.milestoneIssue.createMany({
    data: e.issueIds.map((issueId) => ({
      milestoneId: milestone.id,
      issueId,
      origem: 'MANUAL' as const,
    })),
  })

  const ambiente = await db.ambiente.create({ data: { projetoId: e.projetoId, tipo: 'QA' } })
  const c: CenarioDeHomologacao = {
    ...e,
    milestoneId: milestone.id,
    ambienteQaId: ambiente.id,
    versaoV1Id: '',
    homologacaoPorCliente: {},
    itemPorClienteEIssue: {},
  }
  c.versaoV1Id = await registrarVersaoEmQa(
    c,
    'v1',
    e.issueIds,
    new Date(agora.getTime() - 3_600_000),
  )

  for (const clienteId of e.clienteIds) {
    const homologacao = await db.homologacao.create({
      data: { clienteId, milestoneId: milestone.id },
    })
    c.homologacaoPorCliente[clienteId] = homologacao.id
    for (const issueId of e.issueIds) {
      const entrada = await db.eventoTimeline.create({
        data: {
          clienteId,
          milestoneId: milestone.id,
          issueId,
          tipo: 'ENTRADA_NA_FILA',
          visibilidade: 'INTERNA',
          origem: 'SISTEMA',
          estadoNovo: 'AGUARDANDO_DISPONIBILIZACAO',
        },
      })
      const disponibilizacao = await db.eventoTimeline.create({
        data: {
          clienteId,
          milestoneId: milestone.id,
          issueId,
          versaoId: c.versaoV1Id,
          tipo: 'DISPONIBILIZACAO',
          visibilidade: 'COMPARTILHAVEL',
          origem: 'HUMANO',
          autorId: e.adminId,
          estadoAnterior: 'AGUARDANDO_DISPONIBILIZACAO',
          estadoNovo: 'PENDENTE_DE_TESTE',
          eventoAnteriorId: entrada.id,
        },
      })
      const item = await db.homologacaoItem.create({
        data: {
          homologacaoId: homologacao.id,
          issueId,
          estado: 'PENDENTE_DE_TESTE',
          versaoAvaliadaId: c.versaoV1Id,
          ultimoEventoId: disponibilizacao.id,
        },
      })
      c.itemPorClienteEIssue[`${clienteId}:${issueId}`] = item.id
    }
  }
  return c
}

async function itemDoCenario(c: CenarioDeHomologacao, clienteId: string, issueId: string) {
  const itemId = c.itemPorClienteEIssue[`${clienteId}:${issueId}`]
  if (!itemId) {
    throw new Error('Item não encontrado no cenário.')
  }
  return db.homologacaoItem.findUniqueOrThrow({ where: { id: itemId } })
}

export async function solicitarCorrecaoNoCenario(
  c: CenarioDeHomologacao,
  clienteId: string,
  issueId: string,
  texto: string,
): Promise<string> {
  const item = await itemDoCenario(c, clienteId, issueId)
  const evento = await db.eventoTimeline.create({
    data: {
      clienteId,
      milestoneId: c.milestoneId,
      issueId,
      versaoId: item.versaoAvaliadaId,
      tipo: 'SOLICITACAO_CORRECAO',
      visibilidade: 'COMPARTILHAVEL',
      origem: 'HUMANO',
      autorId: c.adminId,
      texto,
      estadoAnterior: item.estado,
      estadoNovo: 'CORRECAO_SOLICITADA',
      eventoAnteriorId: item.ultimoEventoId,
    },
  })
  await db.homologacaoItem.update({
    where: { id: item.id },
    data: { estado: 'CORRECAO_SOLICITADA', ultimoEventoId: evento.id },
  })
  const solicitacao = await db.solicitacaoDeCorrecao.create({
    data: { itemId: item.id, eventoId: evento.id },
  })
  return solicitacao.id
}

export async function aprovarItemNoCenario(
  c: CenarioDeHomologacao,
  clienteId: string,
  issueId: string,
): Promise<void> {
  const item = await itemDoCenario(c, clienteId, issueId)
  const evento = await db.eventoTimeline.create({
    data: {
      clienteId,
      milestoneId: c.milestoneId,
      issueId,
      versaoId: item.versaoAvaliadaId,
      tipo: 'APROVACAO',
      visibilidade: 'COMPARTILHAVEL',
      origem: 'HUMANO',
      autorId: c.adminId,
      estadoAnterior: item.estado,
      estadoNovo: 'APROVADA',
      eventoAnteriorId: item.ultimoEventoId,
    },
  })
  await db.homologacaoItem.update({
    where: { id: item.id },
    data: { estado: 'APROVADA', ultimoEventoId: evento.id },
  })
}
