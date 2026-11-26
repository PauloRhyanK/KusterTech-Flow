import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { publicacaoDaDemanda } from '@/modules/demandas/queries'
import { marcarPartesSemPublicacao } from '@/modules/demandas/worker'
import { receberPedidoDePublicacao } from '@/modules/fila-de-publicacao/recepcao'
import { criarFonteDePublicacao } from '@/modules/fila-de-publicacao/service'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-19T15:00:00.000Z')
const C1 = '1'.repeat(40)
const C2 = '2'.repeat(40)

let token: string
let projetoId: string
let repositorioId: string
let outroRepositorioId: string

function dadosDaDemanda(repoId: string) {
  return {
    projetoId,
    repositorioId: repoId,
    titulo: 'T',
    nivel: 'APROVAR_DESENHO' as const,
    temTela: true,
    origem: 'FLOW' as const,
    etapas: [],
    etapaAtual: 'entregue',
  }
}

function enviar(corpo: unknown) {
  const texto = JSON.stringify(corpo)
  return receberPedidoDePublicacao(
    {
      authorization: `Bearer ${token}`,
      contentType: 'application/json',
      contentLength: String(Buffer.byteLength(texto)),
      corpo: async () => texto,
    },
    AGORA,
  )
}

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-dp@local.test',
    nome: 'Admin',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  const admin: Sujeito = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  token = (await criarFonteDePublicacao(admin, 'Fábrica')).token
  const projeto = await db.projeto.create({ data: { nome: 'Projeto A', nomeNormalizado: 'a' } })
  projetoId = projeto.id
  await sincronizarCatalogo(criarFonteFixtures(), AGORA)
  const repos = await db.repositorioGitHub.findMany({ orderBy: { nomeCompleto: 'asc' } })
  const portal = repos.find((r) => r.nomeCompleto === 'kustertech-exemplo/portal')!
  repositorioId = portal.id
  outroRepositorioId = repos.find((r) => r.id !== portal.id)!.id
  await db.repositorioGitHub.update({
    where: { id: portal.id },
    data: { projetoId, vinculadoEm: AGORA },
  })
  await db.configuracaoDePublicacao.create({
    data: { repositorioId, workflow: 'deploy.yml', modoPadrao: 'IMEDIATO' },
  })
})

afterAll(async () => {
  await db.$disconnect()
})

describe('publicação ligada à demanda', () => {
  test('demanda do mesmo repositório → 201 e demandaId gravado', async () => {
    const d = await db.demanda.create({ data: dadosDaDemanda(repositorioId) })
    const r = await enviar({ repositorio: 'kustertech-exemplo/portal', commit: C1, demanda: d.id })
    expect(r.status).toBe(201)
    const linha = await db.pedidoDePublicacao.findUniqueOrThrow({
      where: { id: (r.corpo as { id: string }).id },
    })
    expect(linha.demandaId).toBe(d.id)
  })

  test('demanda de outro repositório ou inexistente → 422 e nada gravado', async () => {
    const outra = await db.demanda.create({ data: dadosDaDemanda(outroRepositorioId) })
    const a = await enviar({
      repositorio: 'kustertech-exemplo/portal',
      commit: C1,
      demanda: outra.id,
    })
    expect(a).toEqual({ status: 422, corpo: { erro: 'A demanda não é deste repositório.' } })
    const b = await enviar({
      repositorio: 'kustertech-exemplo/portal',
      commit: C1,
      demanda: '0b5f6f0e-3c1d-4c3a-9a55-0d1e2f3a4b5c',
    })
    expect(b).toEqual({ status: 422, corpo: { erro: 'Demanda não encontrada.' } })
    expect(await db.pedidoDePublicacao.count()).toBe(0)
  })

  test('publicacaoDaDemanda: na_fila; atendido por outro publicado → commit e noArDesde do atendente', async () => {
    const d = await db.demanda.create({ data: dadosDaDemanda(repositorioId) })
    expect(await publicacaoDaDemanda(d.id)).toBeNull()

    const atendente = await db.pedidoDePublicacao.create({
      data: { repositorioId, commit: C1, modo: 'IMEDIATO', fonteId: null },
    })
    const r = await enviar({ repositorio: 'kustertech-exemplo/portal', commit: C1, demanda: d.id })
    expect(r.status).toBe(200) // dispensado: já está na fila
    expect(await publicacaoDaDemanda(d.id)).toMatchObject({ estado: 'na_fila', commit: C1 })

    const fim = new Date('2026-11-19T16:00:00.000Z')
    await db.pedidoDePublicacao.update({
      where: { id: atendente.id },
      data: { estado: 'PUBLICADO', concluidoEm: fim },
    })
    expect(await publicacaoDaDemanda(d.id)).toEqual({
      estado: 'publicado',
      commit: C1,
      noArDesde: fim,
    })
  })

  test('pedido sem demanda não grava demandaId', async () => {
    const r = await enviar({ repositorio: 'kustertech-exemplo/portal', commit: C1 })
    expect(r.status).toBe(201)
    const linha = await db.pedidoDePublicacao.findUniqueOrThrow({
      where: { id: (r.corpo as { id: string }).id },
    })
    expect(linha.demandaId).toBeNull()
  })
})

describe('pedido ligado à parte da demanda', () => {
  let ordem = 0
  const parte = (
    demandaId: string,
    repoId: string,
    extra: Partial<{
      chave: string
      estado: 'FEITA' | 'PUBLICANDO' | 'NAO_CHEGOU' | 'EM_CURSO'
      commitAlvo: string | null
    }> = {},
  ) =>
    db.parteDaDemanda.create({
      data: {
        demandaId,
        repositorioId: repoId,
        chave: extra.chave ?? `p${ordem++}`,
        ordem: ordem++,
        estado: extra.estado ?? 'FEITA',
        commitAlvo: extra.commitAlvo ?? null,
        feitaEm: AGORA,
      },
    })

  test('demanda de outro repositório com parte neste: 201, grava parteId, parte vira publicando com pedidoId e commitAlvo', async () => {
    const d = await db.demanda.create({ data: dadosDaDemanda(outroRepositorioId) })
    const p = await parte(d.id, repositorioId, { chave: 'back' })
    await parte(d.id, outroRepositorioId, { chave: 'front' })
    const r = await enviar({ repositorio: 'kustertech-exemplo/portal', commit: C1, demanda: d.id })
    expect(r.status).toBe(201)
    const id = (r.corpo as { id: string }).id
    const linha = await db.pedidoDePublicacao.findUniqueOrThrow({ where: { id } })
    expect(linha).toMatchObject({ demandaId: d.id, parteId: p.id })
    const depois = await db.parteDaDemanda.findUniqueOrThrow({ where: { id: p.id } })
    expect(depois).toMatchObject({
      estado: 'PUBLICANDO',
      pedidoId: id,
      commitAlvo: C1,
      motivo: null,
    })
  })

  test('com parte informada vale a parte; commitAlvo já definido não muda', async () => {
    const d = await db.demanda.create({ data: dadosDaDemanda(repositorioId) })
    await parte(d.id, repositorioId, { chave: 'a' })
    const b = await parte(d.id, repositorioId, { chave: 'b', commitAlvo: C2 })
    const r = await enviar({
      repositorio: 'kustertech-exemplo/portal',
      commit: C1,
      demanda: d.id,
      parte: 'b',
    })
    expect(r.status).toBe(201)
    const depois = await db.parteDaDemanda.findUniqueOrThrow({ where: { id: b.id } })
    expect(depois).toMatchObject({ estado: 'PUBLICANDO', commitAlvo: C2 })
  })

  test('parte de outro repositório → 422; duas partes no repositório sem parte → 422; nada gravado', async () => {
    const d = await db.demanda.create({ data: dadosDaDemanda(repositorioId) })
    await parte(d.id, repositorioId, { chave: 'a' })
    await parte(d.id, repositorioId, { chave: 'b' })
    await parte(d.id, outroRepositorioId, { chave: 'c' })
    const base = { repositorio: 'kustertech-exemplo/portal', commit: C1, demanda: d.id }
    expect(await enviar({ ...base, parte: 'c' })).toEqual({
      status: 422,
      corpo: { erro: 'A parte não é deste repositório.' },
    })
    expect(await enviar({ ...base, parte: 'inexistente' })).toEqual({
      status: 422,
      corpo: { erro: 'A parte não é deste repositório.' },
    })
    expect(await enviar(base)).toEqual({ status: 422, corpo: { erro: 'Informe a parte.' } })
    expect(await db.pedidoDePublicacao.count()).toBe(0)
  })

  test('parte sem demanda é corpo inválido', async () => {
    const r = await enviar({ repositorio: 'kustertech-exemplo/portal', commit: C1, parte: 'a' })
    expect(r).toEqual({ status: 422, corpo: { erro: 'Corpo inválido.' } })
  })

  test('uma só parte no repositório dispensa informar a chave', async () => {
    const d = await db.demanda.create({ data: dadosDaDemanda(repositorioId) })
    const p = await parte(d.id, repositorioId, { chave: 'a' })
    const r = await enviar({ repositorio: 'kustertech-exemplo/portal', commit: C1, demanda: d.id })
    expect(r.status).toBe(201)
    const linha = await db.pedidoDePublicacao.findUniqueOrThrow({
      where: { id: (r.corpo as { id: string }).id },
    })
    expect(linha.parteId).toBe(p.id)
  })

  test('pedido recusado na chegada marca a parte como nao_chegou com o motivo da fila', async () => {
    await db.configuracaoDePublicacao.delete({ where: { repositorioId } })
    const d = await db.demanda.create({ data: dadosDaDemanda(repositorioId) })
    const p = await parte(d.id, repositorioId, { chave: 'a' })
    const r = await enviar({ repositorio: 'kustertech-exemplo/portal', commit: C1, demanda: d.id })
    expect(r.status).toBe(409)
    const depois = await db.parteDaDemanda.findUniqueOrThrow({ where: { id: p.id } })
    expect(depois).toMatchObject({
      estado: 'NAO_CHEGOU',
      pedidoId: (r.corpo as { id: string }).id,
      motivo: 'publicação não configurada',
    })
    const demanda = await db.demanda.findUniqueOrThrow({ where: { id: d.id } })
    expect(demanda.naoChegouDesde).toEqual(AGORA)
  })

  test('pedido dispensado porque o commit já está no ar, sem versão conferida → nao_chegou "Publicação dispensada"', async () => {
    await db.pedidoDePublicacao.create({
      data: {
        repositorioId,
        commit: C1,
        modo: 'IMEDIATO',
        estado: 'PUBLICADO',
        concluidoEm: AGORA,
      },
    })
    const d = await db.demanda.create({ data: dadosDaDemanda(repositorioId) })
    const p = await parte(d.id, repositorioId, { chave: 'a' })
    const r = await enviar({ repositorio: 'kustertech-exemplo/portal', commit: C1, demanda: d.id })
    expect(r.status).toBe(200)
    const depois = await db.parteDaDemanda.findUniqueOrThrow({ where: { id: p.id } })
    expect(depois).toMatchObject({ estado: 'NAO_CHEGOU', motivo: 'Publicação dispensada' })
  })

  test('pedido repetido (atendido por pendente) vira a parte ao pedido que vai publicar', async () => {
    const atendente = await db.pedidoDePublicacao.create({
      data: { repositorioId, commit: C1, modo: 'IMEDIATO' },
    })
    const d = await db.demanda.create({ data: dadosDaDemanda(repositorioId) })
    const p = await parte(d.id, repositorioId, { chave: 'a' })
    const r = await enviar({ repositorio: 'kustertech-exemplo/portal', commit: C1, demanda: d.id })
    expect(r.status).toBe(200)
    const depois = await db.parteDaDemanda.findUniqueOrThrow({ where: { id: p.id } })
    expect(depois).toMatchObject({ estado: 'PUBLICANDO', pedidoId: atendente.id })
    const adotado = await db.pedidoDePublicacao.findUniqueOrThrow({ where: { id: atendente.id } })
    expect(adotado.parteId).toBe(p.id)
  })
})

describe('marcarPartesSemPublicacao', () => {
  const HORA = 60 * 60_000
  let ordem = 0
  const demandaComParte = async (
    feitaHa: number,
    extra: { prs?: object[]; pedidoId?: string } = {},
  ) => {
    const d = await db.demanda.create({ data: dadosDaDemanda(repositorioId) })
    const p = await db.parteDaDemanda.create({
      data: {
        demandaId: d.id,
        repositorioId,
        chave: `p${ordem++}`,
        ordem,
        estado: 'FEITA',
        feitaEm: new Date(AGORA.getTime() - feitaHa),
        ...(extra.prs ? { prs: extra.prs } : {}),
        pedidoId: extra.pedidoId ?? null,
      },
    })
    return { d, p }
  }
  const ler = (id: string) => db.parteDaDemanda.findUniqueOrThrow({ where: { id } })

  test('feita há mais de 2 h sem pedido → nao_chegou "Nunca foi publicada" e naoChegouDesde da demanda', async () => {
    const { d, p } = await demandaComParte(3 * HORA)
    expect(await marcarPartesSemPublicacao(AGORA)).toBe(1)
    expect(await ler(p.id)).toMatchObject({
      estado: 'NAO_CHEGOU',
      motivo: 'Nunca foi publicada',
      naoChegouEm: AGORA,
    })
    expect((await db.demanda.findUniqueOrThrow({ where: { id: d.id } })).naoChegouDesde).toEqual(
      AGORA,
    )
    expect(await marcarPartesSemPublicacao(AGORA)).toBe(0)
  })

  test('feita há menos de 2 h, ou com pedido, não muda', async () => {
    const a = await demandaComParte(HORA)
    const pedido = await db.pedidoDePublicacao.create({
      data: { repositorioId, commit: C1, modo: 'IMEDIATO' },
    })
    const b = await demandaComParte(5 * HORA, { pedidoId: pedido.id })
    expect(await marcarPartesSemPublicacao(AGORA)).toBe(0)
    expect((await ler(a.p.id)).estado).toBe('FEITA')
    expect((await ler(b.p.id)).estado).toBe('FEITA')
  })

  const URL_DO_PR = 'https://github.com/kustertech-exemplo/portal/pull/9'
  const prAberto = async () => {
    const url = URL_DO_PR
    await db.pullRequestGitHub.create({
      data: {
        githubId: BigInt(9),
        repositorioId,
        numero: 9,
        titulo: 'PR de exemplo',
        estado: 'ABERTO',
        rascunho: false,
        urlHtml: url,
        branch: 'x',
        shaHead: 'c'.repeat(40),
        issuesReferenciadas: [],
        atualizadoNoGitHub: AGORA,
        sincronizadoEm: AGORA,
      },
    })
  }
  const PR = {
    url: URL_DO_PR,
    repositorio: 'kustertech-exemplo/portal',
    numero: 9,
    estado: 'mergeado',
    mergeCommit: C1,
  }

  test('feita com PR ainda aberto e um pedido → nao_chegou "PR aberto há N d"', async () => {
    await prAberto()
    const pedido = await db.pedidoDePublicacao.create({
      data: { repositorioId, commit: C1, modo: 'IMEDIATO' },
    })
    const { p } = await demandaComParte(3 * 24 * HORA, { prs: [PR], pedidoId: pedido.id })
    expect(await marcarPartesSemPublicacao(AGORA)).toBe(1)
    expect(await ler(p.id)).toMatchObject({ estado: 'NAO_CHEGOU', motivo: 'PR aberto há 3 d' })
  })

  test('com PR aberto e sem pedido nunca é "Nunca foi publicada": 3 h não marca; 25 h → "PR aberto há 1 d"', async () => {
    await prAberto()
    const { p } = await demandaComParte(3 * HORA, { prs: [PR] })
    expect(await marcarPartesSemPublicacao(AGORA)).toBe(0)
    expect((await ler(p.id)).estado).toBe('FEITA')
    await db.parteDaDemanda.update({
      where: { id: p.id },
      data: { feitaEm: new Date(AGORA.getTime() - 25 * HORA) },
    })
    expect(await marcarPartesSemPublicacao(AGORA)).toBe(1)
    expect(await ler(p.id)).toMatchObject({ estado: 'NAO_CHEGOU', motivo: 'PR aberto há 1 d' })
  })
})

describe('pedido e parte: casos do contrato 1 e da versão conferida', () => {
  let n = 0
  const novaParte = async (data: Record<string, unknown>) => {
    const d = await db.demanda.create({ data: dadosDaDemanda(repositorioId) })
    const p = await db.parteDaDemanda.create({
      data: { demandaId: d.id, repositorioId, chave: `q${n++}`, ordem: n, ...data } as never,
    })
    return { d, p }
  }
  const ler = (id: string) => db.parteDaDemanda.findUniqueOrThrow({ where: { id } })

  test('v1: o pedido sem commit que chega com a parte de entrada em curso fica ligado a ela, sem mudar o estado', async () => {
    const { d, p } = await novaParte({ estado: 'EM_CURSO' })
    const r = await enviar({ repositorio: 'kustertech-exemplo/portal', demanda: d.id })
    expect(r.status).toBe(201)
    expect(await ler(p.id)).toMatchObject({
      estado: 'EM_CURSO',
      pedidoId: (r.corpo as { id: string }).id,
      commitAlvo: null,
    })
  })

  test('"já no ar" com versão conferida compara o commitAlvo da parte, não só o do pedido', async () => {
    await db.configuracaoDePublicacao.update({
      where: { repositorioId },
      data: { urlDaVersao: 'https://portal.exemplo.test/versao.json', versaoNoAr: C1 },
    })
    const outra = await novaParte({ estado: 'FEITA', feitaEm: AGORA, commitAlvo: C2 })
    const r = await enviar({
      repositorio: 'kustertech-exemplo/portal',
      commit: C1,
      demanda: outra.d.id,
    })
    expect(r.status).toBe(200)
    expect(await ler(outra.p.id)).toMatchObject({
      estado: 'NAO_CHEGOU',
      motivo: 'Publicação dispensada',
    })

    const mesma = await novaParte({ estado: 'FEITA', feitaEm: AGORA, commitAlvo: C1 })
    await enviar({ repositorio: 'kustertech-exemplo/portal', commit: C1, demanda: mesma.d.id })
    expect((await ler(mesma.p.id)).estado).toBe('PUBLICANDO')
  })
})

describe('marcarPartesSemPublicacao: parte publicando cujo pedido terminou', () => {
  let n = 0
  const comPedido = async (
    pedido: Record<string, unknown>,
    parte: Record<string, unknown> = {},
  ) => {
    const d = await db.demanda.create({ data: dadosDaDemanda(repositorioId) })
    const p = await db.parteDaDemanda.create({
      data: {
        demandaId: d.id,
        repositorioId,
        chave: `s${n++}`,
        ordem: n,
        estado: 'PUBLICANDO',
        feitaEm: AGORA,
        commitAlvo: C1,
        ...parte,
      } as never,
    })
    const ped = await db.pedidoDePublicacao.create({
      data: {
        repositorioId,
        commit: C1,
        modo: 'IMEDIATO',
        demandaId: d.id,
        parteId: p.id,
        ...pedido,
      } as never,
    })
    await db.parteDaDemanda.update({ where: { id: p.id }, data: { pedidoId: ped.id } })
    return { d, p, pedido: ped }
  }
  const ler = (id: string) => db.parteDaDemanda.findUniqueOrThrow({ where: { id } })
  const conserto = (pedidoId: string, estado: 'EM_CURSO' | 'DESISTIU') =>
    db.pedidoDeConserto.create({
      data: { repositorioId, pedidoId, commit: C1, trechoDoLog: '', estado },
    })

  test('conserto que desistiu → nao_chegou "Publicação falhou" e naoChegouDesde', async () => {
    const { d, p, pedido } = await comPedido({ estado: 'FALHOU', concluidoEm: AGORA })
    await db.parteDaDemanda.update({
      where: { id: p.id },
      data: { motivo: 'Consertando a publicação' },
    })
    await conserto(pedido.id, 'DESISTIU')
    expect(await marcarPartesSemPublicacao(AGORA)).toBe(1)
    expect(await ler(p.id)).toMatchObject({
      estado: 'NAO_CHEGOU',
      motivo: 'Publicação falhou',
      naoChegouEm: AGORA,
    })
    expect((await db.demanda.findUniqueOrThrow({ where: { id: d.id } })).naoChegouDesde).toEqual(
      AGORA,
    )
  })

  test('cancelado e publicado sem conferir saem com o motivo do resultado', async () => {
    const a = await comPedido({ estado: 'CANCELADO', concluidoEm: AGORA })
    const b = await comPedido({ estado: 'PUBLICADO', concluidoEm: AGORA })
    expect(await marcarPartesSemPublicacao(AGORA)).toBe(2)
    expect(await ler(a.p.id)).toMatchObject({ estado: 'NAO_CHEGOU', motivo: 'Publicação falhou' })
    expect(await ler(b.p.id)).toMatchObject({
      estado: 'NAO_CHEGOU',
      motivo: 'Publicada sem conferir o site',
    })
  })

  test('pedido pendente, conserto em curso, publicado com versão a conferir e parte por versão ficam como estão', async () => {
    const pendente = await comPedido({ estado: 'PUBLICANDO' })
    const falhou = await comPedido({ estado: 'FALHOU', concluidoEm: AGORA })
    await conserto(falhou.pedido.id, 'EM_CURSO')
    const versao = await db.demanda.create({ data: dadosDaDemanda(repositorioId) })
    const nucleo = await db.parteDaDemanda.create({
      data: {
        demandaId: versao.id,
        repositorioId,
        chave: 'nucleo',
        ordem: 1,
        estado: 'PUBLICANDO',
        chegaAoAr: 'VERSAO',
        motivo: 'Esperando a versão',
        commitAlvo: C2,
        feitaEm: new Date(AGORA.getTime() - 5 * 60 * 60_000),
      },
    })
    expect(await marcarPartesSemPublicacao(AGORA)).toBe(0)
    expect((await ler(pendente.p.id)).estado).toBe('PUBLICANDO')
    expect((await ler(falhou.p.id)).estado).toBe('PUBLICANDO')
    expect(await ler(nucleo.id)).toMatchObject({
      estado: 'PUBLICANDO',
      motivo: 'Esperando a versão',
    })

    await db.configuracaoDePublicacao.update({
      where: { repositorioId },
      data: { urlDaVersao: 'https://portal.exemplo.test/versao.json' },
    })
    const conferido = await comPedido({ estado: 'PUBLICADO', concluidoEm: AGORA })
    expect(await marcarPartesSemPublicacao(AGORA)).toBe(0)
    expect((await ler(conferido.p.id)).estado).toBe('PUBLICANDO')
  })
})
