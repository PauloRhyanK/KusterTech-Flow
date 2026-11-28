import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Papel } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { temaParaBanco, type Tema } from '@/lib/tema/tema'
import { normalizarNome, validarNomeDeCliente } from '@/modules/clientes/model'
import { hashDoTokenDaFabrica } from '@/modules/fabrica/model'
import { assinaturaDaEntrada, prsMergeadosDaIssue } from '@/modules/ambientes/model'
import { atualizarFilaDeHomologacao } from '@/modules/homologacao/fila'
import { registrarAcaoDeHomologacao } from '@/modules/homologacao/service'
import { obterVersaoCorrenteEmQA } from '@/modules/homologacao/versao-corrente'
import { validarNomeDeProjeto } from '@/modules/projetos/model'
import { criarUsuario } from '@/modules/usuarios/service'
import { MODELO_PADRAO } from '@/modules/demandas/model'
import { criarDemanda, registrarEvento } from '@/modules/demandas/service'
import { idDoAnexo } from '@/modules/relatos/model'
import { PASTA_DOS_ARQUIVOS_E2E } from './arquivos'
import { MAQUINA_LOCAL_E2E } from './oficina'
import { rodarWorkerUmaVez } from './worker'
import { gravarHomologacaoDePublicacao } from '../../tests/support/homologacao-de-publicacao'
import {
  aprovarItemNoCenario,
  criarCenarioDeHomologacao,
  registrarVersaoEmQa,
  solicitarCorrecaoNoCenario,
  type CenarioDeHomologacao,
} from '../../tests/support/cenario-de-homologacao'

export function nomeDeTeste(base: string): string {
  const sufixo = process.env.E2E_SUFIXO || 'teste'
  const idUnico = Math.random().toString(36).slice(2, 8)
  return `E2E ${base} ${sufixo}-${idUnico}`
}

export async function criarUsuarioNoBanco(dados: {
  email: string
  nome: string
  senha: string
  papel: Papel
  clienteId?: string | null
}): Promise<{ id: string }> {
  return criarUsuario({
    email: dados.email,
    nome: dados.nome,
    senha: dados.senha,
    papeis: [{ papel: dados.papel, clienteId: dados.clienteId ?? null }],
  })
}

export async function criarClienteNoBanco(
  nome: string,
  observacoes?: string | null,
): Promise<{ id: string; nome: string }> {
  const nomeValido = validarNomeDeCliente(nome)
  const nomeNormalizado = normalizarNome(nomeValido)
  return db.cliente.create({
    data: {
      nome: nomeValido,
      nomeNormalizado,
      observacoes: observacoes?.trim() || null,
    },
    select: { id: true, nome: true },
  })
}

export async function criarProjetoNoBanco(
  nome: string,
  clientesIds?: string[],
): Promise<{ id: string; nome: string }> {
  const nomeValido = validarNomeDeProjeto(nome)
  const nomeNormalizado = normalizarNome(nomeValido)
  return db.projeto.create({
    data: {
      nome: nomeValido,
      nomeNormalizado,
      clientes:
        clientesIds && clientesIds.length > 0
          ? {
              create: clientesIds.map((clienteId) => ({ clienteId })),
            }
          : undefined,
    },
    select: { id: true, nome: true },
  })
}

export async function associarNoBanco(projetoId: string, clienteId: string): Promise<void> {
  await db.projetoCliente.create({
    data: {
      projetoId,
      clienteId,
    },
  })
}

export async function contarClientes(): Promise<number> {
  return db.cliente.count()
}

export async function contarProjetos(): Promise<number> {
  return db.projeto.count()
}

// Revoga toda fonte da Fábrica ainda ativa, para que nenhum retrato antigo apareça na Central.
export async function revogarFontesDaFabricaNoBanco(): Promise<void> {
  await db.fonteDaFabrica.updateMany({
    where: { revogadaEm: null },
    data: { revogadaEm: new Date() },
  })
}

export async function definirTemaNoBanco(usuarioId: string, tema: Tema): Promise<void> {
  await db.usuario.update({
    where: { id: usuarioId },
    data: { tema: temaParaBanco(tema) },
    select: { id: true },
  })
}

export async function contarUsuarios(): Promise<number> {
  return db.usuario.count()
}

export async function existeUsuarioPorEmail(email: string): Promise<boolean> {
  const usuario = await db.usuario.findUnique({
    where: { email },
    select: { id: true },
  })
  return Boolean(usuario)
}

export function repositoriosDoProjetoE2E(projectName: string): [string, string] {
  return projectName === 'mobile'
    ? ['kustertech-exemplo/site', 'kustertech-exemplo/app-mobile']
    : ['kustertech-exemplo/portal', 'kustertech-exemplo/api']
}

export async function vincularNoBanco(projetoId: string, nomeCompleto: string): Promise<void> {
  const agora = new Date()
  await db.repositorioGitHub.updateMany({
    where: { nomeCompleto },
    data: { projetoId, vinculadoEm: agora, sincronizacaoSolicitadaEm: agora },
  })
}

// Desvincula e devolve a situação de sincronização ao estado de recém-catalogado, para que
// um teste anterior (por exemplo, o que força a última sincronização para o passado) não
// contamine o seguinte. Issues e PRs ficam: o próximo ciclo do worker os reconcilia.
export async function liberarRepositoriosNoBanco(nomes: readonly string[]): Promise<void> {
  await db.repositorioGitHub.updateMany({
    where: { nomeCompleto: { in: [...nomes] } },
    data: {
      projetoId: null,
      vinculadoEm: null,
      sincronizadoEm: null,
      sincronizacaoSolicitadaEm: null,
      ultimaFalhaEm: null,
      ultimaFalhaMotivo: null,
      falhasConsecutivas: 0,
      cursorIssues: null,
      cursorPullRequests: null,
      cursorDeployments: null,
      deploymentsSincronizadosEm: null,
      deploymentsFalhaEm: null,
      deploymentsFalhaMotivo: null,
      warrenLidoEm: null,
      warrenFalhaEm: null,
      warrenFalhaMotivo: null,
      seedsEncontrado: null,
      seedsLinhasInvalidas: 0,
    },
  })
}

// Execuções e seeds do Warren lidas dos repositórios (para o `beforeEach` de quem as consome).
export async function limparExecucoesDosRepositoriosNoBanco(
  nomes: readonly string[],
): Promise<void> {
  const dosRepositorios = { repositorio: { nomeCompleto: { in: [...nomes] } } }
  await db.execucaoAgente.deleteMany({ where: dosRepositorios })
  await db.seedDoRepositorio.deleteMany({ where: dosRepositorios })
}

// Tira o projeto de teste das consultas de projetos ativos (Visão Geral, checklist de configuração).
export async function arquivarProjetoNoBanco(projetoId: string): Promise<void> {
  await db.projeto.updateMany({ where: { id: projetoId }, data: { arquivadoEm: new Date() } })
}

// Arquiva os projetos ativos com repositório vinculado, para que nenhum repositório indisponível
// deixado por outros arquivos apareça como integração em "Espera você".
export async function arquivarProjetosComRepositorioNoBanco(): Promise<void> {
  await db.projeto.updateMany({
    where: { arquivadoEm: null, repositorios: { some: {} } },
    data: { arquivadoEm: new Date() },
  })
}

export function repositorioDeAgentesE2E(projectName: string): string {
  return projectName === 'mobile'
    ? 'kustertech-exemplo/automacao-mobile'
    : 'kustertech-exemplo/automacao'
}

// Runs de exemplo das fixtures do Warren: `run_exemplo000n` (desktop) e `run_exemplo100n` (mobile).
export function runDeExemploE2E(projectName: string, n: 1 | 2 | 3): string {
  return `run_exemplo${projectName === 'mobile' ? '1' : '0'}00${n}`
}

export async function obterExecucaoNoBanco(runId: string): Promise<{ id: string; estado: string }> {
  return db.execucaoAgente.findFirstOrThrow({
    where: { runId },
    select: { id: true, estado: true },
  })
}

export async function definirLeituraWarren(
  nomeCompleto: string,
  leitura: {
    warrenLidoEm?: Date | null
    warrenFalhaEm?: Date | null
    warrenFalhaMotivo?: string | null
  },
): Promise<void> {
  await db.repositorioGitHub.updateMany({ where: { nomeCompleto }, data: leitura })
}

export async function contarExecucoes(): Promise<number> {
  return db.execucaoAgente.count()
}

export async function definirSituacaoDoRepositorio(
  nomeCompleto: string,
  situacao: {
    sincronizadoEm?: Date | null
    ultimaFalhaEm?: Date | null
    ultimaFalhaMotivo?: string | null
  },
): Promise<void> {
  await db.repositorioGitHub.updateMany({ where: { nomeCompleto }, data: situacao })
}

export async function obterRepositorioNoBanco(
  nomeCompleto: string,
): Promise<{ id: string; projetoId: string | null }> {
  return db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto },
    select: { id: true, projetoId: true },
  })
}

export async function contarIssues(): Promise<number> {
  return db.issueGitHub.count()
}

export async function obterIssueNoBanco(
  nomeCompleto: string,
  numero: number,
): Promise<{ id: string }> {
  return db.issueGitHub.findFirstOrThrow({
    where: { numero, repositorio: { nomeCompleto } },
    select: { id: true },
  })
}

export async function criarMilestoneNoBanco(
  projetoId: string,
  titulo: string,
  clientesIds: string[] = [],
): Promise<{ id: string; titulo: string }> {
  return db.milestone.create({
    data: {
      projetoId,
      titulo,
      tituloNormalizado: normalizarNome(titulo),
      clientes: { create: clientesIds.map((clienteId) => ({ clienteId })) },
    },
    select: { id: true, titulo: true },
  })
}

export async function vincularIssuesNoBanco(
  milestoneId: string,
  issueIds: readonly string[],
): Promise<void> {
  await db.milestoneIssue.createMany({
    data: issueIds.map((issueId) => ({ milestoneId, issueId, origem: 'MANUAL' as const })),
    skipDuplicates: true,
  })
}

export async function desvincularIssuesNoBanco(milestoneId: string): Promise<void> {
  await db.milestoneIssue.deleteMany({ where: { milestoneId } })
}

export async function obterMilestoneIssueNoBanco(
  milestoneId: string,
  issueId: string,
): Promise<{
  origem: string
  foraDoEscopo: boolean
  justificativaForaDoEscopo: string | null
} | null> {
  return db.milestoneIssue.findUnique({
    where: { milestoneId_issueId: { milestoneId, issueId } },
    select: { origem: true, foraDoEscopo: true, justificativaForaDoEscopo: true },
  })
}

export async function contarMilestones(projetoId: string): Promise<number> {
  return db.milestone.count({ where: { projetoId } })
}

// Apaga as correções registradas entre issues dos repositórios (original ou correção).
export async function limparVinculosDeIssuesNoBanco(
  nomesDeRepositorio: readonly string[],
): Promise<void> {
  const dosRepositorios = { repositorio: { nomeCompleto: { in: [...nomesDeRepositorio] } } }
  await db.issueVinculo.deleteMany({
    where: { OR: [{ original: dosRepositorios }, { correcao: dosRepositorios }] },
  })
}

// Grava os ambientes como a tela grava, com o efeito de reler o histórico de deployments.
export async function configurarAmbientesNoBanco(
  projetoId: string,
  nomes: Record<'DEV' | 'QA' | 'PROD', string | null> = {
    DEV: 'dev',
    QA: 'qa',
    PROD: 'production',
  },
): Promise<void> {
  for (const tipo of ['DEV', 'QA', 'PROD'] as const) {
    await db.ambiente.upsert({
      where: { projetoId_tipo: { projetoId, tipo } },
      create: { projetoId, tipo, nomeNoGitHub: nomes[tipo] },
      update: { nomeNoGitHub: nomes[tipo] },
    })
  }
  await db.repositorioGitHub.updateMany({
    where: { projetoId },
    data: { cursorDeployments: null, sincronizacaoSolicitadaEm: new Date() },
  })
}

export async function removerAmbientesNoBanco(projetoId: string): Promise<void> {
  await db.ambiente.deleteMany({ where: { projetoId } })
}

export async function contarAmbientes(projetoId: string): Promise<number> {
  return db.ambiente.count({ where: { projetoId } })
}

export async function contarEvidenciasDeDeploy(): Promise<number> {
  return db.evidenciaDeploy.count()
}

export async function contarEvidencias(projetoId: string): Promise<number> {
  return db.evidenciaDeploy.count({ where: { ambiente: { projetoId } } })
}

// Issues criadas pela tarefa `executar-tarefas-github` com a fonte de fixtures: o número vem de
// 100_000 em diante, longe dos números do catálogo.
const NUMERO_DAS_ISSUES_CRIADAS = 100_000

// Apaga a homologação das issues dos repositórios, na ordem das FKs: tarefas do GitHub →
// solicitações → itens → eventos → homologações sem itens → issues criadas pela triagem. A tarefa
// do worker recria os itens a partir das presenças.
export async function limparHomologacaoDosRepositoriosNoBanco(
  nomes: readonly string[],
): Promise<void> {
  const repositorios = { repositorio: { nomeCompleto: { in: [...nomes] } } }
  const dasIssues = { issue: repositorios }
  await db.tarefaGitHub.deleteMany({ where: repositorios })
  await db.solicitacaoDeCorrecao.deleteMany({ where: { item: dasIssues } })
  await db.homologacaoItem.deleteMany({ where: dasIssues })
  // A aprovação da milestone (APROVACAO_MILESTONE) não tem issue: sai junto com a milestone dos repositórios.
  await db.eventoTimeline.deleteMany({
    where: { OR: [dasIssues, { issueId: null, milestone: { issues: { some: dasIssues } } }] },
  })
  await db.homologacao.deleteMany({ where: { itens: { none: {} } } })
  await apagarIssuesCriadasPelaTriagemNoBanco(nomes)
}

async function apagarIssuesCriadasPelaTriagemNoBanco(nomes: readonly string[]): Promise<void> {
  const criadas = {
    numero: { gte: NUMERO_DAS_ISSUES_CRIADAS },
    repositorio: { nomeCompleto: { in: [...nomes] } },
  }
  await db.issueVinculo.deleteMany({
    where: { OR: [{ original: criadas }, { correcao: criadas }] },
  })
  await db.milestoneIssue.deleteMany({ where: { issue: criadas } })
  await db.presencaIssueVersao.deleteMany({ where: { issue: criadas } })
  await db.issueGitHub.deleteMany({ where: criadas })
}

// Apaga presenças, evidências e versões dos repositórios e devolve a leitura de deployments
// ao estado de recém-catalogado.
export async function limparImplantacaoDosRepositoriosNoBanco(
  nomes: readonly string[],
): Promise<void> {
  const dosRepositorios = { repositorio: { nomeCompleto: { in: [...nomes] } } }
  // Composições e autorizações apontam para as versões (FK Restrict): saem antes delas.
  await apagarPublicacaoDosRepositoriosNoBanco(nomes)
  await limparHomologacaoDosRepositoriosNoBanco(nomes)
  await db.presencaIssueVersao.deleteMany({ where: { versao: dosRepositorios } })
  await db.evidenciaDeploy.deleteMany({ where: { versao: dosRepositorios } })
  await db.versao.deleteMany({ where: dosRepositorios })
  await db.repositorioGitHub.updateMany({
    where: { nomeCompleto: { in: [...nomes] } },
    data: {
      cursorDeployments: null,
      deploymentsSincronizadosEm: null,
      deploymentsFalhaEm: null,
      deploymentsFalhaMotivo: null,
    },
  })
}

// Estado da presença de uma issue na versão de rótulo `rotulo` (null quando a linha não existe).
export async function estadoDePresencaNoBanco(
  issueId: string,
  rotulo: string,
): Promise<string | null> {
  const linha = await db.presencaIssueVersao.findFirst({
    where: { issueId, versao: { rotulo } },
    select: { estado: true },
  })
  return linha?.estado ?? null
}

// Desfaz as confirmações manuais de presença: a linha volta a "Verificação necessária".
export async function desfazerConfirmacaoDePresencaNoBanco(issueId: string): Promise<void> {
  await db.presencaIssueVersao.updateMany({
    where: { issueId, confirmadaPorId: { not: null } },
    data: { estado: 'VERIFICACAO_NECESSARIA', confirmadaPorId: null },
  })
}

// Ambiente QA (sem nome no GitHub: o worker não lê deployments dele), uma versão nova com
// deploy manual bem-sucedido agora e presença confirmada manualmente das issues. A presença leva
// `confirmadaPorId` e a assinatura da entrada, para o worker não a recalcular (errata §3.8, item 4).
export async function prepararPresencaEmQANoBanco(
  projetoId: string,
  nomeCompleto: string,
  numeros: readonly number[],
  rotulo: string,
  autorId: string,
): Promise<{ versaoId: string }> {
  const repositorio = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto },
    select: { id: true },
  })
  const ambiente = await db.ambiente.upsert({
    where: { projetoId_tipo: { projetoId, tipo: 'QA' } },
    create: { projetoId, tipo: 'QA' },
    update: {},
    select: { id: true },
  })
  const agora = new Date()
  const commitSha = randomBytes(20).toString('hex')
  const versao = await db.versao.create({
    data: { projetoId, repositorioId: repositorio.id, commitSha, rotulo },
    select: { id: true },
  })
  await db.evidenciaDeploy.create({
    data: {
      ambienteId: ambiente.id,
      versaoId: versao.id,
      origem: 'MANUAL',
      situacao: 'SUCESSO',
      ocorridaEm: agora,
      registradaEm: agora,
      autorId,
    },
  })
  const prs = await db.pullRequestGitHub.findMany({
    where: { repositorioId: repositorio.id },
    select: { numero: true, estado: true, issuesReferenciadas: true, shaMerge: true },
  })
  for (const numero of numeros) {
    const issue = await db.issueGitHub.findFirstOrThrow({
      where: { repositorioId: repositorio.id, numero },
      select: { id: true },
    })
    await db.presencaIssueVersao.create({
      data: {
        issueId: issue.id,
        versaoId: versao.id,
        estado: 'CONFIRMACAO_MANUAL',
        motivo: 'Confirmação manual do E2E',
        confirmadaPorId: autorId,
        calculadaEm: agora,
        assinaturaEntrada: assinaturaDaEntrada(prsMergeadosDaIssue(numero, prs)),
      },
    })
  }
  return { versaoId: versao.id }
}

export async function atualizarFilaNoBanco(): Promise<number> {
  return (await atualizarFilaDeHomologacao(new Date())).itensCriados
}

// Disponibiliza como o admin, com o evento e a versão atuais (o que a tela enviaria).
export async function disponibilizarNoBanco(itemId: string, adminId: string): Promise<void> {
  const item = await db.homologacaoItem.findUniqueOrThrow({
    where: { id: itemId },
    select: {
      issueId: true,
      ultimoEventoId: true,
      issue: { select: { repositorioId: true } },
      homologacao: {
        select: { clienteId: true, milestoneId: true, milestone: { select: { projetoId: true } } },
      },
    },
  })
  const corrente = await obterVersaoCorrenteEmQA(
    item.homologacao.milestone.projetoId,
    item.issue.repositorioId,
  )
  await registrarAcaoDeHomologacao(
    { usuarioId: adminId, papeis: [{ papel: 'ADMIN', clienteId: null }] },
    {
      acao: 'DISPONIBILIZAR',
      itemId,
      clienteId: item.homologacao.clienteId,
      milestoneId: item.homologacao.milestoneId,
      issueId: item.issueId,
      versaoId: corrente?.id ?? null,
      ultimoEventoId: item.ultimoEventoId,
      texto: null,
      visibilidade: 'COMPARTILHAVEL',
    },
  )
}

export async function obterItemDeHomologacaoNoBanco(
  clienteId: string,
  milestoneId: string,
  nomeCompleto: string,
  numero: number,
): Promise<{ id: string; estado: string; ultimoEventoId: string | null } | null> {
  return db.homologacaoItem.findFirst({
    where: {
      homologacao: { clienteId, milestoneId },
      issue: { numero, repositorio: { nomeCompleto } },
    },
    select: { id: true, estado: true, ultimoEventoId: true },
  })
}

export async function contarEventosDeTimeline(clienteId: string): Promise<number> {
  return db.eventoTimeline.count({ where: { clienteId } })
}

// Acme e Beta no mesmo projeto e na mesma milestone, com as issues #1, #2 e #4 do primeiro
// repositório e #1 do segundo; QA com a versão "E2E qa-1" e presença das #1 e #2 do primeiro.
// A tarefa do worker cria os 4 itens (#1 e #2 × Acme e Beta), todos aguardando disponibilização.
export async function prepararCenarioDeHomologacaoE2E(
  projectName: string,
  autorId: string,
  opcoes: { atualizarFila?: boolean } = {},
) {
  const [repoUm, repoDois] = repositoriosDoProjetoE2E(projectName)
  const acme = await criarClienteNoBanco(nomeDeTeste('Acme'))
  const beta = await criarClienteNoBanco(nomeDeTeste('Beta'))
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Homologação'), [acme.id, beta.id])
  await vincularNoBanco(projeto.id, repoUm)
  await vincularNoBanco(projeto.id, repoDois)
  rodarWorkerUmaVez()

  const issueUm1 = await obterIssueNoBanco(repoUm, 1)
  const issueUm2 = await obterIssueNoBanco(repoUm, 2)
  const issueUm4 = await obterIssueNoBanco(repoUm, 4)
  const issueDois1 = await obterIssueNoBanco(repoDois, 1)
  const milestone = await criarMilestoneNoBanco(projeto.id, nomeDeTeste('Release 1'), [
    acme.id,
    beta.id,
  ])
  await vincularIssuesNoBanco(milestone.id, [issueUm1.id, issueUm2.id, issueUm4.id, issueDois1.id])
  const { versaoId } = await prepararPresencaEmQANoBanco(
    projeto.id,
    repoUm,
    [1, 2],
    'E2E qa-1',
    autorId,
  )
  // Sem atualizar a fila aqui, quem chama prova a tarefa do ciclo com rodarWorkerUmaVez().
  const itensCriados = opcoes.atualizarFila === false ? 0 : await atualizarFilaNoBanco()
  return {
    acme,
    beta,
    projeto,
    milestone,
    repoUm,
    repoDois,
    issueUm1,
    issueUm2,
    issueUm4,
    versaoId,
    itensCriados,
  }
}

export async function contarSolicitacoesAbertasNoBanco(milestoneId: string): Promise<number> {
  return db.solicitacaoDeCorrecao.count({
    where: { estado: 'ABERTA', item: { homologacao: { milestoneId } } },
  })
}

export interface HomologacaoE2E {
  projetoId: string
  clienteAId: string
  clienteBId: string
  clienteANome: string
  clienteBNome: string
  milestoneId: string
  repositorio: string
  issues: { n2: string; n4: string }
  versaoV1Id: string
  cenario: CenarioDeHomologacao
}

// Dois clientes (A e B) numa milestone com as issues #2 (aberta) e #4 (fechada) do primeiro
// repositório do projeto, ambas já disponibilizadas e pendentes de teste (cenário de integração).
export async function prepararHomologacaoE2E(
  projectName: string,
  adminId: string,
): Promise<HomologacaoE2E> {
  const repositorios = repositoriosDoProjetoE2E(projectName)
  await liberarRepositoriosNoBanco(repositorios)
  await limparImplantacaoDosRepositoriosNoBanco(repositorios)
  const [repositorio] = repositorios
  const clienteA = await criarClienteNoBanco(nomeDeTeste('Cliente A'))
  const clienteB = await criarClienteNoBanco(nomeDeTeste('Cliente B'))
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Homologação'), [
    clienteA.id,
    clienteB.id,
  ])
  await vincularNoBanco(projeto.id, repositorio)
  rodarWorkerUmaVez()

  const n2 = await obterIssueNoBanco(repositorio, 2)
  const n4 = await obterIssueNoBanco(repositorio, 4)
  const cenario = await criarCenarioDeHomologacao({
    projetoId: projeto.id,
    repositorioId: (await obterRepositorioNoBanco(repositorio)).id,
    issueIds: [n2.id, n4.id],
    clienteIds: [clienteA.id, clienteB.id],
    adminId,
    prefixo: nomeDeTeste('Cenário'),
  })
  return {
    projetoId: projeto.id,
    clienteAId: clienteA.id,
    clienteBId: clienteB.id,
    clienteANome: clienteA.nome,
    clienteBNome: clienteB.nome,
    milestoneId: cenario.milestoneId,
    repositorio,
    issues: { n2: n2.id, n4: n4.id },
    versaoV1Id: cenario.versaoV1Id,
    cenario,
  }
}

// Remove a homologação, as tarefas do GitHub e as issues criadas pela triagem nos repositórios
// de exemplo (para o `beforeEach` dos arquivos que dependem de estado limpo).
export async function apagarHomologacaoE2E(): Promise<void> {
  await limparHomologacaoDosRepositoriosNoBanco(
    (
      await db.repositorioGitHub.findMany({
        where: { nomeCompleto: { startsWith: 'kustertech-exemplo/' } },
        select: { nomeCompleto: true },
      })
    ).map((r) => r.nomeCompleto),
  )
}

export async function solicitarCorrecaoNoBanco(
  e: HomologacaoE2E,
  clienteId: string,
  issueId: string,
  texto: string,
): Promise<string> {
  return solicitarCorrecaoNoCenario(e.cenario, clienteId, issueId, texto)
}

export async function aprovarItemNoBanco(
  e: HomologacaoE2E,
  clienteId: string,
  issueId: string,
): Promise<void> {
  await aprovarItemNoCenario(e.cenario, clienteId, issueId)
}

// Sem argumento conta as tarefas de todos os repositórios de exemplo; os projetos `desktop` e
// `mobile` usam repositórios diferentes, então os testes passam o do seu projeto.
export async function contarTarefasGitHub(nomeCompleto?: string): Promise<number> {
  return db.tarefaGitHub.count({
    where: {
      repositorio: nomeCompleto
        ? { nomeCompleto }
        : { nomeCompleto: { startsWith: 'kustertech-exemplo/' } },
    },
  })
}

export async function definirTarefaNoBanco(
  id: string,
  dados: { estado: 'PENDENTE' | 'CONCLUIDA' | 'FALHOU'; falhaMotivo?: string | null },
): Promise<void> {
  await db.tarefaGitHub.update({
    where: { id },
    data: {
      estado: dados.estado,
      falhaMotivo: dados.falhaMotivo ?? null,
      concluidaEm: dados.estado === 'PENDENTE' ? null : new Date(),
    },
  })
}

export async function obterTarefaDaSolicitacao(
  solicitacaoId: string,
): Promise<{ id: string; tipo: string; estado: string; falhaMotivo: string | null } | null> {
  return db.tarefaGitHub.findFirst({
    where: { solicitacaoId },
    orderBy: { criadaEm: 'desc' },
    select: { id: true, tipo: true, estado: true, falhaMotivo: true },
  })
}

export async function obterItemNoBanco(
  clienteId: string,
  issueId: string,
): Promise<{ id: string; estado: string; ultimoEventoId: string | null }> {
  return db.homologacaoItem.findFirstOrThrow({
    where: { issueId, homologacao: { clienteId } },
    select: { id: true, estado: true, ultimoEventoId: true },
  })
}

export async function contarEventosNoBanco(clienteId: string, issueId: string): Promise<number> {
  return db.eventoTimeline.count({ where: { clienteId, issueId } })
}

// Devolve a solicitação ao estado de recém-solicitada (sem tarefas nem triagem), para repetir uma
// requisição capturada contra o mesmo registro.
export async function restaurarSolicitacaoNoBanco(solicitacaoId: string): Promise<void> {
  await db.tarefaGitHub.deleteMany({ where: { solicitacaoId } })
  await db.solicitacaoDeCorrecao.update({
    where: { id: solicitacaoId },
    data: { estado: 'ABERTA', triadaEm: null, triadaPorId: null },
  })
}

export async function obterSolicitacaoNoBanco(
  solicitacaoId: string,
): Promise<{ estado: string; triadaEm: Date | null }> {
  return db.solicitacaoDeCorrecao.findUniqueOrThrow({
    where: { id: solicitacaoId },
    select: { estado: true, triadaEm: true },
  })
}

// Fecha a issue no banco, como se o GitHub a tivesse fechado. Só depois do último
// `rodarWorkerUmaVez()` que reconcilia o repositório: o repositório só volta a ficar devido após
// 10 min, e a reconciliação devolveria a issue ao estado das fixtures.
export async function fecharIssueNoBanco(
  issueId: string,
  fechadaEm: Date = new Date(),
): Promise<void> {
  await db.issueGitHub.update({
    where: { id: issueId },
    data: { estado: 'FECHADA', fechadaNoGitHub: fechadaEm, atualizadaNoGitHub: fechadaEm },
  })
}

// Nova versão em QA agora, com evidência manual e presença confirmada pelo admin do cenário.
export async function registrarVersaoEmQaNoBanco(
  cenario: CenarioDeHomologacao,
  rotulo: string,
  issueIds: readonly string[],
): Promise<string> {
  return registrarVersaoEmQa(cenario, rotulo, issueIds, new Date())
}

// Issue de correção criada pela tarefa do worker para a issue original (a de maior número).
export async function obterCorrecaoCriadaNoBanco(
  issueOriginalId: string,
): Promise<{ id: string; numero: number } | null> {
  const vinculo = await db.issueVinculo.findFirst({
    where: { issueOriginalId },
    orderBy: { correcao: { numero: 'desc' } },
    select: { correcao: { select: { id: true, numero: true } } },
  })
  return vinculo?.correcao ?? null
}

export async function obterEstadoDaHomologacaoNoBanco(
  clienteId: string,
  milestoneId: string,
): Promise<{ estado: string; aprovadaPorId: string | null; eventosDeAprovacao: number }> {
  const h = await db.homologacao.findUniqueOrThrow({
    where: { clienteId_milestoneId: { clienteId, milestoneId } },
    select: { estado: true, aprovadaPorId: true },
  })
  const eventosDeAprovacao = await db.eventoTimeline.count({
    where: { clienteId, milestoneId, tipo: 'APROVACAO_MILESTONE' },
  })
  return { ...h, eventosDeAprovacao }
}

// Publicação (Incremento 6)

// Ambientes QA e PROD como o cenário de publicação os grava: nomes dos deployments de 6.2 e PROD
// criado em 11/10/2026, depois do primeiro deploy das fixtures (que não conta como divergência).
export async function configurarAmbientesDePublicacaoNoBanco(
  projetoId: string,
): Promise<{ qaId: string; prodId: string }> {
  const qa = await db.ambiente.upsert({
    where: { projetoId_tipo: { projetoId, tipo: 'QA' } },
    create: { projetoId, tipo: 'QA', nomeNoGitHub: 'qa-publicacao' },
    update: { nomeNoGitHub: 'qa-publicacao' },
  })
  const criadoEm = new Date('2026-10-11T00:00:00Z')
  const prod = await db.ambiente.upsert({
    where: { projetoId_tipo: { projetoId, tipo: 'PROD' } },
    create: { projetoId, tipo: 'PROD', nomeNoGitHub: 'producao-publicacao', criadoEm },
    update: { nomeNoGitHub: 'producao-publicacao', criadoEm },
  })
  await db.repositorioGitHub.updateMany({
    where: { projetoId },
    data: { cursorDeployments: null, sincronizacaoSolicitadaEm: new Date() },
  })
  return { qaId: qa.id, prodId: prod.id }
}

export async function aprovarHomologacaoNoBanco(e: {
  clienteId: string
  milestoneId: string
  issueId: string
  versaoId: string
  autorId: string
}): Promise<void> {
  await gravarHomologacaoDePublicacao({ ...e, adminId: e.autorId, aprovada: true })
}

export async function deixarHomologacaoPendenteNoBanco(e: {
  clienteId: string
  milestoneId: string
  issueId: string
  versaoId: string
  autorId?: string
}): Promise<void> {
  await gravarHomologacaoDePublicacao({ ...e, adminId: e.autorId, aprovada: false })
}

export async function obterVersaoNoBanco(
  nomeCompleto: string,
  commitSha: string,
): Promise<{ id: string; rotulo: string }> {
  return db.versao.findFirstOrThrow({
    where: { commitSha, repositorio: { nomeCompleto } },
    select: { id: true, rotulo: true },
  })
}

export async function contarAutorizacoesProd(nomeCompleto: string): Promise<number> {
  return db.autorizacaoProd.count({ where: { repositorio: { nomeCompleto } } })
}

export async function contarEvidenciasProd(nomeCompleto: string): Promise<number> {
  return db.evidenciaDeploy.count({
    where: { ambiente: { tipo: 'PROD' }, versao: { repositorio: { nomeCompleto } } },
  })
}

// Desfaz as autorizações (e seus itens) de um repositório, mantendo as composições, para repetir uma
// requisição capturada contra o mesmo estado.
export async function apagarAutorizacoesNoBanco(nomeCompleto: string): Promise<void> {
  const doRepositorio = { repositorio: { nomeCompleto } }
  await db.autorizacaoItem.deleteMany({ where: { autorizacao: doRepositorio } })
  await db.autorizacaoProd.deleteMany({ where: doRepositorio })
}

// Apaga, na ordem das FKs, o que a publicação grava para os repositórios: itens e autorizações,
// composições, divergências e verificações.
export async function apagarPublicacaoDosRepositoriosNoBanco(
  nomes: readonly string[],
): Promise<void> {
  const dosRepositorios = { repositorio: { nomeCompleto: { in: [...nomes] } } }
  await db.autorizacaoItem.deleteMany({ where: { autorizacao: dosRepositorios } })
  await db.autorizacaoProd.deleteMany({ where: dosRepositorios })
  await db.composicaoDePublicacao.deleteMany({ where: dosRepositorios })
  await db.divergenciaDeDeploy.deleteMany({ where: { versao: dosRepositorios } })
  await db.verificacaoProd.deleteMany({ where: { versao: dosRepositorios } })
}

// Limpeza completa de um cenário de publicação: publicação, homologação (5b/5a/3), presenças,
// evidências, versões e, por fim, os repositórios voltam a ficar sem projeto.
export async function limparPublicacaoE2E(nomes: readonly string[]): Promise<void> {
  await limparImplantacaoDosRepositoriosNoBanco(nomes)
  await liberarRepositoriosNoBanco(nomes)
}

// Deploy em PROD feito pelo pipeline do projeto, sem passar pela Central: a evidência chega pelo
// endpoint, no momento da chamada (simula o pipeline publicando; invariante 7).
export async function registrarDeployProdNoBanco(
  projetoId: string,
  nomeCompleto: string,
  commitSha: string,
): Promise<void> {
  const repositorio = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto, projetoId },
    select: { id: true },
  })
  const prod = await db.ambiente.findUniqueOrThrow({
    where: { projetoId_tipo: { projetoId, tipo: 'PROD' } },
    select: { id: true },
  })
  const versao = await db.versao.upsert({
    where: { repositorioId_commitSha: { repositorioId: repositorio.id, commitSha } },
    create: {
      projetoId,
      repositorioId: repositorio.id,
      commitSha,
      rotulo: `E2E ${commitSha.slice(0, 7)}`,
    },
    update: {},
  })
  const agora = new Date()
  await db.evidenciaDeploy.create({
    data: {
      ambienteId: prod.id,
      versaoId: versao.id,
      origem: 'ENDPOINT',
      situacao: 'SUCESSO',
      ocorridaEm: agora,
      registradaEm: agora,
      idExterno: `e2e-${randomBytes(6).toString('hex')}`,
    },
  })
}

export async function obterDivergenciasNoBanco(
  nomeCompleto: string,
): Promise<{ id: string; commitSha: string; reconhecidaEm: Date | null }[]> {
  const divergencias = await db.divergenciaDeDeploy.findMany({
    where: { versao: { repositorio: { nomeCompleto } } },
    select: { id: true, reconhecidaEm: true, versao: { select: { commitSha: true } } },
    orderBy: { detectadaEm: 'asc' },
  })
  return divergencias.map((d) => ({
    id: d.id,
    commitSha: d.versao.commitSha,
    reconhecidaEm: d.reconhecidaEm,
  }))
}

export async function contarVerificacoesProd(nomeCompleto: string): Promise<number> {
  return db.verificacaoProd.count({ where: { versao: { repositorio: { nomeCompleto } } } })
}

// Desfaz o reconhecimento para repetir a requisição capturada contra o mesmo estado.
export async function desfazerReconhecimentoNoBanco(divergenciaId: string): Promise<void> {
  await db.divergenciaDeDeploy.update({
    where: { id: divergenciaId },
    data: { reconhecidaPorId: null, reconhecidaEm: null },
  })
}

export async function criarRecursoNoBanco(d: {
  tipo: 'SERVIDOR' | 'CONTAINER' | 'BANCO' | 'STORAGE' | 'OUTRO'
  nome: string
  hospedadoEmId?: string
  provedor?: string
  endereco?: string
  especificacao?: string
  custoMensal?: string
  projetosIds?: string[]
}): Promise<{ id: string; nome: string }> {
  return db.recurso.create({
    data: {
      tipo: d.tipo,
      nome: d.nome,
      nomeNormalizado: normalizarNome(d.nome),
      hospedadoEmId: d.hospedadoEmId ?? null,
      provedor: d.provedor ?? null,
      endereco: d.endereco ?? null,
      especificacao: d.especificacao ?? null,
      custoMensal: d.custoMensal ?? null,
      projetos: d.projetosIds?.length
        ? { create: d.projetosIds.map((projetoId) => ({ projetoId })) }
        : undefined,
    },
    select: { id: true, nome: true },
  })
}

export async function contarRecursos(): Promise<number> {
  return db.recurso.count()
}

export async function removerRecursoNoBanco(recursoId: string): Promise<void> {
  await db.recursoProjeto.deleteMany({ where: { recursoId } })
  await db.recurso.delete({ where: { id: recursoId } })
}

export async function obterRecursoNoBanco(
  nome: string,
): Promise<{ id: string; nome: string } | null> {
  return db.recurso.findFirst({ where: { nome }, select: { id: true, nome: true } })
}

export async function contarEventosDeWebhook(deliveryId: string): Promise<number> {
  return db.eventoIntegracao.count({ where: { deliveryId } })
}

export async function githubIdDoRepositorioNoBanco(nomeCompleto: string): Promise<number> {
  const repositorio = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto },
    select: { githubId: true },
  })
  return Number(repositorio.githubId)
}

// Deixa a issue como se o espelho estivesse velho: aberta, com `titulo` e sem data de fechamento.
// Zera `cursorIssues` para que a próxima sincronização releia a fixture inteira.
export async function envelhecerIssueNoBanco(
  nomeCompleto: string,
  numero: number,
  titulo: string,
): Promise<void> {
  const repositorio = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto },
    select: { id: true },
  })
  await db.issueGitHub.updateMany({
    where: { repositorioId: repositorio.id, numero },
    data: { estado: 'ABERTA', titulo, fechadaNoGitHub: null },
  })
  await db.repositorioGitHub.update({
    where: { id: repositorio.id },
    data: { cursorIssues: null },
  })
}

// A máquina cujo identificador externo é o FLOW_MAQUINA_LOCAL do E2E. O nome "E2E " a
// coloca na limpeza do setup global.
export async function garantirMaquinaLocalNoBanco(): Promise<{ id: string }> {
  const nome = 'E2E Oficina local'
  return db.recurso.upsert({
    where: { identificadorExterno: MAQUINA_LOCAL_E2E },
    update: {},
    create: {
      tipo: 'SERVIDOR',
      nome,
      nomeNormalizado: normalizarNome(nome),
      identificadorExterno: MAQUINA_LOCAL_E2E,
      provedor: 'Própria',
      endereco: 'oficina.exemplo.test',
      especificacao: 'i5 · 8 GB · SSD 120 GB',
    },
    select: { id: true },
  })
}

// Fila de publicação: o repositório com cabeça, execuções e comparações nas fixtures do GitHub
// (Task 3). Desktop usa o portal (prefixo `ca`), mobile o site (prefixo `cb`).
export function repositorioDePublicacaoE2E(projectName: string): string {
  return projectName === 'mobile' ? 'kustertech-exemplo/site' : 'kustertech-exemplo/portal'
}

// BASE ← NOVO ← QUEBRA em main; ANTIGO também está em main, mas não contém NOVO. A execução de
// QUEBRA falha; as demais passam.
export function commitsDePublicacaoE2E(projectName: string): {
  BASE: string
  NOVO: string
  ANTIGO: string
  QUEBRA: string
} {
  const h = (n: number) => `${projectName === 'mobile' ? 'cb' : 'ca'}${'0'.repeat(37)}${n}`
  return { BASE: h(1), NOVO: h(2), ANTIGO: h(3), QUEBRA: h(4) }
}

// Apaga consertos, pedidos e configurações dos repositórios de exemplo, as fontes de publicação
// do E2E e a pausa geral: cada teste começa com a fila vazia.
export async function limparPublicacaoNoBanco(): Promise<void> {
  const dosExemplos = { repositorio: { nomeCompleto: { startsWith: 'kustertech-exemplo/' } } }
  await db.pedidoDeConserto.deleteMany({ where: dosExemplos })
  await db.pedidoDePublicacao.deleteMany({ where: dosExemplos })
  await db.configuracaoDePublicacao.deleteMany({ where: dosExemplos })
  await db.fonteDePublicacao.deleteMany({ where: { nome: { startsWith: 'E2E ' } } })
  await db.pausaGeralDePublicacao.deleteMany({})
}

// Vincula o repositório ao projeto e grava a configuração de publicação (workflow `deploy.yml`).
export async function configurarPublicacaoNoBanco(
  projetoId: string,
  nomeCompleto: string,
  opcoes: { horaDoLote?: string; modoPadrao?: 'IMEDIATO' | 'LOTE' } = {},
): Promise<{ repositorioId: string }> {
  await vincularNoBanco(projetoId, nomeCompleto)
  const repositorio = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto },
    select: { id: true },
  })
  const dados = {
    workflow: 'deploy.yml',
    horaDoLote: opcoes.horaDoLote ?? '22:00',
    modoPadrao: opcoes.modoPadrao ?? 'IMEDIATO',
  }
  await db.configuracaoDePublicacao.upsert({
    where: { repositorioId: repositorio.id },
    update: dados,
    create: { repositorioId: repositorio.id, ...dados },
  })
  return { repositorioId: repositorio.id }
}

// Uma fonte de publicação criada pelo admin do E2E; o token volta só aqui, como na tela.
export async function criarFonteDePublicacaoNoBanco(nome: string): Promise<string> {
  const criadaPorId = process.env.E2E_ADMIN_ID
  if (!criadaPorId) throw new Error('E2E_ADMIN_ID não configurada pelo setup.')
  const token = `fp_${randomBytes(32).toString('base64url')}`
  await db.fonteDePublicacao.create({
    data: { nome, tokenHash: hashDoTokenDaFabrica(token), criadaPorId },
  })
  return token
}

// Só para as capturas: um pedido gravado direto no estado pedido, sem passar pelo worker.
export async function semearPedidoDePublicacaoNoBanco(
  repositorioId: string,
  dados: {
    commit: string
    descricao: string
    estado: 'NA_FILA' | 'PUBLICANDO' | 'PUBLICADO'
    modo?: 'IMEDIATO' | 'LOTE'
    checks?: 'SUCESSO' | 'FALHA' | 'SEM_CHECKS'
    minutosAtras?: number
    /** Só para PUBLICADO: quanto a publicação levou (alimenta o "costuma levar"). */
    duracaoMin?: number
  },
): Promise<void> {
  const em = new Date(Date.now() - (dados.minutosAtras ?? 0) * 60_000)
  const inicio = new Date(em.getTime() - (dados.duracaoMin ?? 0) * 60_000)
  await db.pedidoDePublicacao.create({
    data: {
      repositorioId,
      commit: dados.commit,
      descricao: dados.descricao,
      modo: dados.modo ?? 'IMEDIATO',
      estado: dados.estado,
      checks: dados.checks ?? 'SUCESSO',
      criadoEm: em,
      iniciadoEm: dados.estado === 'NA_FILA' ? null : dados.estado === 'PUBLICADO' ? inicio : em,
      concluidoEm: dados.estado === 'PUBLICADO' ? em : null,
    },
  })
}

// Projetos que este processo de teste mostrou com nome curto, com o nome "E2E …" original.
const exibidosComoNoBanco = new Map<string, string>()

// Demandas dos repositórios de exemplo (eventos e arquivos saem em cascata; os arquivos em disco
// ficam na pasta temporária do E2E). Os projetos que o teste mostrou como "Projeto Alfa" voltam ao
// nome "E2E …" e são arquivados, para o setup global apagá-los.
export async function limparDemandasNoBanco(): Promise<void> {
  const dosExemplos = { repositorio: { nomeCompleto: { startsWith: 'kustertech-exemplo/' } } }
  await db.pedidoDePublicacao.updateMany({
    where: { demanda: dosExemplos },
    data: { demandaId: null },
  })
  await db.demanda.deleteMany({ where: dosExemplos })
  // Relatos e sistemas conectados dos repositórios de exemplo (FK RESTRICT no sistema e no projeto).
  await db.relato.deleteMany({ where: { sistema: dosExemplos } })
  await db.sistemaConectado.deleteMany({ where: dosExemplos })
  for (const [id, nome] of exibidosComoNoBanco) {
    await db.projeto.updateMany({ where: { id }, data: { nome, arquivadoEm: new Date() } })
    exibidosComoNoBanco.delete(id)
  }
}

// Projeto de teste (criado com nome "E2E …") mostrado com um nome curto nas capturas; o normalizado
// continua único e `limparDemandasNoBanco` devolve o nome original.
export async function exibirProjetoComoNoBanco(projetoId: string, nome: string): Promise<void> {
  const atual = await db.projeto.findUniqueOrThrow({
    where: { id: projetoId },
    select: { nome: true },
  })
  if (!atual.nome.startsWith('E2E ')) throw new Error('Só projetos de teste ("E2E …").')
  exibidosComoNoBanco.set(projetoId, atual.nome)
  await db.projeto.update({ where: { id: projetoId }, data: { nome } })
}

// Fonte de demandas (`fd_`) criada pelo admin do E2E; o token volta só aqui, como na tela.
export async function criarFonteDeDemandasNoBanco(nome: string): Promise<string> {
  const criadaPorId = process.env.E2E_ADMIN_ID
  if (!criadaPorId) throw new Error('E2E_ADMIN_ID não configurada pelo setup.')
  const token = `fd_${randomBytes(32).toString('base64url')}`
  await db.fonteDeDemandas.create({
    data: { nome, tokenHash: hashDoTokenDaFabrica(token), criadaPorId },
  })
  return token
}

// Fonte da Fábrica (`ff_`) criada pelo admin do E2E, para simular a Fábrica pela API.
export async function criarFonteDaFabricaNoBanco(nome: string): Promise<string> {
  const criadaPorId = process.env.E2E_ADMIN_ID
  if (!criadaPorId) throw new Error('E2E_ADMIN_ID não configurada pelo setup.')
  const token = `ff_${randomBytes(32).toString('base64url')}`
  await db.fonteDaFabrica.create({
    data: { nome, tokenHash: hashDoTokenDaFabrica(token), criadaPorId },
  })
  return token
}

const BASE_GITHUB_ID_ATIVIDADE = BigInt(9_200_000_000)

// Dois repositórios próprios do teste de Atividade, vinculados ao projeto, com PRs recentes.
// Esperado na linha do projeto: 4 mergeados hoje e 2 abertos.
export async function semearAtividadeNoBanco(
  projetoId: string,
  projectName: string,
  agora: Date,
): Promise<void> {
  const atras = (minutos: number): Date => new Date(agora.getTime() - minutos * 60_000)
  const repos = [
    {
      sufixo: 'um',
      prs: [
        { estado: 'MERGEADO', min: 12, branch: 'claude/x', titulo: 'Corrige PDF cortado' },
        { estado: 'MERGEADO', min: 40, branch: 'warren/run_1', titulo: 'Ajusta o cadastro' },
        { estado: 'MERGEADO', min: 180, branch: 'feat/x', titulo: 'Nova tela de relatórios' },
        { estado: 'ABERTO', min: 5, branch: 'claude/aberto-um', titulo: 'Em revisão um' },
      ],
    },
    {
      sufixo: 'dois',
      prs: [
        { estado: 'MERGEADO', min: 60, branch: 'claude/y', titulo: 'Melhora a busca' },
        { estado: 'ABERTO', min: 8, branch: 'feat/aberto-dois', titulo: 'Em revisão dois' },
        { estado: 'MERGEADO', min: 30 * 60, branch: 'feat/antigo', titulo: 'Entrega antiga' },
      ],
    },
  ] as const

  let seq = 0
  for (const [i, repo] of repos.entries()) {
    const nomeCompleto = `kustertech-exemplo/atividade-${projectName}-${repo.sufixo}`
    const base =
      BASE_GITHUB_ID_ATIVIDADE + BigInt(projectName === 'mobile' ? 1000 : 0) + BigInt(i * 100)
    const criado = await db.repositorioGitHub.create({
      data: {
        githubId: base,
        instalacaoId: BigInt(1),
        nomeCompleto,
        urlHtml: `https://github.com/${nomeCompleto}`,
        privado: true,
        projetoId,
        vinculadoEm: agora,
        sincronizadoEm: agora,
        catalogadoEm: agora,
      },
      select: { id: true },
    })
    for (const [n, pr] of repo.prs.entries()) {
      seq += 1
      const quando = atras(pr.min)
      await db.pullRequestGitHub.create({
        data: {
          githubId: base + BigInt(1 + n),
          repositorioId: criado.id,
          numero: n + 1,
          titulo: pr.titulo,
          estado: pr.estado,
          rascunho: false,
          urlHtml: `https://github.com/${nomeCompleto}/pull/${n + 1}`,
          branch: pr.branch,
          shaHead: `sha${seq}`,
          issuesReferenciadas: [],
          atualizadoNoGitHub: quando,
          mergeadoNoGitHub: pr.estado === 'MERGEADO' ? quando : null,
          criadoNoGitHub: quando,
          sincronizadoEm: agora,
        },
      })
    }
  }
}

export async function limparAtividadeNoBanco(): Promise<void> {
  const repositorio = { githubId: { gte: BASE_GITHUB_ID_ATIVIDADE } }
  await db.pullRequestGitHub.deleteMany({ where: { repositorio } })
  await db.repositorioGitHub.deleteMany({ where: repositorio })
}

// Decidir

// Conversas do Decidir dos repositórios de exemplo (mensagens, anexos e cartões saem em cascata).
export async function limparConversasNoBanco(): Promise<void> {
  await db.conversa.deleteMany({ where: { repositorio: { startsWith: 'kustertech-exemplo/' } } })
}

export interface TriagemDeTeste {
  tipo: 'defeito' | 'ideia' | 'ajuste' | 'funcao_nova'
  tamanho: 'pequeno' | 'medio' | 'grande'
  mexeEm: string
  motivo: string
}

// Uma demanda criada como a tela cria e triada pela Fábrica até esperar o Paulo no destino:
// com `triagem`, a triagem pede a decisão dele (pedido); com `null`, a triagem falhou (sem tipo).
export async function criarDemandaEsperandoNoBanco(
  projetoId: string,
  repo: string,
  e: {
    titulo: string
    descricao?: string | null
    espera: 'decidir_destino'
    triagem: TriagemDeTeste | null
  },
): Promise<{ id: string }> {
  const usuarioId = process.env.E2E_ADMIN_ID
  if (!usuarioId) throw new Error('E2E_ADMIN_ID não configurada pelo setup.')
  const repositorio = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: repo },
    select: { id: true },
  })
  const { id } = await criarDemanda(
    { usuarioId, papeis: [{ papel: 'ADMIN', clienteId: null }] },
    {
      projetoId,
      repositorioId: repositorio.id,
      titulo: e.titulo,
      descricao: e.descricao ?? null,
      nivel: 'aprovar_desenho',
      temTela: true,
      anexos: [],
    },
  )
  const r = await registrarEvento({
    demandaId: id,
    idExterno: randomUUID(),
    origem: 'fabrica',
    em: new Date(),
    evento:
      e.triagem === null
        ? { tipo: 'triagem_falhou', ator: 'fabrica', dados: { motivo: 'Relato curto demais.' } }
        : {
            tipo: 'triagem',
            ator: 'fabrica',
            dados: {
              ...e.triagem,
              destino: 'decisao_do_paulo',
              risco: 'baixo',
              dados: 'nenhum',
              impacto: { toca: [], podeQuebrar: [], autorizacao: false, caminhoProtegido: false },
              resposta: null,
            },
          },
  })
  if (r.resultado !== 'aplicado') throw new Error(`Triagem não aplicada: ${r.resultado}`)
  const d = await db.demanda.findUniqueOrThrow({ where: { id }, select: { espera: true } })
  if (d.espera !== e.espera) throw new Error(`A demanda espera ${d.espera}, não ${e.espera}.`)
  return { id }
}

export async function esperaDaDemandaNoBanco(
  id: string,
): Promise<{ espera: string | null; encerrada: string | null; destino: string | null }> {
  return db.demanda.findUniqueOrThrow({
    where: { id },
    select: { espera: true, encerrada: true, destino: true },
  })
}

// "Demanda até o ar": uma demanda com as partes gravadas direto no banco, para conferir a tela.
export interface ParteDeTeste {
  chave: string
  repositorio: string
  ordem: number
  objetivo?: string
  dependeDe?: string[]
  estado?: 'PLANEJANDO' | 'EM_CURSO' | 'FEITA' | 'PUBLICANDO' | 'NO_AR' | 'NAO_CHEGOU'
  motivo?: string
  prs?: number
  commitNoAr?: string
}

export async function criarDemandaAteOArNoBanco(e: {
  projetoId: string
  repositorio: string
  titulo: string
  partes: readonly ParteDeTeste[]
  demanda?: Record<string, unknown>
  eventos?: readonly { tipo: string; origem: string; dados?: Record<string, unknown> }[]
}): Promise<{ id: string }> {
  const repo = async (nomeCompleto: string) =>
    (await db.repositorioGitHub.findFirstOrThrow({ where: { nomeCompleto }, select: { id: true } }))
      .id
  const agora = Date.now()
  const d = await db.demanda.create({
    data: {
      projetoId: e.projetoId,
      repositorioId: await repo(e.repositorio),
      titulo: e.titulo,
      nivel: 'APROVAR_DESENHO',
      temTela: true,
      origem: 'FLOW',
      etapas: MODELO_PADRAO as never,
      etapaAtual: 'desenvolvida',
      concluidas: ['recebida', 'planejada', 'desenho'],
      desenhoAprovado: 1,
      versaoDoDesenho: 1,
      criadaEm: new Date(agora - 26 * 60 * 60_000),
      ...e.demanda,
    } as never,
    select: { id: true },
  })
  for (const p of e.partes) {
    const repositorioId = await repo(p.repositorio)
    await db.parteDaDemanda.create({
      data: {
        demandaId: d.id,
        chave: p.chave,
        repositorioId,
        ordem: p.ordem,
        objetivo: p.objetivo ?? null,
        dependeDe: p.dependeDe ?? [],
        estado: p.estado ?? 'PLANEJANDO',
        motivo: p.motivo ?? null,
        commitNoAr: p.commitNoAr ?? null,
        noArEm: p.estado === 'NO_AR' ? new Date(agora - 60 * 60_000) : null,
        prs: Array.from({ length: p.prs ?? 0 }, (_, i) => ({
          url: `https://github.com/${p.repositorio}/pull/${100 + i}`,
          repositorio: p.repositorio,
          numero: 100 + i,
          estado: 'mergeado',
          mergeCommit: null,
        })),
      },
    })
  }
  for (const [i, ev] of (e.eventos ?? []).entries()) {
    await db.eventoDaDemanda.create({
      data: {
        idExterno: randomUUID(),
        demandaId: d.id,
        tipo: ev.tipo,
        origem: ev.origem,
        dados: (ev.dados ?? {}) as never,
        em: new Date(agora - (26 - i) * 60 * 60_000),
      },
    })
  }
  return d
}

// A publicação da parte de entrada terminou sem conferir o site (repositório sem `urlDaVersao`):
// o que a fila grava, sem passar por ela; a tela oferece "Conferi no ar".
export async function publicadaSemConferirNoBanco(
  demandaId: string,
  commit: string,
): Promise<void> {
  const agora = new Date()
  await db.parteDaDemanda.updateMany({
    where: { demandaId, estado: { not: 'DESCARTADA' } },
    data: {
      estado: 'NAO_CHEGOU',
      motivo: 'Publicada sem conferir o site',
      commitAlvo: commit,
      naoChegouEm: agora,
    },
  })
  await db.demanda.update({ where: { id: demandaId }, data: { naoChegouDesde: agora } })
}

// A leitura do site (D76) só existe com `urlDaVersao` em https, que o E2E não alcança: este é o
// único ponto simulado. Grava o commit que a conferência teria lido; o worker real fecha as
// partes que ele contém (compara pelas fixtures do GitHub) e a demanda quando todas estão no ar.
export async function gravarVersaoConferidaNoBanco(
  nomeCompleto: string,
  commit: string,
): Promise<void> {
  const repositorio = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto },
    select: { id: true },
  })
  await db.configuracaoDePublicacao.update({
    where: { repositorioId: repositorio.id },
    data: { versaoNoAr: commit, versaoConferidaEm: new Date() },
  })
}

// App conectado (sem token: o E2E não busca relatos; só a tela os lê).
export async function criarSistemaConectadoNoBanco(e: {
  nome: string
  projetoId: string
  repositorio: string
}): Promise<{ id: string }> {
  const repositorio = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: e.repositorio },
    select: { id: true },
  })
  return db.sistemaConectado.create({
    data: {
      nome: e.nome,
      url: 'https://app.exemplo.com/v1',
      projetoId: e.projetoId,
      repositorioId: repositorio.id,
    },
    select: { id: true },
  })
}

// Relato como a busca grava; com `imagem`, o anexo 0 vira o arquivo da demanda (id derivado, D83)
// gravado na pasta dos arquivos do E2E, como o download faria.
export async function criarRelatoNoBanco(e: {
  sistemaId: string
  idExterno: string
  resultado: 'SEGUE' | 'ORIENTADO'
  em: Date
  autorNome: string
  autorPapel: string
  texto?: string | null
  assunto?: string | null
  versao?: string | null
  ticket?: string | null
  demandaId?: string | null
  imagem?: Buffer
  envios?: readonly { estado: string; mensagem: string; enviadoEm: Date }[]
}): Promise<{ id: string }> {
  const r = await db.relato.create({
    data: {
      sistemaId: e.sistemaId,
      idExterno: e.idExterno,
      ticket: e.ticket ?? null,
      resultado: e.resultado,
      canal: 'SISTEMA',
      em: e.em,
      autorIdExterno: `u-${e.idExterno}`,
      autorNome: e.autorNome,
      autorPapel: e.autorPapel,
      texto: e.texto ?? null,
      assunto: e.assunto ?? null,
      versao: e.versao ?? null,
      demandaId: e.demandaId ?? null,
      anexos: e.imagem
        ? [{ tipo: 'imagem', bytes: e.imagem.length, caminho: '/relatos/print-1.png' }]
        : [],
    },
    select: { id: true },
  })
  for (const v of e.envios ?? []) {
    await db.envioDeAndamento.create({
      data: {
        relatoId: r.id,
        estado: v.estado,
        mensagem: v.mensagem,
        origem: 'automatico',
        situacao: 'ENVIADO',
        enviadoEm: v.enviadoEm,
      },
    })
  }
  if (e.imagem) {
    if (!e.demandaId) throw new Error('A imagem do relato só existe numa demanda.')
    const arquivoId = idDoAnexo(`${e.sistemaId}:${e.idExterno}`, 0)
    await db.arquivoDaDemanda.create({
      data: {
        id: arquivoId,
        demandaId: e.demandaId,
        tipo: 'ANEXO',
        nome: 'imagem-1-do-relato',
        conteudo: 'image/png',
        tamanho: e.imagem.length,
        enviadoPor: 'sistema',
      },
    })
    const pasta = join(PASTA_DOS_ARQUIVOS_E2E, 'demandas', e.demandaId)
    mkdirSync(pasta, { recursive: true })
    writeFileSync(join(pasta, arquivoId), e.imagem)
  }
  return r
}
