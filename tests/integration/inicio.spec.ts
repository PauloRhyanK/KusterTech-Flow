import { afterAll, beforeEach, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import exemplo from '@/modules/fabrica/retrato-exemplo.json'
import { receberRetratoDaFabrica } from '@/modules/fabrica/recepcao'
import { criarFonteDaFabrica } from '@/modules/fabrica/service'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { obterInicio } from '@/modules/inicio/queries'
import { criarProjeto } from '@/modules/projetos/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

// O retrato de exemplo foi gerado às 21:40; um minuto depois ele ainda está em dia.
const AGORA = new Date('2026-11-03T21:41:00Z')

let admin: Sujeito

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-inicio@local.test',
    nome: 'Admin Início',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
})

afterAll(async () => {
  await db.$disconnect()
})

async function gravarRetrato(): Promise<void> {
  const { token } = await criarFonteDaFabrica(admin, 'Máquina de agentes')
  const texto = JSON.stringify(exemplo)
  const resposta = await receberRetratoDaFabrica(
    {
      authorization: `Bearer ${token}`,
      contentType: 'application/json',
      contentLength: String(Buffer.byteLength(texto)),
      corpo: async () => texto,
    },
    AGORA,
  )
  expect(resposta.status).toBe(200)
}

async function repositorioIndisponivel(): Promise<{ projetoId: string }> {
  await sincronizarCatalogo(criarFonteFixtures(), AGORA)
  const projeto = await criarProjeto(admin, { nome: 'Projeto Portal' })
  const repositorio = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: 'kustertech-exemplo/portal' },
  })
  await db.repositorioGitHub.update({
    where: { id: repositorio.id },
    data: {
      projetoId: projeto.id,
      vinculadoEm: AGORA,
      sincronizadoEm: new Date(AGORA.getTime() - 20 * 60_000),
      ultimaFalhaEm: new Date(AGORA.getTime() - 60_000),
    },
  })
  return { projetoId: projeto.id }
}

test('com um retrato com uma decisão e um repositório indisponível, obterInicio devolve o item do Decidir → integração', async () => {
  await gravarRetrato()
  const { projetoId } = await repositorioIndisponivel()

  const inicio = await obterInicio(admin, AGORA)

  expect(inicio.escopo).toBe('total')
  expect(inicio.espera.fontesComFalha).toEqual([])
  expect(inicio.espera.itens.map((i) => [i.tipo, i.titulo, i.href])).toEqual([
    ['decidir', '1 item espera sua resposta', '/decidir'],
    ['integracao', 'GitHub — Projeto Portal', `/projetos/${projetoId}/configuracao#repositorios`],
  ])
  expect(inicio.fabrica).toMatchObject({
    desatualizado: false,
    planos: [
      { id: 'painel-fabrica', estado: 'ativo' },
      { id: 'outro-plano', estado: 'aguardando' },
    ],
  })
  expect(inicio.cadastro).toEqual({ clientes: 0, projetos: 1, repositorios: 1, maquinas: 0 })
  expect(inicio.oficina).toBeNull()
  expect(inicio.seusProjetos).toBeNull()
})

async function repositorioComPublicacao(
  situacao: 'NORMAL' | 'CONSERTANDO' | 'PARADO',
): Promise<string> {
  const projeto = await criarProjeto(admin, { nome: 'Projeto Beta' })
  const repositorio = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(9101),
      instalacaoId: BigInt(900001),
      nomeCompleto: 'kustertech-exemplo/beta',
      urlHtml: 'https://github.com/kustertech-exemplo/beta',
      privado: false,
      projetoId: projeto.id,
      vinculadoEm: AGORA,
      catalogadoEm: AGORA,
    },
  })
  await db.configuracaoDePublicacao.create({
    data: {
      repositorioId: repositorio.id,
      workflow: 'deploy.yml',
      situacao,
      situacaoDesde: new Date(AGORA.getTime() - 5 * 60_000),
      situacaoMotivo: situacao === 'PARADO' ? 'o agente não conseguiu consertar' : null,
    },
  })
  return repositorio.id
}

test('fila PARADO aparece em "Espera você" com o tipo Publicação; sem desenvolvimento.ler não aparece', async () => {
  await repositorioComPublicacao('PARADO')

  const inicio = await obterInicio(admin, AGORA)
  expect(inicio.espera.fontesComFalha).toEqual([])
  expect(inicio.espera.itens.filter((i) => i.tipo === 'publicacao')).toEqual([
    expect.objectContaining({
      tipo: 'publicacao',
      titulo: 'Projeto Beta parou: o agente não conseguiu consertar',
      href: '/publicacao',
      rotuloDoLink: 'Ver a publicação',
      tom: 'erro',
    }),
  ])

  const aprovador: Sujeito = {
    usuarioId: admin.usuarioId,
    papeis: [{ papel: 'APROVADOR', clienteId: null }],
  }
  const semLeitura = await obterInicio(aprovador, AGORA)
  expect(semLeitura.espera.itens.some((i) => i.tipo === 'publicacao')).toBe(false)
  expect(semLeitura.espera.fontesComFalha).toEqual([])
})

test('conserto COM_PR há mais de 1 h com o PR mergeado sem SHA do merge → "PR do conserto espera revisão" com o link do PR', async () => {
  const repositorioId = await repositorioComPublicacao('CONSERTANDO')
  const prUrl = 'https://github.com/kustertech-exemplo/beta/pull/31'
  const falhou = await db.pedidoDePublicacao.create({
    data: {
      repositorioId,
      commit: 'a'.repeat(40),
      modo: 'IMEDIATO',
      estado: 'FALHOU',
      concluidoEm: new Date(AGORA.getTime() - 120 * 60_000),
    },
  })
  await db.pedidoDeConserto.create({
    data: {
      repositorioId,
      pedidoId: falhou.id,
      commit: 'a'.repeat(40),
      trechoDoLog: 'erro',
      estado: 'COM_PR',
      prUrl,
      abertoEm: new Date(AGORA.getTime() - 120 * 60_000),
      pegoEm: new Date(AGORA.getTime() - 110 * 60_000),
    },
  })
  await db.pullRequestGitHub.create({
    data: {
      githubId: BigInt(77031),
      repositorioId,
      numero: 31,
      titulo: 'Conserta o deploy',
      estado: 'MERGEADO',
      rascunho: false,
      urlHtml: 'https://github.com/Kustertech-Exemplo/beta/pull/31',
      branch: 'conserto',
      shaHead: 'b'.repeat(40),
      shaMerge: null,
      atualizadoNoGitHub: AGORA,
      sincronizadoEm: AGORA,
      criadoNoGitHub: new Date(AGORA.getTime() - 90 * 60_000),
    },
  })

  const inicio = await obterInicio(admin, AGORA)
  expect(inicio.espera.itens.filter((i) => i.tipo === 'publicacao')).toEqual([
    expect.objectContaining({
      titulo: 'Projeto Beta: PR do conserto espera revisão',
      contexto: 'PR #31 mergeado; o commit do merge ainda não chegou ao Flow',
      href: prUrl,
      externo: true,
      rotuloDoLink: 'Ver o PR',
      tom: 'atencao',
    }),
  ])
})

test('demanda esperando aprovação aparece em "Espera você" como item do Decidir; sem desenvolvimento.ler não aparece', async () => {
  await sincronizarCatalogo(criarFonteFixtures(), AGORA)
  const projeto = await criarProjeto(admin, { nome: 'Projeto Portal' })
  const repositorio = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: 'kustertech-exemplo/portal' },
  })
  await db.demanda.create({
    data: {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      titulo: 'Tela de funil de vendas',
      nivel: 'APROVAR_DESENHO',
      temTela: true,
      origem: 'FLOW',
      etapas: [],
      etapaAtual: 'desenho',
      espera: 'aprovar_desenho',
      esperaDesde: new Date(AGORA.getTime() - 30 * 60_000),
    },
  })
  await db.demanda.create({
    data: {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      titulo: 'Recebida parada',
      nivel: 'VAI_SOZINHO',
      temTela: false,
      origem: 'FLOW',
      etapas: [],
      etapaAtual: 'recebida',
      criadaEm: new Date(AGORA.getTime() - 30 * 60_000),
    },
  })
  await db.fonteDaFabrica.create({
    data: {
      nome: 'Fábrica',
      tokenHash: 'hash-inicio-demandas',
      criadaPorId: admin.usuarioId,
      demandasBuscadasEm: new Date(AGORA.getTime() - 11 * 60_000),
    },
  })

  const inicio = await obterInicio(admin, AGORA)
  expect(inicio.espera.fontesComFalha).toEqual([])
  // A demanda que espera aprovação está na pilha do Decidir: vira o item único dele.
  expect(inicio.espera.itens.filter((i) => i.tipo === 'demanda')).toEqual([])
  expect(inicio.espera.itens.filter((i) => i.tipo === 'decidir')).toEqual([
    expect.objectContaining({
      titulo: '1 item espera sua resposta',
      href: '/decidir',
      rotuloDoLink: 'Abrir Decidir',
    }),
  ])
  expect(inicio.espera.itens.filter((i) => i.id === 'fabrica-sem-buscar-demandas')).toEqual([
    expect.objectContaining({
      titulo: 'A Fábrica não busca demandas há 11 min',
      contexto: '1 demanda esperando a triagem',
    }),
  ])

  const aprovador: Sujeito = {
    usuarioId: admin.usuarioId,
    papeis: [{ papel: 'APROVADOR', clienteId: null }],
  }
  const semLeitura = await obterInicio(aprovador, AGORA)
  expect(semLeitura.espera.itens.some((i) => i.tipo === 'demanda')).toBe(false)
  expect(semLeitura.espera.fontesComFalha).toEqual([])
})
