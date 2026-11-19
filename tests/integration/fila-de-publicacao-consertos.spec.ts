import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import type { RetratoV1 } from '@/modules/fabrica/contrato'
import exemplo from '@/modules/fabrica/retrato-exemplo.json'
import { receberRetratoDaFabrica } from '@/modules/fabrica/recepcao'
import { criarFonteDaFabrica } from '@/modules/fabrica/service'
import { MOTIVOS } from '@/modules/fila-de-publicacao/model'
import { processarFilaDePublicacao } from '@/modules/fila-de-publicacao/worker'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-19T15:00:00.000Z')
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000)
/** O instante do contrato (`AAAA-MM-DDTHH:MM:SSZ`). */
const instante = (d: Date) => d.toISOString().replace('.000Z', 'Z')
const PORTAL = 'kustertech-exemplo/portal'
const COMMIT = 'a'.repeat(40)
const SHA_MERGE = 'b'.repeat(40)
const PR_URL = `https://github.com/${PORTAL}/pull/9`
const EXECUCAO_URL = `https://github.com/${PORTAL}/actions/runs/1`

type Reportado = NonNullable<RetratoV1['consertos']>[number]

let token: string
let repositorioId: string
let consertoId: string

async function abrirConserto() {
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto Portal', nomeNormalizado: 'projeto-portal' },
  })
  const repo = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(5001),
      instalacaoId: BigInt(900001),
      nomeCompleto: PORTAL,
      urlHtml: `https://github.com/${PORTAL}`,
      privado: false,
      projetoId: projeto.id,
      vinculadoEm: AGORA,
      catalogadoEm: AGORA,
    },
  })
  repositorioId = repo.id
  await db.configuracaoDePublicacao.create({
    data: {
      repositorioId,
      workflow: 'deploy.yml',
      situacao: 'CONSERTANDO',
      situacaoDesde: AGORA,
    },
  })
  const falho = await db.pedidoDePublicacao.create({
    data: {
      repositorioId,
      commit: COMMIT,
      modo: 'IMEDIATO',
      estado: 'FALHOU',
      execucaoUrl: EXECUCAO_URL,
      concluidoEm: AGORA,
    },
  })
  const conserto = await db.pedidoDeConserto.create({
    data: {
      repositorioId,
      pedidoId: falho.id,
      commit: COMMIT,
      execucaoUrl: EXECUCAO_URL,
      trechoDoLog: 'Error: build quebrou',
      abertoEm: AGORA,
    },
  })
  consertoId = conserto.id
}

async function criarPr(estado: 'ABERTO' | 'FECHADO' | 'MERGEADO') {
  await db.pullRequestGitHub.create({
    data: {
      githubId: BigInt(777),
      repositorioId,
      numero: 9,
      titulo: 'Corrige o deploy',
      estado,
      rascunho: false,
      urlHtml: PR_URL,
      branch: 'conserto',
      shaHead: 'c'.repeat(40),
      shaMerge: estado === 'MERGEADO' ? SHA_MERGE : null,
      issuesReferenciadas: [],
      atualizadoNoGitHub: minutos(5),
      mergeadoNoGitHub: estado === 'MERGEADO' ? minutos(5) : null,
      sincronizadoEm: minutos(5),
    },
  })
}

const reportado = (r: Partial<Reportado> = {}): Reportado => ({
  id: consertoId,
  estado: 'em_curso',
  runId: 'run-1',
  prUrl: null,
  motivo: null,
  em: instante(AGORA),
  ...r,
})

function enviar(geradoEm: Date, consertos?: Reportado[], agora: Date = geradoEm) {
  const corpo = { ...exemplo, geradoEm: instante(geradoEm), ...(consertos ? { consertos } : {}) }
  const texto = JSON.stringify(corpo)
  return receberRetratoDaFabrica(
    {
      authorization: `Bearer ${token}`,
      contentType: 'application/json',
      contentLength: String(Buffer.byteLength(texto)),
      corpo: async () => texto,
    },
    agora,
  )
}

const conserto = () => db.pedidoDeConserto.findUniqueOrThrow({ where: { id: consertoId } })
const config = () => db.configuracaoDePublicacao.findUniqueOrThrow({ where: { repositorioId } })
const correcoes = () => db.pedidoDePublicacao.findMany({ where: { consertoId } })

/** O conserto com PR, como depois do retrato com `com_pr`. */
async function comPr() {
  await enviar(minutos(1), [reportado({ estado: 'com_pr', prUrl: PR_URL })])
  expect((await conserto()).estado).toBe('COM_PR')
}

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-consertos@local.test',
    nome: 'Admin Consertos',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  const admin: Sujeito = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  token = (await criarFonteDaFabrica(admin, 'Máquina de agentes')).token
  await abrirConserto()
})

afterAll(async () => {
  await db.$disconnect()
})

describe('consertos pela resposta do retrato', () => {
  test('resposta traz o conserto ABERTO com repositorio, commit, execucaoUrl, trechoDoLog e abertoEm no formato do contrato', async () => {
    const r = await enviar(AGORA)
    expect(r).toEqual({
      status: 200,
      corpo: {
        resultado: 'gravado',
        consertos: [
          {
            id: consertoId,
            repositorio: PORTAL,
            commit: COMMIT,
            execucaoUrl: EXECUCAO_URL,
            trechoDoLog: 'Error: build quebrou',
            abertoEm: '2026-11-19T15:00:00Z',
          },
        ],
      },
    })
    // O id é o UUID canônico minúsculo que o kit aceita (`retrato.ID_DO_CONSERTO`).
    expect(consertoId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  test('retrato com em_curso → EM_CURSO com pegoEm; depois com_pr → COM_PR com prUrl; a resposta seguinte não lista mais o conserto', async () => {
    const r1 = await enviar(minutos(1), [reportado()])
    let c = await conserto()
    expect(c.estado).toBe('EM_CURSO')
    expect(c.pegoEm).toEqual(minutos(1))
    expect(c.runId).toBe('run-1')
    expect(r1.corpo).toMatchObject({ resultado: 'gravado', consertos: [{ id: consertoId }] })

    const r2 = await enviar(minutos(2), [reportado({ estado: 'com_pr', prUrl: PR_URL })])
    c = await conserto()
    expect(c.estado).toBe('COM_PR')
    expect(c.prUrl).toBe(PR_URL)
    expect(c.pegoEm).toEqual(minutos(1))
    expect(r2.corpo).toEqual({ resultado: 'gravado', consertos: [] })
    expect((await config()).situacao).toBe('CONSERTANDO')
  })

  test('retrato com desistiu → DESISTIU e fila PARADO "o agente não conseguiu consertar"', async () => {
    const r = await enviar(minutos(1), [
      reportado({ estado: 'desistiu', motivo: 'o run terminou (failed) sem abrir PR' }),
    ])
    const c = await conserto()
    expect(c.estado).toBe('DESISTIU')
    expect(c.motivo).toBe('o run terminou (failed) sem abrir PR')
    expect(c.encerradoEm).toEqual(minutos(1))
    const cfg = await config()
    expect(cfg.situacao).toBe('PARADO')
    expect(cfg.situacaoMotivo).toBe(MOTIVOS.desistiu)
    expect(cfg.situacaoDesde).toEqual(minutos(1))
    expect(r.corpo).toEqual({ resultado: 'gravado', consertos: [] })
  })

  test('Review Focus 5: retrato descartado (geradoEm antigo) não aplica consertos; id desconhecido é ignorado; com_pr seguido de em_curso não volta', async () => {
    await enviar(minutos(5))
    const descartado = await enviar(
      minutos(4),
      [reportado({ estado: 'desistiu', motivo: 'x' })],
      minutos(6),
    )
    expect(descartado.corpo).toMatchObject({
      resultado: 'descartado',
      consertos: [{ id: consertoId }],
    })
    expect((await conserto()).estado).toBe('ABERTO')
    expect((await config()).situacao).toBe('CONSERTANDO')

    const desconhecido = await enviar(minutos(7), [
      reportado({ id: '0b6f3c2e-6a1d-4c8e-9f00-1a2b3c4d5e6f', estado: 'desistiu', motivo: 'x' }),
    ])
    expect(desconhecido.status).toBe(200)
    expect((await conserto()).estado).toBe('ABERTO')
    expect((await config()).situacao).toBe('CONSERTANDO')

    await enviar(minutos(8), [reportado({ estado: 'com_pr', prUrl: PR_URL })])
    await enviar(minutos(9), [reportado({ estado: 'em_curso', runId: 'run-2' })])
    const c = await conserto()
    expect(c.estado).toBe('COM_PR')
    expect(c.runId).toBe('run-1')
    await enviar(minutos(10), [reportado({ estado: 'desistiu', motivo: 'x' })])
    expect((await conserto()).estado).toBe('COM_PR')
    expect((await config()).situacao).toBe('CONSERTANDO')
  })

  test('com_pr sem prUrl é ignorado: o conserto segue listado', async () => {
    const r = await enviar(minutos(1), [reportado({ estado: 'com_pr', prUrl: null })])
    expect((await conserto()).estado).toBe('ABERTO')
    expect(r.corpo).toMatchObject({ consertos: [{ id: consertoId }] })
  })
})

describe('PR do conserto no worker', () => {
  test('PR do conserto MERGEADO → um pedido IMEDIATO do shaMerge; ciclo repetido não cria outro', async () => {
    await comPr()
    await criarPr('ABERTO')
    await processarFilaDePublicacao(null, minutos(3))
    expect(await correcoes()).toHaveLength(0)

    await db.pullRequestGitHub.update({
      where: { githubId: BigInt(777) },
      data: { estado: 'MERGEADO', shaMerge: SHA_MERGE },
    })
    await processarFilaDePublicacao(null, minutos(6))
    await processarFilaDePublicacao(null, minutos(7))
    const lista = await correcoes()
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({
      repositorioId,
      commit: SHA_MERGE,
      modo: 'IMEDIATO',
      estado: 'NA_FILA',
      descricao: 'Correção do conserto',
      fonteId: null,
      usuarioId: null,
    })
    const c = await conserto()
    expect(c.estado).toBe('COM_PR')
    expect(c.shaDaCorrecao).toBe(SHA_MERGE)
    expect((await config()).situacao).toBe('CONSERTANDO')
  })

  test('pedido da correção publicado → conserto RESOLVIDO e fila NORMAL; falhou → fila PARADO "a publicação seguinte falhou de novo"', async () => {
    await comPr()
    await criarPr('MERGEADO')
    await processarFilaDePublicacao(null, minutos(6))
    const [correcao] = await correcoes()
    await db.pedidoDePublicacao.update({
      where: { id: correcao!.id },
      data: { estado: 'PUBLICADO', concluidoEm: minutos(8) },
    })
    await processarFilaDePublicacao(null, minutos(9))
    const c = await conserto()
    expect(c.estado).toBe('RESOLVIDO')
    expect(c.encerradoEm).toEqual(minutos(9))
    const cfg = await config()
    expect(cfg.situacao).toBe('NORMAL')
    expect(cfg.situacaoMotivo).toBeNull()
    expect(cfg.situacaoDesde).toEqual(minutos(9))

    // Outro conserto do mesmo repositório cuja correção falha.
    await db.configuracaoDePublicacao.update({
      where: { repositorioId },
      data: { situacao: 'CONSERTANDO' },
    })
    await db.pedidoDeConserto.update({
      where: { id: consertoId },
      data: { estado: 'COM_PR', encerradoEm: null },
    })
    await db.pedidoDePublicacao.update({
      where: { id: correcao!.id },
      data: { estado: 'FALHOU' },
    })
    const r = await processarFilaDePublicacao(null, minutos(10))
    expect(r.parados).toBe(1)
    const desistiu = await conserto()
    expect(desistiu.estado).toBe('DESISTIU')
    expect(desistiu.motivo).toBe(MOTIVOS.falhouDeNovo)
    const parado = await config()
    expect(parado.situacao).toBe('PARADO')
    expect(parado.situacaoMotivo).toBe(MOTIVOS.falhouDeNovo)
  })

  test('PR do conserto FECHADO sem merge → DESISTIU e PARADO "o PR do conserto foi fechado sem merge"', async () => {
    await comPr()
    await criarPr('FECHADO')
    const r = await processarFilaDePublicacao(null, minutos(6))
    expect(r.parados).toBe(1)
    const c = await conserto()
    expect(c.estado).toBe('DESISTIU')
    expect(c.motivo).toBe(MOTIVOS.prFechado)
    expect(c.encerradoEm).toEqual(minutos(6))
    const cfg = await config()
    expect(cfg.situacao).toBe('PARADO')
    expect(cfg.situacaoMotivo).toBe(MOTIVOS.prFechado)
    expect(await correcoes()).toHaveLength(0)
  })

  test('PR não sincronizado ainda → espera', async () => {
    await comPr()
    await processarFilaDePublicacao(null, minutos(6))
    expect((await conserto()).estado).toBe('COM_PR')
    expect(await correcoes()).toHaveLength(0)
  })
})
