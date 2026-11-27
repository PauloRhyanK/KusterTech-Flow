import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { caminhoDoArquivo, gravarArquivo } from '@/modules/demandas/arquivos'
import { idDoAnexo } from '@/modules/relatos/model'
import { limparArquivosDeDemandas } from '@/modules/demandas/worker'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-11-20T12:00:00.000Z')
const DIA = 24 * 60 * 60_000
let dir: string
const anterior = process.env.FLOW_ARQUIVOS_DIR

beforeEach(async () => {
  await limparBanco()
  dir = await mkdtemp(join(tmpdir(), 'flow-arquivos-'))
  process.env.FLOW_ARQUIVOS_DIR = dir
})

afterEach(async () => {
  if (anterior === undefined) delete process.env.FLOW_ARQUIVOS_DIR
  else process.env.FLOW_ARQUIVOS_DIR = anterior
  await rm(dir, { recursive: true, force: true })
})

function corpo(texto: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(texto))
      c.close()
    },
  })
}

async function demandaEntregue(entregueEm: Date | null) {
  const repositorio = await db.repositorioGitHub.findFirstOrThrow()
  const projeto = await db.projeto.findFirstOrThrow()
  return db.demanda.create({
    data: {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      titulo: 'Demanda do Projeto Alfa',
      nivel: 'APROVAR_DESENHO',
      temTela: true,
      origem: 'FLOW',
      etapas: [],
      etapaAtual: entregueEm ? 'entregue' : 'desenvolvida',
      entregueEm,
    },
  })
}

async function arquivoNoDisco(demandaId: string, tipo: 'CAPTURA' | 'DESENHO' | 'ANEXO') {
  const id = randomUUID()
  const r = await gravarArquivo(demandaId, id, corpo(`${tipo} ${id}`), 1000)
  expect(r.ok).toBe(true)
  await db.arquivoDaDemanda.create({
    data: {
      id,
      demandaId,
      tipo,
      nome: `${tipo.toLowerCase()}.png`,
      conteudo: tipo === 'DESENHO' ? 'text/html' : 'image/png',
      tamanho: 1,
      enviadoPor: 'fabrica',
    },
  })
  return id
}

async function existe(demandaId: string, arquivoId: string): Promise<boolean> {
  return (await readdir(join(dir, 'demandas', demandaId))).includes(arquivoId)
}

describe('limparArquivosDeDemandas', () => {
  beforeEach(async () => {
    await sincronizarCatalogo(criarFonteFixtures(), agora)
    await db.projeto.create({ data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto alfa' } })
  })

  test('captura de demanda entregue há 91 dias sai do disco e ganha apagadoEm; a de 89 dias fica; o desenho aprovado fica', async () => {
    const velha = await demandaEntregue(new Date(agora.getTime() - 91 * DIA))
    const nova = await demandaEntregue(new Date(agora.getTime() - 89 * DIA))
    const aberta = await demandaEntregue(null)
    const capturaVelha = await arquivoNoDisco(velha.id, 'CAPTURA')
    const desenhoVelho = await arquivoNoDisco(velha.id, 'DESENHO')
    const capturaNova = await arquivoNoDisco(nova.id, 'CAPTURA')
    const capturaAberta = await arquivoNoDisco(aberta.id, 'CAPTURA')

    const r = await limparArquivosDeDemandas(agora)

    expect(r).toEqual({ capturas: 1, parciais: 0, anexosDeRelatos: 0 })
    expect(await existe(velha.id, capturaVelha)).toBe(false)
    expect(await existe(velha.id, desenhoVelho)).toBe(true)
    expect(await existe(nova.id, capturaNova)).toBe(true)
    expect(await existe(aberta.id, capturaAberta)).toBe(true)
    const apagados = await db.arquivoDaDemanda.findMany({ where: { apagadoEm: { not: null } } })
    expect(apagados.map((a) => a.id)).toEqual([capturaVelha])
    expect(apagados[0]!.apagadoEm).toEqual(agora)

    // Rodar de novo não conta a mesma captura.
    expect(await limparArquivosDeDemandas(agora)).toEqual({
      capturas: 0,
      parciais: 0,
      anexosDeRelatos: 0,
    })
  })

  test('captura vencida já ausente do disco também ganha apagadoEm', async () => {
    const velha = await demandaEntregue(new Date(agora.getTime() - 91 * DIA))
    const id = await arquivoNoDisco(velha.id, 'CAPTURA')
    await rm(caminhoDoArquivo(velha.id, id))
    expect(await limparArquivosDeDemandas(agora)).toEqual({
      capturas: 1,
      parciais: 0,
      anexosDeRelatos: 0,
    })
    expect((await db.arquivoDaDemanda.findUniqueOrThrow({ where: { id } })).apagadoEm).toEqual(
      agora,
    )
  })

  test('.parcial com 2 dias sai; com 1 hora fica', async () => {
    const demandaId = randomUUID()
    const pasta = join(dir, 'demandas', demandaId)
    await mkdir(pasta, { recursive: true })
    const velho = `${randomUUID()}.parcial`
    const recente = `${randomUUID()}.parcial`
    const completo = randomUUID()
    for (const nome of [velho, recente, completo]) await writeFile(join(pasta, nome), 'x')
    const doisDias = new Date(agora.getTime() - 2 * DIA)
    await utimes(join(pasta, velho), doisDias, doisDias)
    await utimes(join(pasta, completo), doisDias, doisDias)
    const umaHora = new Date(agora.getTime() - 60 * 60_000)
    await utimes(join(pasta, recente), umaHora, umaHora)

    const r = await limparArquivosDeDemandas(agora)

    expect(r).toEqual({ capturas: 0, parciais: 1, anexosDeRelatos: 0 })
    expect((await readdir(pasta)).sort()).toEqual([completo, recente].sort())
  })

  test('sem o diretório de arquivos não falha', async () => {
    process.env.FLOW_ARQUIVOS_DIR = join(dir, 'nao-existe')
    expect(await limparArquivosDeDemandas(agora)).toEqual({
      capturas: 0,
      parciais: 0,
      anexosDeRelatos: 0,
    })
  })
})

describe('anexos de relatos', () => {
  beforeEach(async () => {
    await sincronizarCatalogo(criarFonteFixtures(), agora)
    await db.projeto.create({ data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto alfa' } })
  })

  async function sistema() {
    const repositorio = await db.repositorioGitHub.findFirstOrThrow()
    const projeto = await db.projeto.findFirstOrThrow()
    return db.sistemaConectado.create({
      data: {
        nome: 'App',
        url: 'https://app.exemplo.com/v1',
        projetoId: projeto.id,
        repositorioId: repositorio.id,
      },
    })
  }

  /** Demanda com um relato SEGUE e um anexo derivado gravado no disco. */
  async function relatoComAnexo(demandaId: string, sistemaId: string, idExterno: string) {
    await db.relato.create({
      data: {
        sistemaId,
        idExterno,
        resultado: 'SEGUE',
        canal: 'SISTEMA',
        em: agora,
        autorIdExterno: 'u1',
        autorNome: 'Ana',
        autorPapel: 'cliente',
        demandaId,
        anexos: [{ tipo: 'imagem', bytes: 1, caminho: '/x.png' }],
      },
    })
    const id = idDoAnexo(`${sistemaId}:${idExterno}`, 0)
    const r = await gravarArquivo(demandaId, id, corpo(`ANEXO ${id}`), 1000)
    expect(r.ok).toBe(true)
    await db.arquivoDaDemanda.create({
      data: {
        id,
        demandaId,
        tipo: 'ANEXO',
        nome: 'imagem-1-do-relato',
        conteudo: 'image/png',
        tamanho: 1,
        enviadoPor: 'flow',
      },
    })
    return id
  }

  test('apaga o anexo do relato vencido e mantém o anexo manual e a captura recente', async () => {
    const s = await sistema()
    const demanda = await demandaEntregue(null)
    await db.demanda.update({
      where: { id: demanda.id },
      data: { noArEm: new Date(agora.getTime() - 91 * DIA) },
    })
    const doRelato = await relatoComAnexo(demanda.id, s.id, 'r1')
    const manual = await arquivoNoDisco(demanda.id, 'ANEXO')
    const recente = await demandaEntregue(new Date(agora.getTime() - 10 * DIA))
    const captura = await arquivoNoDisco(recente.id, 'CAPTURA')

    const r = await limparArquivosDeDemandas(agora)

    expect(r).toEqual({ capturas: 0, parciais: 0, anexosDeRelatos: 1 })
    const linha = await db.arquivoDaDemanda.findUniqueOrThrow({ where: { id: doRelato } })
    expect(linha.apagadoEm).toEqual(agora)
    expect(await existe(demanda.id, doRelato)).toBe(false)
    expect(await existe(demanda.id, manual)).toBe(true)
    expect(
      (await db.arquivoDaDemanda.findUniqueOrThrow({ where: { id: manual } })).apagadoEm,
    ).toBeNull()
    expect(await existe(recente.id, captura)).toBe(true)
  })

  test('não apaga anexo de relato com a demanda no ar há 89 dias', async () => {
    const s = await sistema()
    const demanda = await demandaEntregue(null)
    await db.demanda.update({
      where: { id: demanda.id },
      data: { noArEm: new Date(agora.getTime() - 89 * DIA) },
    })
    const id = await relatoComAnexo(demanda.id, s.id, 'r1')

    expect(await limparArquivosDeDemandas(agora)).toEqual({
      capturas: 0,
      parciais: 0,
      anexosDeRelatos: 0,
    })
    expect(await existe(demanda.id, id)).toBe(true)
  })

  test('conta da data do último evento quando a demanda foi descartada sem ir ao ar', async () => {
    const s = await sistema()
    const demanda = await demandaEntregue(null)
    await db.demanda.update({ where: { id: demanda.id }, data: { encerrada: 'descartada' } })
    for (const [i, dias] of [100, 91].entries()) {
      await db.eventoDaDemanda.create({
        data: {
          idExterno: `ev-${demanda.id}-${i}`,
          demandaId: demanda.id,
          tipo: 'x',
          origem: 'flow',
          dados: {},
          em: new Date(agora.getTime() - dias * DIA),
        },
      })
    }
    const id = await relatoComAnexo(demanda.id, s.id, 'r1')

    const r = await limparArquivosDeDemandas(agora)

    expect(r.anexosDeRelatos).toBe(1)
    expect(await existe(demanda.id, id)).toBe(false)
  })

  test('segunda rodada não apaga de novo', async () => {
    const s = await sistema()
    const demanda = await demandaEntregue(null)
    await db.demanda.update({
      where: { id: demanda.id },
      data: { noArEm: new Date(agora.getTime() - 91 * DIA) },
    })
    await relatoComAnexo(demanda.id, s.id, 'r1')

    expect((await limparArquivosDeDemandas(agora)).anexosDeRelatos).toBe(1)
    expect((await limparArquivosDeDemandas(agora)).anexosDeRelatos).toBe(0)
  })
})
