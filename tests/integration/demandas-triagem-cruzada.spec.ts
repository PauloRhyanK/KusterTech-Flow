import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import {
  buscarDemandasParaAFabrica,
  receberEventoDaFabrica,
} from '@/modules/demandas/recepcao-fabrica'
import type { Buscar } from '@/modules/erros/cliente'
import { buscarErrosDoGlitchTip } from '@/modules/erros/service'
import { separarDemanda } from '@/modules/demandas/cruzada-service'
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

describe('ligar_erros e a leitura do GlitchTip', () => {
  test('a leitura depois do ligar_erros mantém a ligação, não abre demanda nem põe na espera', async () => {
    const repo = await db.repositorioGitHub.update({
      where: { id: repositorioId },
      data: { vinculadoEm: AGORA },
    })
    await db.leituraDoGlitchTip.create({
      data: { projetoGlitchTip: 'app', ligadaEm: new Date(AGORA.getTime() - 30 * 86_400_000) },
    })
    const d = await novaDemanda('D')
    const erroId = await novoErro(null)
    const erro = await db.erroDoGlitchTip.findUniqueOrThrow({ where: { id: erroId } })
    const ligar = evento('ligar_erros', { erros: [erroId], motivo: 'mesmo erro' })
    expect((await pedirEvento(d, ligar)).status).toBe(201)
    const demandasAntes = await db.demanda.count()

    const base = 'https://glitchtip.exemplo.com'
    const lista = `${base}/api/0/projects/minha-org/app/issues/?query=is%3Aunresolved`
    const buscar: Buscar = async (url) =>
      url === lista
        ? new Response(
            JSON.stringify([
              {
                id: erro.issueId,
                title: erro.titulo,
                culprit: 'pedidos/entrada.ts',
                level: 'error',
                status: 'unresolved',
                count: '500',
                userCount: 40,
                firstSeen: new Date(AGORA.getTime() - 3_600_000).toISOString(),
                lastSeen: new Date(AGORA.getTime() - 60_000).toISOString(),
                permalink: erro.link,
              },
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        : new Response('{"detail":"Not found"}', { status: 404 })
    const resumo = await buscarErrosDoGlitchTip(AGORA, {
      env: {
        GLITCHTIP_URL: base,
        GLITCHTIP_ORG: 'minha-org',
        GLITCHTIP_TOKEN: 'tok',
        GLITCHTIP_PROJETOS: `app:${repo.nomeCompleto}`,
      },
      buscar,
    })
    expect(resumo).toMatchObject({ projetos: 1, falhas: 0, abertas: 0 })
    expect(await db.erroDoGlitchTip.findUniqueOrThrow({ where: { id: erroId } })).toMatchObject({
      demandaId: d,
      esperaDesde: null,
      eventos: 500,
    })
    expect(await db.demanda.count()).toBe(demandasAntes)
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
    expect(await eventosDe(z, 'dividir')).toHaveLength(0)
    expect(await eventosDe(z, 'dividida')).toHaveLength(0)
    expect(await db.eventoDaDemanda.count({ where: { tipo: 'veio_de' } })).toBe(4)
  })
})

describe('candidatas no GET da Fábrica', () => {
  type Linha = {
    id: string
    candidatas: {
      demandas: { id: string; relatos: number; erros: number; etapa: string }[]
      erros: { id: string; estado: string }[]
    } | null
  }
  const buscar = async (contrato: 1 | 2 = 1) => {
    const r = await buscarDemandasParaAFabrica(`Bearer ${token}`, null, new Date(), contrato)
    expect(r.status).toBe(200)
    return (r.corpo as { demandas: Linha[] }).demandas
  }

  test('traz as abertas do mesmo projeto, os erros em observação e as contagens', async () => {
    const a = await novaDemanda('Demanda A')
    const b = await novaDemanda('Demanda B')
    await novoRelato(a)
    await novoErro(a)
    const outro = await db.projeto.create({
      data: { nome: 'Projeto Beta', nomeNormalizado: 'projeto beta' },
    })
    githubId += 1
    const repoOutro = await db.repositorioGitHub.create({
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
    const { id: deOutro } = await db.$transaction((tx) =>
      abrirDemanda(
        tx,
        {
          projetoId: outro.id,
          repositorioId: repoOutro.id,
          titulo: 'Demanda de outro projeto',
          descricao: null,
          tipo: null,
          nivel: 'vai_sozinho',
          temTela: true,
          origem: 'usuario',
          usuarioId: admin.usuarioId,
        },
        new Date(),
      ),
    )
    const erro = await novoErro(null)
    await novoErro(null, { esperaDesde: AGORA })

    for (const contrato of [1, 2] as const) {
      const linha = (await buscar(contrato)).find((d) => d.id === b)!
      const ids = linha.candidatas!.demandas.map((d) => d.id)
      expect(ids).toContain(a)
      expect(ids).not.toContain(deOutro)
      expect(ids).not.toContain(b)
      const daA = linha.candidatas!.demandas.find((d) => d.id === a)!
      expect(daA).toMatchObject({ relatos: 1, erros: 1, etapa: 'recebida' })
      expect(linha.candidatas!.erros.map((e) => e.estado).sort()).toEqual([
        'em_observacao',
        'na_espera',
      ])
      expect(linha.candidatas!.erros.map((e) => e.id)).toContain(erro)
    }
  })

  test('depois da triagem, candidatas vem null', async () => {
    const b = await novaDemanda('Demanda B')
    expect((await pedirEvento(b, triagem())).status).toBe(201)
    const linha = (await buscar()).find((d) => d.id === b)!
    expect(linha).toHaveProperty('candidatas', null)
  })

  test('uma demanda separada de A não traz A', async () => {
    const a = await novaDemanda('Demanda A')
    const b = await novaDemanda('Demanda B')
    await db.eventoDaDemanda.create({
      data: {
        idExterno: randomUUID(),
        demandaId: b,
        tipo: 'separada',
        origem: 'flow',
        em: AGORA,
        dados: { de: a },
      },
    })
    const linha = (await buscar()).find((d) => d.id === b)!
    expect(linha.candidatas!.demandas.map((d) => d.id)).not.toContain(a)
  })
})

describe('separar', () => {
  const comoLeitor = (): Sujeito => ({
    usuarioId: admin.usuarioId,
    papeis: [{ papel: 'TESTADOR', clienteId: null }],
  })

  async function juntada() {
    const a = await novaDemanda('Demanda A')
    const b = await novaDemanda('Demanda B')
    const relato = await novoRelato(b)
    const erro = await novoErro(b)
    expect((await pedirEvento(b, juntar(a))).status).toBe(201)
    return { a, b, relato, erro }
  }

  test('sem projetos.gerenciar recebe o erro de permissão', async () => {
    const { b } = await juntada()
    await expect(separarDemanda(comoLeitor(), b, AGORA)).rejects.toThrow()
    expect((await db.demanda.findUniqueOrThrow({ where: { id: b } })).encerrada).toBe('juntada')
  })

  test('recusa quando A já foi ao ar', async () => {
    const { a, b } = await juntada()
    await db.demanda.update({ where: { id: a }, data: { noArEm: AGORA } })
    await expect(separarDemanda(admin, b, AGORA)).rejects.toThrow(
      'A demanda de destino já foi ao ar.',
    )
  })

  test('devolve a B o que segue em A, deixa o que foi para C e impede nova junção', async () => {
    const { a, b, relato, erro } = await juntada()
    const c = await novaDemanda('Demanda C')
    // Um dos relatos/erros juntados segue para C depois da junção.
    const relatoDeC = await novoRelato(null)
    const erroDeC = await novoErro(null)
    await db.eventoDaDemanda.updateMany({
      where: { demandaId: b, tipo: 'juntada' },
      data: {
        dados: { em: a, motivo: 'x', relatos: [relato, relatoDeC], erros: [erro, erroDeC] },
      },
    })
    await db.relato.update({ where: { id: relatoDeC }, data: { demandaId: c } })
    await db.erroDoGlitchTip.update({ where: { id: erroDeC }, data: { demandaId: c } })

    await separarDemanda(admin, b, AGORA)

    const linhaB = await db.demanda.findUniqueOrThrow({ where: { id: b } })
    expect(linhaB).toMatchObject({
      encerrada: null,
      juntadaEmId: null,
      etapaAtual: 'recebida',
      concluidas: [],
      destino: null,
      espera: null,
      esperaMotivo: null,
      esperaDesde: null,
    })
    expect(linhaB.triagem).toBeNull()
    expect((await db.relato.findUniqueOrThrow({ where: { id: relato } })).demandaId).toBe(b)
    expect((await db.erroDoGlitchTip.findUniqueOrThrow({ where: { id: erro } })).demandaId).toBe(b)
    expect((await db.relato.findUniqueOrThrow({ where: { id: relatoDeC } })).demandaId).toBe(c)
    expect((await db.erroDoGlitchTip.findUniqueOrThrow({ where: { id: erroDeC } })).demandaId).toBe(
      c,
    )
    const [naB] = await eventosDe(b, 'separada')
    const [naA] = await eventosDe(a, 'separada')
    expect(naB).toMatchObject({ origem: 'paulo', usuarioId: admin.usuarioId, dados: { de: a } })
    expect(naA).toMatchObject({
      origem: 'paulo',
      usuarioId: admin.usuarioId,
      dados: { separou: b },
    })

    const r = await buscarDemandasParaAFabrica(`Bearer ${token}`, null, new Date(), 1)
    const linha = (
      r.corpo as { demandas: { id: string; candidatas: { demandas: { id: string }[] } | null }[] }
    ).demandas.find((d) => d.id === b)!
    expect(linha.candidatas!.demandas.map((d) => d.id)).not.toContain(a)

    const nova = await pedirEvento(b, juntar(a))
    expect(nova.status).toBe(422)
  })

  test('a conta diária do GlitchTip volta a contar B depois de separar', async () => {
    const repo = await db.repositorioGitHub.update({
      where: { id: repositorioId },
      data: { vinculadoEm: AGORA },
    })
    await db.leituraDoGlitchTip.create({
      data: { projetoGlitchTip: 'app', ligadaEm: new Date(AGORA.getTime() - 30 * 86_400_000) },
    })
    const a = await novaDemanda('Demanda A')
    const b = await novaDemanda('Demanda B')
    await db.demanda.update({ where: { id: b }, data: { origem: 'GLITCHTIP' } })
    await db.eventoDaDemanda.updateMany({
      where: { demandaId: b, tipo: 'criada' },
      data: { em: new Date(AGORA.getTime() - 60_000) },
    })
    expect((await pedirEvento(b, juntar(a))).status).toBe(201)
    await separarDemanda(admin, b, AGORA)

    const base = 'https://glitchtip.exemplo.com'
    const lista = `${base}/api/0/projects/minha-org/app/issues/?query=is%3Aunresolved`
    const buscar: Buscar = async (url) =>
      url === lista
        ? new Response(
            JSON.stringify([
              {
                id: '777001',
                title: 'Erro novo',
                culprit: 'pedidos/entrada.ts',
                level: 'error',
                status: 'unresolved',
                count: '500',
                userCount: 40,
                firstSeen: new Date(AGORA.getTime() - 3_600_000).toISOString(),
                lastSeen: new Date(AGORA.getTime() - 60_000).toISOString(),
                permalink: `${base}/issues/777001`,
              },
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        : new Response('{"detail":"Not found"}', { status: 404 })
    const resumo = await buscarErrosDoGlitchTip(AGORA, {
      env: {
        GLITCHTIP_URL: base,
        GLITCHTIP_ORG: 'minha-org',
        GLITCHTIP_TOKEN: 'tok',
        GLITCHTIP_PROJETOS: `app:${repo.nomeCompleto}`,
        GLITCHTIP_DEMANDAS_POR_DIA: '1',
      },
      buscar,
    })
    // B conta de novo: o teto de 1 por dia já foi usado, então o erro novo não abre demanda.
    expect(resumo).toMatchObject({ abertas: 0 })
    expect(await db.demanda.count({ where: { origem: 'GLITCHTIP', encerrada: null } })).toBe(1)
  })
})
