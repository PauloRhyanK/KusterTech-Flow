import type { Papel } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { temaParaBanco, type Tema } from '@/lib/tema/tema'
import { normalizarNome, validarNomeDeCliente } from '@/modules/clientes/model'
import { validarNomeDeProjeto } from '@/modules/projetos/model'
import { criarUsuario } from '@/modules/usuarios/service'

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

// Apaga a homologação das issues dos repositórios, na ordem das FKs: solicitações → itens →
// eventos → homologações sem itens. A tarefa do worker recria os itens a partir das presenças.
export async function limparHomologacaoDosRepositoriosNoBanco(
  nomes: readonly string[],
): Promise<void> {
  const dasIssues = { issue: { repositorio: { nomeCompleto: { in: [...nomes] } } } }
  await db.solicitacaoDeCorrecao.deleteMany({ where: { item: dasIssues } })
  await db.homologacaoItem.deleteMany({ where: dasIssues })
  await db.eventoTimeline.deleteMany({ where: dasIssues })
  await db.homologacao.deleteMany({ where: { itens: { none: {} } } })
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
