import { randomBytes } from 'node:crypto'
import type { Papel } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { temaParaBanco, type Tema } from '@/lib/tema/tema'
import { normalizarNome, validarNomeDeCliente } from '@/modules/clientes/model'
import { assinaturaDaEntrada, prsMergeadosDaIssue } from '@/modules/ambientes/model'
import { atualizarFilaDeHomologacao } from '@/modules/homologacao/fila'
import { registrarAcaoDeHomologacao } from '@/modules/homologacao/service'
import { obterVersaoCorrenteEmQA } from '@/modules/homologacao/versao-corrente'
import { validarNomeDeProjeto } from '@/modules/projetos/model'
import { criarUsuario } from '@/modules/usuarios/service'
import { rodarWorkerUmaVez } from './worker'
import {
  aprovarItemNoCenario,
  criarCenarioDeHomologacao,
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
    },
  })
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
  await db.eventoTimeline.deleteMany({ where: dasIssues })
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
