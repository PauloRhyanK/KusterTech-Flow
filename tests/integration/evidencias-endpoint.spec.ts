import { beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { POST } from '@/app/api/evidencias/deploy/route'
import { gerarTokenDeEvidencia, salvarAmbiente } from '@/modules/ambientes/service'
import { criarProjeto } from '@/modules/projetos/service'
import { limparBanco } from './banco-de-teste'

const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const V2 = `1${'e'.repeat(39)}`

async function prepararRepositorio(nome: string, githubId: number, projetoId: string | null) {
  return db.repositorioGitHub.create({
    data: {
      githubId: BigInt(githubId),
      instalacaoId: BigInt(1),
      nomeCompleto: nome,
      urlHtml: `https://github.com/${nome}`,
      privado: false,
      catalogadoEm: new Date(),
      projetoId,
    },
  })
}

async function cenario() {
  const { id: projetoId } = await criarProjeto(admin, { nome: 'Portal' })
  const portal = await prepararRepositorio('kustertech-exemplo/portal', 1, projetoId)
  await prepararRepositorio('kustertech-exemplo/api', 2, null)
  await salvarAmbiente(admin, projetoId, 'QA', { nomeNoGitHub: 'qa', url: '' })
  await salvarAmbiente(admin, projetoId, 'PROD', { nomeNoGitHub: 'production', url: '' })
  const tokenQa = await gerarTokenDeEvidencia(admin, projetoId, 'QA')
  const ambienteQa = await db.ambiente.findFirstOrThrow({ where: { projetoId, tipo: 'QA' } })
  return { projetoId, portal, tokenQa, ambienteQa }
}

function requisicao(corpo: unknown, token: string | null, extras: Record<string, string> = {}) {
  return new Request('http://localhost/api/evidencias/deploy', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...extras,
    },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  })
}

const valido = { repositorio: 'kustertech-exemplo/portal', commitSha: V2 }

beforeEach(async () => {
  await limparBanco()
  await db.usuario.create({
    data: { id: admin.usuarioId, email: 'admin@local.test', nome: 'Admin', senhaHash: 'x' },
  })
})

describe('POST /api/evidencias/deploy (integração)', () => {
  test('endpoint: sem Authorization, "Bearer x", token desconhecido e token revogado → 401 "Token de evidência inválido." e 0 evidências', async () => {
    const { projetoId, tokenQa } = await cenario()
    const { revogarTokenDeEvidencia } = await import('@/modules/ambientes/service')
    await revogarTokenDeEvidencia(admin, projetoId, 'QA')
    const desconhecido = `fle_${'A'.repeat(43)}`

    for (const token of [null, 'x', desconhecido, tokenQa]) {
      const resposta = await POST(requisicao(valido, token))
      expect(resposta.status).toBe(401)
      expect(await resposta.json()).toEqual({ erro: 'Token de evidência inválido.' })
    }
    const semBearer = await POST(
      new Request('http://localhost/api/evidencias/deploy', {
        method: 'POST',
        headers: { authorization: tokenQa },
        body: JSON.stringify(valido),
      }),
    )
    expect(semBearer.status).toBe(401)
    expect(await db.evidenciaDeploy.count()).toBe(0)
  })

  test('endpoint: commitSha de 39 caracteres → 400 campos ["commitSha"]; chave extra → 400; JSON quebrado → 400; corpo de 20 KB → 413', async () => {
    const { tokenQa } = await cenario()

    const curto = await POST(requisicao({ ...valido, commitSha: 'a'.repeat(39) }, tokenQa))
    expect(curto.status).toBe(400)
    expect(await curto.json()).toEqual({ erro: 'Corpo inválido.', campos: ['commitSha'] })

    const extra = await POST(
      requisicao({ ...valido, segredo: 'valor-que-nao-deve-voltar' }, tokenQa),
    )
    expect(extra.status).toBe(400)
    expect(JSON.stringify(await extra.json())).not.toContain('valor-que-nao-deve-voltar')

    const quebrado = await POST(requisicao('{"repositorio":', tokenQa))
    expect(quebrado.status).toBe(400)
    expect(await quebrado.json()).toEqual({ erro: 'Corpo inválido.' })

    const grande = await POST(requisicao({ ...valido, origem: 'x'.repeat(20_000) }, tokenQa))
    expect(grande.status).toBe(413)
    expect(await grande.json()).toEqual({ erro: 'Corpo grande demais.' })

    const semTamanho = await POST(
      requisicao(JSON.stringify({ ...valido, origem: 'x'.repeat(20_000) }), tokenQa, {
        'content-length': '100',
      }),
    )
    expect([400, 413]).toContain(semTamanho.status)
    expect(await db.evidenciaDeploy.count()).toBe(0)
  })

  test('endpoint: repositório de outro projeto → 422 e 0 versões; ambiente "prod" com token de QA → 422; ocorridaEm daqui a 1 h → 422', async () => {
    const { tokenQa, projetoId } = await cenario()

    const outroProjeto = await POST(
      requisicao({ ...valido, repositorio: 'kustertech-exemplo/api' }, tokenQa),
    )
    expect(outroProjeto.status).toBe(422)
    expect(await outroProjeto.json()).toEqual({
      erro: 'Repositório não vinculado ao projeto deste ambiente.',
    })

    const outroAmbiente = await POST(requisicao({ ...valido, ambiente: 'prod' }, tokenQa))
    expect(outroAmbiente.status).toBe(422)
    expect(await outroAmbiente.json()).toEqual({
      erro: 'O token não pertence ao ambiente informado.',
    })

    const futuro = await POST(
      requisicao(
        { ...valido, ocorridaEm: new Date(Date.now() + 3_600_000).toISOString() },
        tokenQa,
      ),
    )
    expect(futuro.status).toBe(422)
    expect(await futuro.json()).toEqual({ erro: 'A data do deploy não pode estar no futuro.' })

    expect(await db.versao.count()).toBe(0)
    expect(await db.evidenciaDeploy.count()).toBe(0)

    await db.projeto.update({ where: { id: projetoId }, data: { arquivadoEm: new Date() } })
    const arquivado = await POST(requisicao(valido, tokenQa))
    expect(arquivado.status).toBe(422)
    expect(await arquivado.json()).toEqual({ erro: 'Projeto arquivado não recebe evidências.' })
  })

  test('endpoint válido em QA (portal, V2, versao "3.8.0", idExterno "build-42") → 201; Versao rótulo "3.8.0"; EvidenciaDeploy ENDPOINT SUCESSO com idExterno "<ambienteId>:build-42"; repetir → 200 duplicada true e 1 evidência', async () => {
    const { tokenQa, ambienteQa, portal } = await cenario()
    const corpo = { ...valido, versao: '3.8.0', idExterno: 'build-42', ambiente: 'qa' }

    const primeira = await POST(requisicao(corpo, tokenQa))
    expect(primeira.status).toBe(201)
    const { id, versaoId, duplicada } = await primeira.json()
    expect(duplicada).toBe(false)

    const versao = await db.versao.findUniqueOrThrow({ where: { id: versaoId } })
    expect(versao).toMatchObject({ rotulo: '3.8.0', commitSha: V2, repositorioId: portal.id })
    const evidencia = await db.evidenciaDeploy.findUniqueOrThrow({ where: { id } })
    expect(evidencia).toMatchObject({
      origem: 'ENDPOINT',
      situacao: 'SUCESSO',
      ambienteId: ambienteQa.id,
      idExterno: `${ambienteQa.id}:build-42`,
      autorId: null,
    })

    const segunda = await POST(requisicao(corpo, tokenQa))
    expect(segunda.status).toBe(200)
    expect(await segunda.json()).toEqual({ id, versaoId, duplicada: true })
    expect(await db.evidenciaDeploy.count()).toBe(1)
    expect(await db.versao.count()).toBe(1)
  })

  test('endpoint: situacao "falha" e commit em maiúsculas; sem idExterno cada chamada grava uma evidência', async () => {
    const { tokenQa } = await cenario()

    const falha = await POST(
      requisicao({ ...valido, commitSha: V2.toUpperCase(), situacao: 'falha' }, tokenQa),
    )
    expect(falha.status).toBe(201)
    const a = await POST(requisicao(valido, tokenQa))
    const b = await POST(requisicao(valido, tokenQa))
    expect([a.status, b.status]).toEqual([201, 201])

    expect(await db.versao.count()).toBe(1)
    const situacoes = (await db.evidenciaDeploy.findMany()).map((e) => e.situacao).sort()
    expect(situacoes).toEqual(['FALHA', 'SUCESSO', 'SUCESSO'])
  })
})
