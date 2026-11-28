import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { abrirDemanda } from '@/modules/demandas/service'
import { registrarPlanoAprovado } from '@/modules/fabrica-operacao/service'
import { processarFilaDePublicacao } from '@/modules/fila-de-publicacao/worker'
import type { FonteGitHub } from '@/modules/github/fonte'
import {
  conferirVersoesAutomaticas,
  sincronizarDemandasV2,
} from '@/modules/fabrica-operacao/sincronizacao'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-28T15:00:00.000Z')
const SHA = 'c'.repeat(40)
const PR = 'https://github.com/PauloRhyanK/KusterTech-Flow/pull/301'

let admin: Sujeito
let projetoId: string
let repositorioId: string

beforeEach(async () => {
  await limparBanco()
  const u = await criarUsuario({
    email: 'admin-v2@local.test',
    nome: 'Admin V2',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: u.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  projetoId = (
    await db.projeto.create({ data: { nome: 'Flow', nomeNormalizado: 'flow', motorPadrao: 'v2' } })
  ).id
  repositorioId = (
    await db.repositorioGitHub.create({
      data: {
        githubId: BigInt(9301),
        instalacaoId: BigInt(1),
        nomeCompleto: 'PauloRhyanK/KusterTech-Flow',
        urlHtml: 'https://github.com/PauloRhyanK/KusterTech-Flow',
        privado: false,
        projetoId,
        vinculadoEm: AGORA,
        catalogadoEm: AGORA,
      } as never,
    })
  ).id
  await db.configuracaoDePublicacao.create({
    data: {
      repositorioId,
      workflow: '',
      deployAutomatico: true,
      urlDaVersao: 'http://web:3000/api/versao',
    },
  })
})

afterAll(async () => {
  await db.$disconnect()
})

async function demandaComPlano() {
  const { id } = await db.$transaction((tx) =>
    abrirDemanda(
      tx,
      {
        projetoId,
        repositorioId,
        titulo: 'Ajuste pequeno',
        descricao: null,
        tipo: 'ajuste',
        nivel: 'vai_sozinho',
        temTela: false,
        origem: 'flow',
        usuarioId: admin.usuarioId,
      },
      AGORA,
    ),
  )
  await registrarPlanoAprovado(admin, {
    demandaId: id,
    conteudo: { objetivo: 'x', triagem: { risco: 'baixo', mexeEm: 'rodapé' } },
    etapas: [
      {
        chave: 'rodape',
        tipo: 'implementacao',
        papel: 'engenheiro',
        instrucoes: 'Mostre a versão no rodapé.',
        verificacao: 'pnpm test',
        repositorioId,
        arquivos: ['src/rodape/**'],
        dependeDe: [],
        prioridade: 0,
      },
    ],
  })
  return id
}

const demanda = (id: string) =>
  db.demanda.findUniqueOrThrow({
    where: { id },
    select: { etapaAtual: true, espera: true, motor: true, partes: true },
  })

const eventos = async (id: string) =>
  (await db.eventoDaDemanda.findMany({ where: { demandaId: id }, orderBy: { seq: 'asc' } })).map(
    (e) => e.tipo,
  )

describe('sincronizarDemandasV2', () => {
  test('a demanda do projeto v2 nasce no motor novo e, com plano, vai até desenvolvida e espera as etapas', async () => {
    const id = await demandaComPlano()
    expect((await demanda(id)).motor).toBe('v2')
    await sincronizarDemandasV2(AGORA)
    expect(await eventos(id)).toEqual(expect.arrayContaining(['triagem', 'plano_criado']))
    const d = await demanda(id)
    expect(d.etapaAtual).toBe('desenvolvida')
    expect(d.partes[0]!.chegaAoAr).toBe('VERSAO')
  })

  test('etapa mergeada e sincronizada: parte feita, entregue e no ar quando a versão confere', async () => {
    const id = await demandaComPlano()
    await sincronizarDemandasV2(AGORA)
    await db.etapaOperacional.updateMany({ data: { estado: 'mergeada', prUrl: PR } })
    // o merge ainda não foi sincronizado do GitHub: nada acontece
    await sincronizarDemandasV2(AGORA)
    expect((await demanda(id)).etapaAtual).toBe('desenvolvida')

    await db.pullRequestGitHub.create({
      data: {
        repositorioId,
        githubId: BigInt(77),
        numero: 301,
        titulo: 'fabrica: rodape',
        estado: 'MERGEADO',
        rascunho: false,
        urlHtml: PR,
        branch: 'fabrica/x',
        shaHead: 'd'.repeat(40),
        shaMerge: SHA,
        issuesReferenciadas: [],
        mergeadoNoGitHub: AGORA,
        atualizadoNoGitHub: AGORA,
        sincronizadoEm: AGORA,
      } as never,
    })
    await sincronizarDemandasV2(AGORA)
    const d = await demanda(id)
    expect(await eventos(id)).toEqual(expect.arrayContaining(['parte_feita', 'etapa_concluida']))
    expect(d.etapaAtual).toBe('no_ar')
    expect(d.partes[0]).toMatchObject({ estado: 'PUBLICANDO', commitAlvo: SHA })

    const buscar = (async () =>
      new Response(JSON.stringify({ commit: SHA }), { status: 200 })) as unknown as typeof fetch
    expect(await conferirVersoesAutomaticas(AGORA, buscar)).toBe(1)
    expect(
      (await db.configuracaoDePublicacao.findUniqueOrThrow({ where: { repositorioId } }))
        .versaoNoAr,
    ).toBe(SHA)
  })

  test('etapa bloqueada trava a demanda para o dono e destrava quando volta', async () => {
    const id = await demandaComPlano()
    await sincronizarDemandasV2(AGORA)
    await db.etapaOperacional.updateMany({
      data: { estado: 'bloqueada', motivo: 'escalar: CI vermelho' },
    })
    await sincronizarDemandasV2(AGORA)
    expect(await demanda(id)).toMatchObject({ espera: 'travada' })
    await db.etapaOperacional.updateMany({ data: { estado: 'pendente', motivo: null } })
    await sincronizarDemandasV2(AGORA)
    expect((await demanda(id)).espera).toBeNull()
  })

  test('versão ilegível não é gravada', async () => {
    const lixo = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch
    expect(await conferirVersoesAutomaticas(AGORA, lixo)).toBe(0)
  })

  test('demanda do motor legado não é tocada', async () => {
    await db.projeto.update({ where: { id: projetoId }, data: { motorPadrao: 'legado' } })
    const { id } = await db.$transaction((tx) =>
      abrirDemanda(
        tx,
        {
          projetoId,
          repositorioId,
          titulo: 'Do legado',
          descricao: null,
          tipo: null,
          nivel: 'vai_sozinho',
          temTela: false,
          origem: 'flow',
          usuarioId: admin.usuarioId,
        },
        AGORA,
      ),
    )
    await sincronizarDemandasV2(AGORA)
    expect(await eventos(id)).not.toContain('triagem')
  })

  test('plano novo depois da entrega é recusado', async () => {
    const id = await demandaComPlano()
    await db.demanda.update({ where: { id }, data: { entregueEm: AGORA } })
    await expect(
      registrarPlanoAprovado(admin, {
        demandaId: id,
        conteudo: { o: 2 },
        etapas: [
          {
            chave: 'outra',
            tipo: 'implementacao',
            papel: 'engenheiro',
            instrucoes: 'x',
            verificacao: 'true',
            repositorioId,
            arquivos: ['x'],
            dependeDe: [],
            prioridade: 0,
          },
        ],
      }),
    ).rejects.toThrow(/entregue/)
  })
})

describe('fila de publicação com deploy automático', () => {
  test('pedido pendente no repositório que se publica sozinho é dispensado, sem disparar nada', async () => {
    await db.pedidoDePublicacao.create({
      data: {
        repositorioId,
        commit: SHA,
        estado: 'NA_FILA',
        modo: 'IMEDIATO',
        descricao: 'pedido legado',
      } as never,
    })
    const chamadas: string[] = []
    const fonte = new Proxy(
      {},
      {
        get: (_alvo, nome) => async () => {
          chamadas.push(String(nome))
          return null
        },
      },
    )
    await processarFilaDePublicacao(fonte as unknown as FonteGitHub, AGORA)
    const pedido = await db.pedidoDePublicacao.findFirstOrThrow({ where: { repositorioId } })
    expect(pedido.estado).toBe('DISPENSADO')
    expect(chamadas).not.toContain('dispararWorkflow')
  })
})
