import { db } from '@/lib/db'
import { sincronizarDeployments } from '@/modules/ambientes/deployments'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'

export interface EntradaDoCenarioDePublicacao {
  // O cenário principal usa deployments `qa-publicacao`, que só portal e site têm (n = 1 e 3).
  nomeCompleto: 'kustertech-exemplo/portal' | 'kustertech-exemplo/site'
  adminId: string
  nomeDoProjeto?: string
}

export interface CenarioDePublicacao {
  projetoId: string
  repositorioId: string
  acmeId: string
  betaId: string
  milestoneId: string
  issue2Id: string
  versaoBaseId: string
  versaoAlvoId: string
}

const INTERVALO_MS = 600_000

async function clienteComNome(nome: string): Promise<string> {
  const nomeNormalizado = nome.toLowerCase()
  const cliente = await db.cliente.upsert({
    where: { nomeNormalizado },
    create: { nome, nomeNormalizado },
    update: {},
  })
  return cliente.id
}

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

// Pressupõe banco limpo e um usuário administrador já criado.
export async function criarCenarioDePublicacao(
  e: EntradaDoCenarioDePublicacao,
): Promise<CenarioDePublicacao> {
  const agora = new Date()
  const fonte = criarFonteFixtures()
  await sincronizarCatalogo(fonte, agora)

  const nome = e.nomeDoProjeto ?? `Publicação ${e.nomeCompleto.split('/')[1]}`
  const projeto = await db.projeto.create({
    data: { nome, nomeNormalizado: nome.toLowerCase() },
  })
  const acmeId = await clienteComNome('Acme')
  const betaId = await clienteComNome('Beta')
  await db.projetoCliente.createMany({
    data: [acmeId, betaId].map((clienteId) => ({ projetoId: projeto.id, clienteId })),
  })

  const repositorio = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: e.nomeCompleto },
  })
  await db.repositorioGitHub.update({
    where: { id: repositorio.id },
    data: { projetoId: projeto.id, vinculadoEm: agora },
  })
  await sincronizarRepositorio(fonte, repositorio.id, agora)

  const ambienteQa = await db.ambiente.create({
    data: { projetoId: projeto.id, tipo: 'QA', nomeNoGitHub: 'qa-publicacao' },
  })
  const ambienteProd = await db.ambiente.create({
    data: {
      projetoId: projeto.id,
      tipo: 'PROD',
      nomeNoGitHub: 'producao-publicacao',
      criadoEm: new Date('2026-10-11T00:00:00Z'),
    },
  })
  await sincronizarDeployments(fonte, agora, INTERVALO_MS)

  const evidenciaQa = await db.evidenciaDeploy.findFirstOrThrow({
    where: { ambienteId: ambienteQa.id, situacao: 'SUCESSO' },
    orderBy: { ocorridaEm: 'desc' },
  })
  const evidenciaProd = await db.evidenciaDeploy.findFirstOrThrow({
    where: { ambienteId: ambienteProd.id, situacao: 'SUCESSO' },
    orderBy: { ocorridaEm: 'asc' },
  })

  const issue2 = await db.issueGitHub.findFirstOrThrow({
    where: { repositorioId: repositorio.id, numero: 2 },
  })
  const titulo = 'Milestone de publicação'
  const milestone = await db.milestone.create({
    data: { projetoId: projeto.id, titulo, tituloNormalizado: titulo.toLowerCase() },
  })
  await db.milestoneCliente.createMany({
    data: [acmeId, betaId].map((clienteId) => ({ milestoneId: milestone.id, clienteId })),
  })
  await db.milestoneIssue.create({
    data: { milestoneId: milestone.id, issueId: issue2.id, origem: 'MANUAL' },
  })

  for (const [clienteId, aprovada] of [
    [acmeId, true],
    [betaId, false],
  ] as const) {
    await gravarHomologacaoDePublicacao({
      clienteId,
      milestoneId: milestone.id,
      issueId: issue2.id,
      versaoId: evidenciaQa.versaoId,
      adminId: e.adminId,
      aprovada,
    })
  }

  return {
    projetoId: projeto.id,
    repositorioId: repositorio.id,
    acmeId,
    betaId,
    milestoneId: milestone.id,
    issue2Id: issue2.id,
    versaoBaseId: evidenciaProd.versaoId,
    versaoAlvoId: evidenciaQa.versaoId,
  }
}
