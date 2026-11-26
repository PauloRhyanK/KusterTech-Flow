import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { receberEventoDaFabrica } from '@/modules/demandas/recepcao-fabrica'
import { abrirDemanda } from '@/modules/demandas/service'
import { criarFonteDaFabrica } from '@/modules/fabrica/service'
import { enfileirarAutomaticos } from '@/modules/relatos/andamento'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-19T15:00:00.000Z')

let admin: Sujeito
let token: string
let projetoId: string
let repositorioId: string
let sistemaId: string
let githubId = 19000
let issue = 5000
const tetoAnterior = process.env.DEMANDAS_POR_DIVISAO_POR_DIA

async function novaDemanda(titulo: string): Promise<string> {
  const { id } = await db.$transaction((tx) =>
    abrirDemanda(
      tx,
      {
        projetoId,
        repositorioId,
        titulo,
        descricao: `Descrição de ${titulo}`,
        tipo: null,
        nivel: 'vai_sozinho',
        temTela: true,
        origem: 'usuario',
        usuarioId: admin.usuarioId,
      },
      new Date(),
    ),
  )
  return id
}

async function novoRelato(demandaId: string | null): Promise<string> {
  const r = await db.relato.create({
    data: {
      sistemaId,
      idExterno: randomUUID(),
      resultado: 'SEGUE',
      canal: 'SISTEMA',
      em: AGORA,
      autorIdExterno: randomUUID(),
      autorNome: 'Pessoa',
      autorPapel: 'atendente',
      texto: 'não funciona',
      demandaId,
    },
  })
  return r.id
}

async function novoErro(
  demandaId: string | null,
  o: { repositorioId?: string; esperaDesde?: Date | null } = {},
): Promise<string> {
  issue += 1
  const e = await db.erroDoGlitchTip.create({
    data: {
      issueId: String(issue),
      projetoGlitchTip: 'app',
      repositorioId: o.repositorioId ?? repositorioId,
      titulo: `Erro ${issue}`,
      nivel: 'error',
      link: `https://glitchtip.exemplo.com/issues/${issue}`,
      eventos: 3,
      usuarios: 2,
      primeiroEm: AGORA,
      ultimoEm: AGORA,
      demandaId,
      esperaDesde: o.esperaDesde ?? null,
    },
  })
  return e.id
}

function pedirEvento(demandaId: string, corpo: unknown) {
  const texto = JSON.stringify(corpo)
  const autorizacao = `Bearer ${token}`
  return receberEventoDaFabrica(autorizacao, demandaId, {
    authorization: autorizacao,
    contentType: 'application/json',
    contentLength: String(Buffer.byteLength(texto)),
    corpo: async () => texto,
  })
}

const evento = (tipo: string, dados: unknown, id: string = randomUUID()) => ({
  id,
  em: '2026-11-19T15:00:00Z',
  tipo,
  dados,
})

const juntar = (em: string, id?: string) =>
  evento('juntar', { em, motivo: 'mesmo defeito na tela de entrada' }, id)

const parte = (titulo: string) => ({
  titulo,
  descricao: `Fazer ${titulo}`,
  tipo: 'ajuste',
})

const triagem = () =>
  evento('triagem', {
    tipo: 'ajuste',
    destino: 'fila_de_agentes',
    tamanho: 'pequeno',
    mexeEm: 'tela de entrada',
    risco: 'baixo',
    dados: 'nenhum',
    impacto: { toca: [], podeQuebrar: [], autorizacao: false, caminhoProtegido: false },
    resposta: null,
    motivo: 'ajuste simples',
  })

const eventosDe = (demandaId: string, tipo: string) =>
  db.eventoDaDemanda.findMany({ where: { demandaId, tipo }, orderBy: { seq: 'asc' } })

beforeEach(async () => {
  await limparBanco()
  delete process.env.DEMANDAS_POR_DIVISAO_POR_DIA
  const usuario = await criarUsuario({
    email: 'admin-triagem-cruzada@local.test',
    nome: 'Admin Cruzada',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  token = (await criarFonteDaFabrica(admin, 'Fábrica')).token
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto alfa' },
  })
  projetoId = projeto.id
  githubId += 1
  const repo = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(githubId),
      instalacaoId: BigInt(1),
      nomeCompleto: `kustertech-exemplo/alfa-${githubId}`,
      urlHtml: `https://github.com/kustertech-exemplo/alfa-${githubId}`,
      privado: true,
      catalogadoEm: AGORA,
      projetoId,
    },
  })
  repositorioId = repo.id
  const sistema = await db.sistemaConectado.create({
    data: { nome: 'Sistema Alfa', url: 'https://alfa.exemplo.com/v1', projetoId, repositorioId },
  })
  sistemaId = sistema.id
})

afterEach(() => {
  if (tetoAnterior === undefined) delete process.env.DEMANDAS_POR_DIVISAO_POR_DIA
  else process.env.DEMANDAS_POR_DIVISAO_POR_DIA = tetoAnterior
})

afterAll(async () => {
  await db.$disconnect()
})

describe('juntar', () => {
  test('move relatos e erros de B para A, encerra B como juntada e avisa os relatos com o estado de A', async () => {
    const a = await novaDemanda('A')
    const b = await novaDemanda('B')
    expect((await pedirEvento(a, triagem())).status).toBe(201)
    const relatos = [await novoRelato(b), await novoRelato(b)]
    const erro = await novoErro(b)

    const r = await pedirEvento(b, juntar(a))
    expect(r.status).toBe(201)

    const movidos = await db.relato.findMany({ where: { id: { in: relatos } } })
    expect(movidos.map((x) => x.demandaId)).toEqual([a, a])
    expect((await db.erroDoGlitchTip.findUniqueOrThrow({ where: { id: erro } })).demandaId).toBe(a)

    const linhaB = await db.demanda.findUniqueOrThrow({ where: { id: b } })
    expect(linhaB.encerrada).toBe('juntada')
    expect(linhaB.juntadaEmId).toBe(a)

    const [juntada] = await eventosDe(b, 'juntada')
    expect(juntada).toMatchObject({ origem: 'flow' })
    const dados = juntada!.dados as { em: string; relatos: string[]; erros: string[] }
    expect(dados.em).toBe(a)
    expect([...dados.relatos].sort()).toEqual([...relatos].sort())
    expect(dados.erros).toEqual([erro])
    // O evento recebido fica como veio (idempotência).
    const [recebido] = await eventosDe(b, 'juntar')
    expect(recebido!.dados).toEqual({ em: a, motivo: 'mesmo defeito na tela de entrada' })

    const [ligada] = await eventosDe(a, 'evidencia_ligada')
    expect(ligada).toMatchObject({ origem: 'flow' })
    expect(ligada!.dados).toEqual({
      de: b,
      motivo: 'mesmo defeito na tela de entrada',
      relatos: 2,
      erros: 1,
    })

    await enfileirarAutomaticos(AGORA)
    const envios = await db.envioDeAndamento.findMany({ where: { relatoId: { in: relatos } } })
    expect(envios.map((e) => e.estado)).toEqual(['na-fila', 'na-fila'])
  })

  test('com A no ar responde 422 e nada muda; repetir o mesmo id responde 200 repetido', async () => {
    const a = await novaDemanda('A')
    const b = await novaDemanda('B')
    await db.demanda.update({ where: { id: a }, data: { noArEm: AGORA } })
    const relato = await novoRelato(b)

    const r = await pedirEvento(b, juntar(a))
    expect(r.status).toBe(422)
    expect((await db.relato.findUniqueOrThrow({ where: { id: relato } })).demandaId).toBe(b)
    const linhaB = await db.demanda.findUniqueOrThrow({ where: { id: b } })
    expect(linhaB).toMatchObject({ encerrada: null, juntadaEmId: null })
    expect(await eventosDe(b, 'juntar')).toHaveLength(0)
    expect(await eventosDe(a, 'evidencia_ligada')).toHaveLength(0)

    const c = await novaDemanda('C')
    const id = randomUUID()
    expect((await pedirEvento(b, juntar(c, id))).status).toBe(201)
    const repetido = await pedirEvento(b, juntar(c, id))
    expect(repetido.status).toBe(200)
    expect(repetido.corpo).toMatchObject({ resultado: 'repetido' })
    expect(await eventosDe(b, 'juntada')).toHaveLength(1)
  })

  test('cruzado: depois de juntar B em A, juntar A em B responde 422', async () => {
    const a = await novaDemanda('A')
    const b = await novaDemanda('B')
    expect((await pedirEvento(b, juntar(a))).status).toBe(201)
    expect((await pedirEvento(a, juntar(b))).status).toBe(422)
    expect((await db.demanda.findUniqueOrThrow({ where: { id: a } })).encerrada).toBeNull()
  })

  test('cruzado ao mesmo tempo: um passa e o outro é recusado', async () => {
    const a = await novaDemanda('A')
    const b = await novaDemanda('B')
    const r = await Promise.all([pedirEvento(b, juntar(a)), pedirEvento(a, juntar(b))])
    expect(r.map((x) => x.status).sort()).toEqual([201, 422])
  })

  test('ligar_erros seguido de juntar: o erro termina em A', async () => {
    const a = await novaDemanda('A')
    const b = await novaDemanda('B')
    const erro = await novoErro(null)
    const ligar = evento('ligar_erros', { erros: [erro], motivo: 'mesmo erro' })
    expect((await pedirEvento(b, ligar)).status).toBe(201)
    expect((await pedirEvento(b, juntar(a))).status).toBe(201)
    expect((await db.erroDoGlitchTip.findUniqueOrThrow({ where: { id: erro } })).demandaId).toBe(a)
  })
})

describe('ligar_erros', () => {
  test('com um erro que já tem demanda responde 422 e nenhum erro muda', async () => {
    const d = await novaDemanda('D')
    const outra = await novaDemanda('Outra')
    const livre = await novoErro(null, { esperaDesde: AGORA })
    const ocupado = await novoErro(outra)
    const r = await pedirEvento(
      d,
      evento('ligar_erros', { erros: [livre, ocupado], motivo: 'mesmo erro' }),
    )
    expect(r.status).toBe(422)
    const erros = await db.erroDoGlitchTip.findMany({ where: { id: { in: [livre, ocupado] } } })
    expect(erros.find((e) => e.id === livre)).toMatchObject({ demandaId: null, esperaDesde: AGORA })
    expect(erros.find((e) => e.id === ocupado)).toMatchObject({ demandaId: outra })
    expect(await eventosDe(d, 'erro-ligado')).toHaveLength(0)
  })

  test('com erro de outro projeto responde 422', async () => {
    const d = await novaDemanda('D')
    const outro = await db.projeto.create({
      data: { nome: 'Projeto Beta', nomeNormalizado: 'projeto beta' },
    })
    githubId += 1
    const repo = await db.repositorioGitHub.create({
      data: {
        githubId: BigInt(githubId),
        instalacaoId: BigInt(1),
        nomeCompleto: `kustertech-exemplo/beta-${githubId}`,
        urlHtml: `https://github.com/kustertech-exemplo/beta-${githubId}`,
        privado: true,
        catalogadoEm: AGORA,
        projetoId: outro.id,
      },
    })
    const erro = await novoErro(null, { repositorioId: repo.id })
    const r = await pedirEvento(d, evento('ligar_erros', { erros: [erro], motivo: 'x' }))
    expect(r.status).toBe(422)
  })

  test('liga os erros, zera esperaDesde e grava um erro-ligado por erro', async () => {
    const d = await novaDemanda('D')
    const e1 = await novoErro(null, { esperaDesde: AGORA })
    const e2 = await novoErro(null)
    const r = await pedirEvento(d, evento('ligar_erros', { erros: [e1, e2], motivo: 'mesmo erro' }))
    expect(r.status).toBe(201)
    const erros = await db.erroDoGlitchTip.findMany({ where: { id: { in: [e1, e2] } } })
    for (const e of erros) expect(e).toMatchObject({ demandaId: d, esperaDesde: null })
    const ligados = await eventosDe(d, 'erro-ligado')
    expect(ligados).toHaveLength(2)
    expect(ligados[0]).toMatchObject({ origem: 'fabrica' })
    const primeiro = erros.find((e) => e.id === e1)!
    expect(ligados.map((x) => x.dados)).toContainEqual({
      titulo: primeiro.titulo,
      issueId: primeiro.issueId,
      motivo: 'mesmo erro',
    })
    expect((await db.demanda.findUniqueOrThrow({ where: { id: d } })).encerrada).toBeNull()
  })
})

describe('dividir', () => {
  const dividir = (n: number) =>
    evento('dividir', {
      partes: Array.from({ length: n }, (_, i) => parte(`Parte ${i + 1}`)),
      motivo: 'eram pedidos diferentes',
    })

  test('com 3 partes cria 2 demandas e a original muda de título', async () => {
    const d = await novaDemanda('Original')
    const r = await pedirEvento(d, dividir(3))
    expect(r.status).toBe(201)

    const original = await db.demanda.findUniqueOrThrow({ where: { id: d } })
    expect(original.titulo).toBe('Parte 1')
    expect(original.encerrada).toBeNull()

    const novas = await db.demanda.findMany({
      where: { divididaDeId: d },
      orderBy: { titulo: 'asc' },
    })
    expect(novas.map((n) => n.titulo)).toEqual(['Parte 2', 'Parte 3'])
    for (const n of novas) {
      expect(n).toMatchObject({
        projetoId,
        repositorioId,
        origem: 'USUARIO',
        temTela: true,
        tipo: 'AJUSTE',
      })
      expect(n.descricao).toBe(`Fazer ${n.titulo}\n\nVeio da demanda /demandas/${d}`)
      expect(await eventosDe(n.id, 'criada')).toHaveLength(1)
      const [veio] = await eventosDe(n.id, 'veio_de')
      expect(veio).toMatchObject({ origem: 'flow', dados: { de: d } })
    }
    const [dividida] = await eventosDe(d, 'dividida')
    expect(dividida).toMatchObject({ origem: 'flow' })
    expect(dividida!.dados).toEqual({
      motivo: 'eram pedidos diferentes',
      novas: expect.arrayContaining(novas.map((n) => n.id)),
    })
  })

  test('com 4 veio_de nas últimas 24 h, outro de 3 partes responde 422', async () => {
    expect((await pedirEvento(await novaDemanda('X'), dividir(3))).status).toBe(201)
    expect((await pedirEvento(await novaDemanda('Y'), dividir(3))).status).toBe(201)
    expect(await db.eventoDaDemanda.count({ where: { tipo: 'veio_de' } })).toBe(4)

    const z = await novaDemanda('Z')
    const antes = await db.demanda.count()
    const r = await pedirEvento(z, dividir(3))
    expect(r.status).toBe(422)
    expect(await db.demanda.count()).toBe(antes)
    expect((await db.demanda.findUniqueOrThrow({ where: { id: z } })).titulo).toBe('Z')
  })
})
