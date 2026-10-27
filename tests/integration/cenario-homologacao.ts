import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { assinaturaDaEntrada } from '@/modules/ambientes/model'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { criarProjeto } from '@/modules/projetos/service'
import { criarUsuario } from '@/modules/usuarios/service'

export interface Cenario {
  admin: Sujeito
  aprovadorA: Sujeito
  testadorA: Sujeito
  aprovadorB: Sujeito
  clienteAId: string
  clienteBId: string
  projetoId: string
  portalId: string
  milestoneId: string
  ambienteQaId: string
  versoes: { v0: string; v1: string; v2: string }
  issuePorNumero: Record<number, string>
}

async function usuario(
  email: string,
  nome: string,
  papel: 'ADMIN' | 'APROVADOR' | 'TESTADOR',
  clienteId: string | null,
): Promise<Sujeito> {
  const criado = await criarUsuario({
    email,
    nome,
    senha: 'senha-super-segura-123',
    papeis: [{ papel, clienteId }],
  })
  return { usuarioId: criado.id, papeis: [{ papel, clienteId }] }
}

// Pressupõe banco limpo (`limparBanco`).
export async function montarCenarioDeHomologacao(): Promise<Cenario> {
  const agora = new Date()
  const antes = (ms: number) => new Date(agora.getTime() - ms)

  const clienteA = await db.cliente.create({
    data: { nome: 'Cliente A', nomeNormalizado: 'cliente a' },
  })
  const clienteB = await db.cliente.create({
    data: { nome: 'Cliente B', nomeNormalizado: 'cliente b' },
  })
  const admin = await usuario('admin-hom@local.test', 'Admin Hom', 'ADMIN', null)
  const aprovadorA = await usuario(
    'aprovador-a@local.test',
    'Aprovador A',
    'APROVADOR',
    clienteA.id,
  )
  const testadorA = await usuario('testador-a@local.test', 'Testador A', 'TESTADOR', clienteA.id)
  const aprovadorB = await usuario(
    'aprovador-b@local.test',
    'Aprovador B',
    'APROVADOR',
    clienteB.id,
  )

  const projeto = await criarProjeto(admin, {
    nome: 'Projeto H',
    clientesIds: [clienteA.id, clienteB.id],
  })

  const fonte = criarFonteFixtures()
  await sincronizarCatalogo(fonte, agora)
  const portal = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: 'kustertech-exemplo/portal' },
  })
  await db.repositorioGitHub.update({
    where: { id: portal.id },
    data: { projetoId: projeto.id, vinculadoEm: agora },
  })
  await sincronizarRepositorio(fonte, portal.id, agora)
  const issues = await db.issueGitHub.findMany({ where: { repositorioId: portal.id } })
  const issuePorNumero: Record<number, string> = {}
  for (const i of issues) issuePorNumero[i.numero] = i.id

  const milestone = await db.milestone.create({
    data: { projetoId: projeto.id, titulo: 'Release 1', tituloNormalizado: 'release 1' },
  })
  await db.milestoneCliente.createMany({
    data: [
      { milestoneId: milestone.id, clienteId: clienteA.id },
      { milestoneId: milestone.id, clienteId: clienteB.id },
    ],
  })
  await db.milestoneIssue.createMany({
    data: [
      { issueId: issuePorNumero[1]!, origem: 'MANUAL' as const },
      { issueId: issuePorNumero[2]!, origem: 'MANUAL' as const },
      {
        issueId: issuePorNumero[3]!,
        origem: 'MANUAL' as const,
        foraDoEscopo: true,
        justificativaForaDoEscopo: 'Fora do escopo do teste',
      },
      { issueId: issuePorNumero[4]!, origem: 'MANUAL' as const },
    ].map((m) => ({ milestoneId: milestone.id, ...m })),
  })

  const ambiente = await db.ambiente.create({
    data: { projetoId: projeto.id, tipo: 'QA', nomeNoGitHub: 'qa' },
  })
  const criarVersao = (rotulo: string, letra: string) =>
    db.versao.create({
      data: {
        projetoId: projeto.id,
        repositorioId: portal.id,
        commitSha: letra.repeat(40),
        rotulo,
      },
    })
  const v0 = await criarVersao('v0', 'a')
  const v1 = await criarVersao('v1', 'b')
  const v2 = await criarVersao('v2', 'c')
  const evidencia = (versaoId: string, situacao: 'SUCESSO' | 'FALHA', ocorridaEm: Date) => ({
    ambienteId: ambiente.id,
    versaoId,
    origem: 'MANUAL' as const,
    situacao,
    ocorridaEm,
    registradaEm: ocorridaEm,
    autorId: admin.usuarioId,
  })
  await db.evidenciaDeploy.createMany({
    data: [
      evidencia(v0.id, 'SUCESSO', antes(2 * 3_600_000)),
      evidencia(v1.id, 'SUCESSO', antes(3_600_000)),
      evidencia(v2.id, 'FALHA', antes(30 * 60_000)),
    ],
  })

  const assinatura = assinaturaDaEntrada([])
  const presenca = (
    versaoId: string,
    numero: number,
    estado: 'PRESENCA_CONFIRMADA' | 'CONFIRMACAO_MANUAL' | 'SEM_EVIDENCIA',
  ) => ({
    versaoId,
    issueId: issuePorNumero[numero]!,
    estado,
    motivo: 'Cenário de homologação.',
    confirmadaPorId: estado === 'CONFIRMACAO_MANUAL' ? admin.usuarioId : null,
    calculadaEm: agora,
    assinaturaEntrada: assinatura,
  })
  await db.presencaIssueVersao.createMany({
    data: [
      presenca(v0.id, 4, 'PRESENCA_CONFIRMADA'),
      presenca(v1.id, 1, 'PRESENCA_CONFIRMADA'),
      presenca(v1.id, 2, 'CONFIRMACAO_MANUAL'),
      presenca(v1.id, 3, 'PRESENCA_CONFIRMADA'),
      presenca(v1.id, 4, 'SEM_EVIDENCIA'),
      presenca(v2.id, 4, 'PRESENCA_CONFIRMADA'),
    ],
  })

  return {
    admin,
    aprovadorA,
    testadorA,
    aprovadorB,
    clienteAId: clienteA.id,
    clienteBId: clienteB.id,
    projetoId: projeto.id,
    portalId: portal.id,
    milestoneId: milestone.id,
    ambienteQaId: ambiente.id,
    versoes: { v0: v0.id, v1: v1.id, v2: v2.id },
    issuePorNumero,
  }
}
