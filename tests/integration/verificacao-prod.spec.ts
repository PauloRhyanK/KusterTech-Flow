import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { POST } from '@/app/api/evidencias/verificacao/route'
import { gerarTokenDeEvidencia } from '@/modules/ambientes/service'
import { registrarVerificacaoProd } from '@/modules/publicacao/service'
import { limparBanco } from './banco-de-teste'

const NOME = 'kustertech-exemplo/portal'
const COMMIT = '1' + 'a'.repeat(39)
const SEM_DEPLOY = '2' + 'b'.repeat(39)
const OBSERVACAO = 'Fluxo de login conferido em produção.'

interface Montagem {
  projetoId: string
  versaoId: string
  versaoSemDeployId: string
  adminId: string
  admin: Sujeito
  tokenProd: string
  tokenQa: string
}

async function montar(comEvidencia: boolean): Promise<Montagem> {
  const usuario = await db.usuario.create({
    data: { nome: 'Admin', email: `admin-${randomUUID()}@exemplo.test`, senhaHash: 'x' },
  })
  const admin: Sujeito = {
    usuarioId: usuario.id,
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  }
  const projeto = await db.projeto.create({ data: { nome: 'Verificação', nomeNormalizado: 'v' } })
  const repositorio = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(1),
      instalacaoId: BigInt(1),
      nomeCompleto: NOME,
      urlHtml: `https://github.com/${NOME}`,
      privado: false,
      catalogadoEm: new Date(),
      projetoId: projeto.id,
    },
  })
  const qa = await db.ambiente.create({ data: { projetoId: projeto.id, tipo: 'QA' } })
  const prod = await db.ambiente.create({ data: { projetoId: projeto.id, tipo: 'PROD' } })
  const versao = await db.versao.create({
    data: { projetoId: projeto.id, repositorioId: repositorio.id, commitSha: COMMIT, rotulo: 'v1' },
  })
  const semDeploy = await db.versao.create({
    data: {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      commitSha: SEM_DEPLOY,
      rotulo: 'v2',
    },
  })
  if (comEvidencia) {
    await db.evidenciaDeploy.create({
      data: {
        ambienteId: prod.id,
        versaoId: versao.id,
        origem: 'ENDPOINT',
        situacao: 'SUCESSO',
        ocorridaEm: new Date(),
      },
    })
  }
  // Evidência em QA da versão sem deploy em PROD: não conta como PROD.
  await db.evidenciaDeploy.create({
    data: {
      ambienteId: qa.id,
      versaoId: semDeploy.id,
      origem: 'ENDPOINT',
      situacao: 'SUCESSO',
      ocorridaEm: new Date(),
    },
  })
  return {
    projetoId: projeto.id,
    versaoId: versao.id,
    versaoSemDeployId: semDeploy.id,
    adminId: usuario.id,
    admin,
    tokenProd: await gerarTokenDeEvidencia(admin, projeto.id, 'PROD'),
    tokenQa: await gerarTokenDeEvidencia(admin, projeto.id, 'QA'),
  }
}

function requisicao(corpo: unknown, token: string | null) {
  return new Request('http://localhost/api/evidencias/verificacao', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  })
}

beforeEach(async () => {
  await limparBanco()
})

describe('registrarVerificacaoProd', () => {
  test('sem evidência PROD → "Registre primeiro a evidência de deploy desta versão em PROD."; com evidência grava MANUAL com autor', async () => {
    const m = await montar(false)
    const entrada = { projetoId: m.projetoId, versaoId: m.versaoId, observacao: OBSERVACAO }

    await expect(registrarVerificacaoProd(m.admin, entrada)).rejects.toThrow(
      new ErroDeDominio('Registre primeiro a evidência de deploy desta versão em PROD.'),
    )
    expect(await db.verificacaoProd.count()).toBe(0)

    await db.evidenciaDeploy.create({
      data: {
        ambienteId: (await db.ambiente.findFirstOrThrow({ where: { tipo: 'PROD' } })).id,
        versaoId: m.versaoId,
        origem: 'MANUAL',
        situacao: 'SUCESSO',
        ocorridaEm: new Date(),
        autorId: m.adminId,
      },
    })
    await registrarVerificacaoProd(m.admin, entrada)

    expect(await db.verificacaoProd.findMany()).toMatchObject([
      { versaoId: m.versaoId, origem: 'MANUAL', autorId: m.adminId, observacao: OBSERVACAO },
    ])
  })

  test('observação fora de 10–500 caracteres é recusada; várias verificações por versão são permitidas', async () => {
    const m = await montar(true)
    const base = { projetoId: m.projetoId, versaoId: m.versaoId }
    const mensagem = 'Descreva o que foi verificado (de 10 a 500 caracteres).'

    for (const observacao of ['curta', '   curta   ', 'x'.repeat(501)]) {
      await expect(registrarVerificacaoProd(m.admin, { ...base, observacao })).rejects.toThrow(
        new ErroDeDominio(mensagem),
      )
    }
    await registrarVerificacaoProd(m.admin, { ...base, observacao: OBSERVACAO })
    await registrarVerificacaoProd(m.admin, { ...base, observacao: 'x'.repeat(500) })
    expect(await db.verificacaoProd.count()).toBe(2)
  })

  test('versão de outro projeto → "Versão não encontrada."; versão só com deploy em QA → pede a evidência em PROD', async () => {
    const m = await montar(true)

    await expect(
      registrarVerificacaoProd(m.admin, {
        projetoId: randomUUID(),
        versaoId: m.versaoId,
        observacao: OBSERVACAO,
      }),
    ).rejects.toThrow(new ErroDeDominio('Versão não encontrada.'))
    await expect(
      registrarVerificacaoProd(m.admin, {
        projetoId: m.projetoId,
        versaoId: m.versaoSemDeployId,
        observacao: OBSERVACAO,
      }),
    ).rejects.toThrow(
      new ErroDeDominio('Registre primeiro a evidência de deploy desta versão em PROD.'),
    )
    expect(await db.verificacaoProd.count()).toBe(0)
  })

  test('TESTADOR escopado e APROVADOR global pelo service → ErroDeAutorizacao e nenhuma linha', async () => {
    const m = await montar(true)
    const entrada = { projetoId: m.projetoId, versaoId: m.versaoId, observacao: OBSERVACAO }
    const testador: Sujeito = {
      usuarioId: m.adminId,
      papeis: [{ papel: 'TESTADOR', clienteId: randomUUID() }],
    }
    const aprovador: Sujeito = {
      usuarioId: m.adminId,
      papeis: [{ papel: 'APROVADOR', clienteId: null }],
    }

    for (const sujeito of [testador, aprovador]) {
      await expect(registrarVerificacaoProd(sujeito, entrada)).rejects.toBeInstanceOf(
        ErroDeAutorizacao,
      )
    }
    expect(await db.verificacaoProd.count()).toBe(0)
  })
})

describe('POST /api/evidencias/verificacao', () => {
  test('rota: token PROD válido → 201 e VerificacaoProd ENDPOINT; token QA → 403; token inválido → 401 com corpo { erro: "Token inválido." }; commit desconhecido → 404', async () => {
    const m = await montar(true)
    const valido = { repositorio: NOME, commit: COMMIT, observacao: OBSERVACAO }

    const criada = await POST(requisicao(valido, m.tokenProd))
    expect(criada.status).toBe(201)
    const verificacao = await db.verificacaoProd.findFirstOrThrow()
    expect(await criada.json()).toEqual({ id: verificacao.id })
    expect(verificacao).toMatchObject({
      versaoId: m.versaoId,
      origem: 'ENDPOINT',
      autorId: null,
      observacao: OBSERVACAO,
    })

    const emQa = await POST(requisicao(valido, m.tokenQa))
    expect(emQa.status).toBe(403)
    expect(await emQa.json()).toEqual({ erro: 'O token não é de um ambiente PROD.' })

    for (const token of [null, 'x', `fle_${'A'.repeat(43)}`]) {
      const invalido = await POST(requisicao(valido, token))
      expect(invalido.status).toBe(401)
      expect(await invalido.json()).toEqual({ erro: 'Token inválido.' })
    }

    const desconhecido = await POST(requisicao({ ...valido, commit: 'f'.repeat(40) }, m.tokenProd))
    expect(desconhecido.status).toBe(404)
    expect(await desconhecido.json()).toEqual({ erro: 'Versão não encontrada.' })
    const outroRepositorio = await POST(
      requisicao({ ...valido, repositorio: 'kustertech-exemplo/outro' }, m.tokenProd),
    )
    expect(outroRepositorio.status).toBe(404)
    expect(await db.verificacaoProd.count()).toBe(1)
  })

  test('corpo inválido → 400; versão sem evidência PROD → 409; observação é opcional', async () => {
    const m = await montar(true)

    for (const corpo of ['{', {}, { repositorio: NOME, commit: 'abc' }, { repositorio: NOME }]) {
      const resposta = await POST(requisicao(corpo, m.tokenProd))
      expect(resposta.status).toBe(400)
      expect(await resposta.json()).toEqual({ erro: 'Corpo inválido.' })
    }
    const longa = await POST(
      requisicao({ repositorio: NOME, commit: COMMIT, observacao: 'x'.repeat(501) }, m.tokenProd),
    )
    expect(longa.status).toBe(400)

    const semEvidencia = await POST(
      requisicao({ repositorio: NOME, commit: SEM_DEPLOY }, m.tokenProd),
    )
    expect(semEvidencia.status).toBe(409)
    expect(await semEvidencia.json()).toEqual({
      erro: 'Não há evidência de deploy desta versão em PROD.',
    })
    expect(await db.verificacaoProd.count()).toBe(0)

    const semObservacao = await POST(requisicao({ repositorio: NOME, commit: COMMIT }, m.tokenProd))
    expect(semObservacao.status).toBe(201)
    expect((await db.verificacaoProd.findFirstOrThrow()).observacao).toBeNull()
  })
})
