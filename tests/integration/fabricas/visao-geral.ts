import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { criarProjeto } from '@/modules/projetos/service'
import { criarUsuario } from '@/modules/usuarios/service'

export const AGORA_DA_VISAO_GERAL = new Date('2026-10-26T12:00:00Z')

export interface CenarioDaVisaoGeral {
  agora: Date
  admin: Sujeito
  testadorA: Sujeito
  aprovadorB: Sujeito
  clienteAId: string
  clienteBId: string
  projetoPId: string
  projetoQId: string
  projetoRId: string
  portalId: string
  apiId: string
  milestoneId: string
  milestoneArquivadaId: string
  homologacaoAId: string
  homologacaoBId: string
  homologacaoA2Id: string
  issuePortal: Record<number, string>
  versoes: { v1: string; v2: string; v3: string }
  composicoes: { c0: string; c1: string; c3: string }
  ambienteProdId: string
  divergencias: { d1: string; d2: string }
  alertas: { al1: string; al2: string; al3: string; al4: string }
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

const dia = (d: number, hora = 12) => new Date(Date.UTC(2026, 9, d, hora))

// Pressupõe banco limpo (`limparBanco`).
export async function criarCenarioDaVisaoGeral(agora: Date): Promise<CenarioDaVisaoGeral> {
  const minutosAntes = (m: number) => new Date(agora.getTime() - m * 60_000)

  const clienteA = await db.cliente.create({
    data: { nome: 'Cliente A', nomeNormalizado: 'cliente a' },
  })
  const clienteB = await db.cliente.create({
    data: { nome: 'Cliente B', nomeNormalizado: 'cliente b' },
  })
  const admin = await usuario('admin-vg@local.test', 'Admin VG', 'ADMIN', null)
  const testadorA = await usuario('testador-a-vg@local.test', 'Testador A', 'TESTADOR', clienteA.id)
  const aprovadorB = await usuario(
    'aprovador-b-vg@local.test',
    'Aprovador B',
    'APROVADOR',
    clienteB.id,
  )

  const projetoP = await criarProjeto(admin, {
    nome: 'Projeto P',
    clientesIds: [clienteA.id, clienteB.id],
  })
  const projetoQ = await criarProjeto(admin, { nome: 'Projeto Q' })
  const projetoR = await db.projeto.create({
    data: { nome: 'Projeto R', nomeNormalizado: 'projeto r', arquivadoEm: dia(1) },
  })

  const fonte = criarFonteFixtures()
  await sincronizarCatalogo(fonte, agora)
  const repositorio = (nome: string) =>
    db.repositorioGitHub.findFirstOrThrow({ where: { nomeCompleto: `kustertech-exemplo/${nome}` } })
  const portal = await repositorio('portal')
  const api = await repositorio('api')
  for (const r of [portal, api]) {
    await db.repositorioGitHub.update({
      where: { id: r.id },
      data: { projetoId: projetoP.id, vinculadoEm: agora },
    })
    await sincronizarRepositorio(fonte, r.id, agora)
  }
  await db.repositorioGitHub.update({
    where: { id: portal.id },
    data: { sincronizadoEm: minutosAntes(5) },
  })
  await db.repositorioGitHub.update({
    where: { id: api.id },
    data: { sincronizadoEm: minutosAntes(20), ultimaFalhaEm: minutosAntes(1) },
  })

  const issues = await db.issueGitHub.findMany({ where: { repositorioId: portal.id } })
  const issuePortal: Record<number, string> = {}
  for (const i of issues) issuePortal[i.numero] = i.id

  const ambientes = await Promise.all(
    (['DEV', 'QA', 'PROD'] as const).map((tipo) =>
      db.ambiente.create({ data: { projetoId: projetoP.id, tipo } }),
    ),
  )
  const ambienteProd = ambientes.find((a) => a.tipo === 'PROD')!

  const milestone = await db.milestone.create({
    data: { projetoId: projetoP.id, titulo: 'Milestone 1', tituloNormalizado: 'milestone 1' },
  })
  const milestoneArquivada = await db.milestone.create({
    data: {
      projetoId: projetoP.id,
      titulo: 'Milestone 2',
      tituloNormalizado: 'milestone 2',
      arquivadaEm: dia(15),
    },
  })
  await db.milestoneCliente.createMany({
    data: [
      { milestoneId: milestone.id, clienteId: clienteA.id },
      { milestoneId: milestone.id, clienteId: clienteB.id },
      { milestoneId: milestoneArquivada.id, clienteId: clienteA.id },
    ],
  })
  await db.milestoneIssue.createMany({
    data: [
      { milestoneId: milestone.id, issueId: issuePortal[1]!, origem: 'MANUAL' },
      { milestoneId: milestone.id, issueId: issuePortal[2]!, origem: 'MANUAL' },
      { milestoneId: milestone.id, issueId: issuePortal[3]!, origem: 'MANUAL' },
      { milestoneId: milestoneArquivada.id, issueId: issuePortal[3]!, origem: 'MANUAL' },
    ],
  })

  const homologacao = (clienteId: string, milestoneId: string) =>
    db.homologacao.create({ data: { clienteId, milestoneId } })
  const ha = await homologacao(clienteA.id, milestone.id)
  const hb = await homologacao(clienteB.id, milestone.id)
  const ha2 = await homologacao(clienteA.id, milestoneArquivada.id)

  const item = (
    homologacaoId: string,
    numero: number,
    estado:
      | 'AGUARDANDO_DISPONIBILIZACAO'
      | 'PENDENTE_DE_TESTE'
      | 'CORRECAO_SOLICITADA'
      | 'AGUARDANDO_RETESTE',
    atualizadoEm: Date,
  ) =>
    db.homologacaoItem.create({
      data: { homologacaoId, issueId: issuePortal[numero]!, estado, atualizadoEm },
    })
  await item(ha.id, 1, 'PENDENTE_DE_TESTE', dia(20))
  await item(ha.id, 2, 'PENDENTE_DE_TESTE', dia(21))
  await item(ha.id, 3, 'AGUARDANDO_DISPONIBILIZACAO', dia(22))
  const hb1 = await item(hb.id, 1, 'CORRECAO_SOLICITADA', dia(19))
  await item(hb.id, 2, 'AGUARDANDO_RETESTE', dia(23))
  await item(ha2.id, 3, 'PENDENTE_DE_TESTE', dia(18))

  const evento = await db.eventoTimeline.create({
    data: {
      clienteId: clienteB.id,
      milestoneId: milestone.id,
      issueId: issuePortal[1]!,
      tipo: 'SOLICITACAO_CORRECAO',
      visibilidade: 'COMPARTILHAVEL',
      origem: 'HUMANO',
      autorId: aprovadorB.usuarioId,
      texto: 'O botão não responde.',
      estadoAnterior: 'PENDENTE_DE_TESTE',
      estadoNovo: 'CORRECAO_SOLICITADA',
      criadoEm: dia(19),
    },
  })
  await db.solicitacaoDeCorrecao.create({
    data: { itemId: hb1.id, eventoId: evento.id, estado: 'ABERTA' },
  })

  const criarVersao = (repositorioId: string, rotulo: string, letra: string) =>
    db.versao.create({
      data: { projetoId: projetoP.id, repositorioId, commitSha: letra.repeat(40), rotulo },
    })
  const v1 = await criarVersao(portal.id, 'v1.4.0', 'a')
  const v2 = await criarVersao(portal.id, 'v1.3.9', 'b')
  const v3 = await criarVersao(api.id, 'v2.0.0', 'c')

  const composicao = (
    repositorioId: string,
    versaoAlvoId: string,
    commitBase: string,
    calculadaEm: Date,
  ) =>
    db.composicaoDePublicacao.create({
      data: {
        projetoId: projetoP.id,
        repositorioId,
        versaoAlvoId,
        commitBase,
        commitAlvo: 'f'.repeat(40),
        origemDaBase: 'SEM_BASE',
        hashComposicao: `hash-${versaoAlvoId}`,
        estado: 'IDENTIFICADA',
        itens: [],
        calculadaEm,
      },
    })
  const c0 = await composicao(portal.id, v2.id, '1'.repeat(40), dia(20))
  const c1 = await composicao(portal.id, v1.id, '2'.repeat(40), dia(24))
  const c3 = await composicao(api.id, v3.id, '3'.repeat(40), dia(24))
  await db.autorizacaoProd.create({
    data: {
      projetoId: projetoP.id,
      repositorioId: api.id,
      versaoAlvoId: v3.id,
      composicaoId: c3.id,
      commitBase: c3.commitBase,
      hashComposicao: c3.hashComposicao,
      autorId: admin.usuarioId,
      composicaoAutorizada: [],
    },
  })

  const evidenciaProd = (ocorridaEm: Date) =>
    db.evidenciaDeploy.create({
      data: {
        ambienteId: ambienteProd.id,
        versaoId: v2.id,
        origem: 'MANUAL',
        situacao: 'SUCESSO',
        ocorridaEm,
        autorId: admin.usuarioId,
      },
    })
  const e1 = await evidenciaProd(dia(25))
  const e2 = await evidenciaProd(dia(22))
  const d1 = await db.divergenciaDeDeploy.create({
    data: { evidenciaId: e1.id, versaoId: v2.id, detectadaEm: dia(25) },
  })
  const d2 = await db.divergenciaDeDeploy.create({
    data: {
      evidenciaId: e2.id,
      versaoId: v2.id,
      detectadaEm: dia(22),
      reconhecidaPorId: admin.usuarioId,
      reconhecidaEm: dia(23),
    },
  })

  const alerta = (
    chave: string,
    titulo: string,
    severidade: 'CRITICA' | 'ALTA',
    estado: 'ATIVO' | 'RECONHECIDO' | 'RESOLVIDO_NA_ORIGEM',
    primeiraOcorrenciaEm: Date,
  ) =>
    db.alerta.create({
      data: {
        chaveDedupe: chave,
        origem: 'MANUAL',
        titulo,
        severidade,
        estado,
        primeiraOcorrenciaEm,
        ultimaOcorrenciaEm: primeiraOcorrenciaEm,
        ocorrencias: 1,
      },
    })
  const al1 = await alerta('al1', 'Disco quase cheio', 'ALTA', 'ATIVO', dia(20))
  const al2 = await alerta('al2', 'Banco fora do ar', 'CRITICA', 'ATIVO', dia(25))
  const al3 = await alerta('al3', 'Fila parada', 'CRITICA', 'RECONHECIDO', dia(21))
  const al4 = await alerta('al4', 'Certificado expirando', 'ALTA', 'RESOLVIDO_NA_ORIGEM', dia(18))

  return {
    agora,
    admin,
    testadorA,
    aprovadorB,
    clienteAId: clienteA.id,
    clienteBId: clienteB.id,
    projetoPId: projetoP.id,
    projetoQId: projetoQ.id,
    projetoRId: projetoR.id,
    portalId: portal.id,
    apiId: api.id,
    milestoneId: milestone.id,
    milestoneArquivadaId: milestoneArquivada.id,
    homologacaoAId: ha.id,
    homologacaoBId: hb.id,
    homologacaoA2Id: ha2.id,
    issuePortal,
    versoes: { v1: v1.id, v2: v2.id, v3: v3.id },
    composicoes: { c0: c0.id, c1: c1.id, c3: c3.id },
    ambienteProdId: ambienteProd.id,
    divergencias: { d1: d1.id, d2: d2.id },
    alertas: { al1: al1.id, al2: al2.id, al3: al3.id, al4: al4.id },
  }
}

// Acrescenta volume sem mudar o formato: 10 projetos incompletos, 10 alertas ativos e
// 10 homologações (milestone + item pendente de teste do cliente A).
export async function ampliarCenarioDaVisaoGeral(
  c: CenarioDaVisaoGeral,
  quantidade: number,
  prefixo = 'extra',
): Promise<void> {
  for (let i = 0; i < quantidade; i++) {
    const sufixo = `${prefixo}-${i}`
    await db.projeto.create({
      data: { nome: `Projeto ${sufixo}`, nomeNormalizado: `projeto ${sufixo}` },
    })
    await db.alerta.create({
      data: {
        chaveDedupe: `alerta-${sufixo}`,
        origem: 'MANUAL',
        titulo: `Alerta ${sufixo}`,
        severidade: 'MEDIA',
        estado: 'ATIVO',
        primeiraOcorrenciaEm: dia(10 + (i % 5)),
        ultimaOcorrenciaEm: dia(10 + (i % 5)),
        ocorrencias: 1,
      },
    })
    const milestone = await db.milestone.create({
      data: {
        projetoId: c.projetoPId,
        titulo: `Milestone ${sufixo}`,
        tituloNormalizado: `milestone ${sufixo}`,
      },
    })
    await db.milestoneCliente.create({
      data: { milestoneId: milestone.id, clienteId: c.clienteAId },
    })
    const homologacao = await db.homologacao.create({
      data: { clienteId: c.clienteAId, milestoneId: milestone.id },
    })
    await db.homologacaoItem.create({
      data: {
        homologacaoId: homologacao.id,
        issueId: c.issuePortal[1]!,
        estado: 'PENDENTE_DE_TESTE',
        atualizadoEm: dia(5 + (i % 5)),
      },
    })
  }
}
