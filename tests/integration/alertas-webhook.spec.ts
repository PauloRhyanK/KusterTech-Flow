import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { hashDoTokenDeAlertas } from '@/modules/infra/model'
import { criarFonteDeAlertas, revogarFonteDeAlertas } from '@/modules/infra/service'
import { receberAlertaDoWebhook } from '@/modules/infra/webhook'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-10-27T12:00:00Z')

let admin: Sujeito
let fonteId: string
let token: string

beforeEach(async () => {
  vi.restoreAllMocks()
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-webhook@local.test',
    nome: 'Admin Webhook',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  const fonte = await criarFonteDeAlertas(admin, 'Fonte de teste')
  fonteId = fonte.id
  token = fonte.token
})

afterAll(async () => {
  await db.$disconnect()
})

function enviar(
  corpo: unknown,
  opcoes: {
    authorization?: string | null
    contentType?: string | null
    contentLength?: string | null
    texto?: string
    agora?: Date
  } = {},
) {
  const texto = opcoes.texto ?? JSON.stringify(corpo)
  return receberAlertaDoWebhook(
    {
      authorization: opcoes.authorization === undefined ? `Bearer ${token}` : opcoes.authorization,
      contentType: opcoes.contentType === undefined ? 'application/json' : opcoes.contentType,
      contentLength:
        opcoes.contentLength === undefined ? String(texto.length) : opcoes.contentLength,
      corpo: async () => texto,
    },
    opcoes.agora ?? AGORA,
  )
}

const base = { chave: 'disco-cheio', titulo: 'Disco cheio', severidade: 'alta' }

async function contarLinhas(): Promise<{ alertas: number; eventos: number }> {
  return { alertas: await db.alerta.count(), eventos: await db.eventoDeAlerta.count() }
}

describe('POST /api/alertas — receberAlertaDoWebhook', () => {
  test('sem Authorization, Bearer desconhecido e fonte revogada → 401 "Token inválido."; contarAlertas 0; ultimoUsoEm nulo', async () => {
    await revogarFonteDeAlertas(admin, fonteId)
    const revogada = await enviar(base)
    const sem = await enviar(base, { authorization: null })
    const desconhecido = await enviar(base, { authorization: 'Bearer fa_desconhecido' })
    const semEsquema = await enviar(base, { authorization: token })

    for (const r of [revogada, sem, desconhecido, semEsquema]) {
      expect(r.status).toBe(401)
      expect(r.corpo).toEqual({ erro: 'Token inválido.' })
    }
    expect(await contarLinhas()).toEqual({ alertas: 0, eventos: 0 })
    const fonte = await db.fonteDeAlertas.findUniqueOrThrow({ where: { id: fonteId } })
    expect(fonte.ultimoUsoEm).toBeNull()
  })

  test('válido → 201 criado, ATIVO, ocorrencias 1, 1 evento CRIADO sem autor; mesmo corpo de novo → 200 repetido, 1 alerta, ocorrencias 2, primeiraOcorrenciaEm igual, ultimoUsoEm = agora', async () => {
    const primeira = await enviar(base)
    expect(primeira.status).toBe(201)
    expect(primeira.corpo).toMatchObject({ resultado: 'criado' })
    const alertaId = (primeira.corpo as { alertaId: string }).alertaId

    const criado = await db.alerta.findUniqueOrThrow({
      where: { id: alertaId },
      include: { eventos: true },
    })
    expect(criado).toMatchObject({
      estado: 'ATIVO',
      ocorrencias: 1,
      origem: 'WEBHOOK',
      fonteId,
      severidade: 'ALTA',
    })
    expect(criado.eventos).toHaveLength(1)
    expect(criado.eventos[0]).toMatchObject({ tipo: 'CRIADO', autorId: null })

    const depois = new Date(AGORA.getTime() + 60_000)
    const segunda = await enviar(base, { agora: depois })
    expect(segunda.status).toBe(200)
    expect(segunda.corpo).toMatchObject({ resultado: 'repetido', alertaId })

    expect(await db.alerta.count()).toBe(1)
    const repetido = await db.alerta.findUniqueOrThrow({ where: { id: alertaId } })
    expect(repetido.ocorrencias).toBe(2)
    expect(repetido.primeiraOcorrenciaEm).toEqual(criado.primeiraOcorrenciaEm)
    expect(await db.eventoDeAlerta.count()).toBe(1)
    const fonte = await db.fonteDeAlertas.findUniqueOrThrow({ where: { id: fonteId } })
    expect(fonte.ultimoUsoEm).toEqual(depois)
  })

  test('mesma chave em duas fontes → 2 alertas com chaveDedupe "<fonteId>:<chave>"', async () => {
    const outra = await criarFonteDeAlertas(admin, 'Outra fonte')
    await enviar(base)
    await enviar(base, { authorization: `Bearer ${outra.token}` })

    const alertas = await db.alerta.findMany({ select: { chaveDedupe: true } })
    expect(alertas.map((a) => a.chaveDedupe).sort()).toEqual(
      [`${fonteId}:disco-cheio`, `${outra.id}:disco-cheio`].sort(),
    )
  })

  test('resolvido → 200 resolvido e evento RESOLVIDO; ocorrência posterior → reaberto, ATIVO, reconhecidoPorId nulo, evento REABERTO; resolvido com ocorridoEm anterior à última ocorrência → sem-mudanca; resolvido de chave desconhecida → 202 ignorado e nenhuma linha', async () => {
    const t = (min: number) => new Date(AGORA.getTime() + min * 60_000).toISOString()
    const criado = await enviar({ ...base, ocorridoEm: t(0) })
    const alertaId = (criado.corpo as { alertaId: string }).alertaId

    const resolvidoAntes = await enviar({ ...base, situacao: 'resolvido', ocorridoEm: t(-5) })
    expect(resolvidoAntes.status).toBe(200)
    expect(resolvidoAntes.corpo).toMatchObject({ resultado: 'sem-mudanca' })

    const resolvido = await enviar({ ...base, situacao: 'resolvido', ocorridoEm: t(2) })
    expect(resolvido.status).toBe(200)
    expect(resolvido.corpo).toMatchObject({ resultado: 'resolvido', alertaId })
    const r = await db.alerta.findUniqueOrThrow({ where: { id: alertaId } })
    expect(r.estado).toBe('RESOLVIDO_NA_ORIGEM')
    expect(r.resolvidoEm).toEqual(new Date(t(2)))

    // Ocorrência anterior ao resolvido não reabre.
    const antiga = await enviar({ ...base, ocorridoEm: t(1) })
    expect(antiga.corpo).toMatchObject({ resultado: 'sem-mudanca' })

    await db.alerta.update({
      where: { id: alertaId },
      data: { reconhecidoPorId: admin.usuarioId, reconhecidoEm: AGORA },
    })
    const reaberto = await enviar({ ...base, ocorridoEm: t(3) })
    expect(reaberto.status).toBe(200)
    expect(reaberto.corpo).toMatchObject({ resultado: 'reaberto', alertaId })
    const a = await db.alerta.findUniqueOrThrow({
      where: { id: alertaId },
      include: { eventos: { orderBy: { criadoEm: 'asc' } } },
    })
    expect(a).toMatchObject({
      estado: 'ATIVO',
      reconhecidoPorId: null,
      reconhecidoEm: null,
      resolvidoEm: null,
    })
    expect(a.eventos.map((e) => e.tipo)).toEqual(['CRIADO', 'RESOLVIDO', 'REABERTO'])

    const antes = await contarLinhas()
    const ignorado = await enviar({ ...base, chave: 'desconhecida', situacao: 'resolvido' })
    expect(ignorado.status).toBe(202)
    expect(ignorado.corpo).toEqual({ resultado: 'ignorado' })
    expect(await contarLinhas()).toEqual(antes)
  })

  test('RECONHECIDO + ocorrência continua RECONHECIDO com ocorrencias + 1', async () => {
    const criado = await enviar(base)
    const alertaId = (criado.corpo as { alertaId: string }).alertaId
    await db.alerta.update({
      where: { id: alertaId },
      data: { estado: 'RECONHECIDO', reconhecidoPorId: admin.usuarioId, reconhecidoEm: AGORA },
    })
    const r = await enviar(base)
    expect(r.corpo).toMatchObject({ resultado: 'repetido' })
    const a = await db.alerta.findUniqueOrThrow({ where: { id: alertaId } })
    expect(a).toMatchObject({ estado: 'RECONHECIDO', ocorrencias: 2 })
  })

  test('recurso por identificadorExterno e por nome normalizado ("VPS Produção" casa "vps producao"); recurso desconhecido grava sem recurso e devolve o aviso', async () => {
    const porNome = await db.recurso.create({
      data: { tipo: 'SERVIDOR', nome: 'VPS Produção', nomeNormalizado: 'vps producao' },
    })
    const porId = await db.recurso.create({
      data: {
        tipo: 'CONTAINER',
        nome: 'API',
        nomeNormalizado: 'api',
        identificadorExterno: 'abc123',
      },
    })

    const a = await enviar({ ...base, chave: 'a', recurso: 'VPS Produção' })
    const b = await enviar({ ...base, chave: 'b', recurso: 'abc123' })
    const c = await enviar({ ...base, chave: 'c', recurso: 'não existe' })

    const id = (r: { corpo: unknown }) => (r.corpo as { alertaId: string }).alertaId
    expect((await db.alerta.findUniqueOrThrow({ where: { id: id(a) } })).recursoId).toBe(porNome.id)
    expect((await db.alerta.findUniqueOrThrow({ where: { id: id(b) } })).recursoId).toBe(porId.id)
    expect((await db.alerta.findUniqueOrThrow({ where: { id: id(c) } })).recursoId).toBeNull()
    expect(c.corpo).toMatchObject({
      aviso: 'Recurso não encontrado no inventário; o alerta foi registrado sem recurso.',
    })
    expect(a.corpo).not.toHaveProperty('aviso')
  })

  test('severidade "urgente" → 400 campos ["severidade"]; JSON malformado → 400; text/plain → 415; 20 000 bytes → 413; nada gravado em nenhum caso', async () => {
    const severidade = await enviar({ ...base, severidade: 'urgente' })
    expect(severidade.status).toBe(400)
    expect(severidade.corpo).toEqual({ erro: 'Corpo inválido.', campos: ['severidade'] })

    const malformado = await enviar(null, { texto: '{nao e json' })
    expect(malformado.status).toBe(400)
    expect(malformado.corpo).toEqual({ erro: 'Corpo inválido.', campos: [] })

    const tipo = await enviar(base, { contentType: 'text/plain' })
    expect(tipo.status).toBe(415)
    expect(tipo.corpo).toEqual({ erro: 'Envie o corpo como application/json.' })

    const grande = await enviar(null, { texto: 'x'.repeat(20_000), contentLength: null })
    expect(grande.status).toBe(413)
    expect(grande.corpo).toEqual({ erro: 'Corpo maior que 16 KB.' })
    const declarado = await enviar(base, { contentLength: '20000' })
    expect(declarado.status).toBe(413)

    expect(await contarLinhas()).toEqual({ alertas: 0, eventos: 0 })
  })

  test('campos extras token, senha e html descartados; título de 300 gravado com 200; detalhe de 3000 com 2000; nenhuma chamada de log nem coluna contém o token', async () => {
    const info = vi.spyOn(log, 'info')
    const warn = vi.spyOn(log, 'warn')
    const erro = vi.spyOn(log, 'error')

    const r = await enviar({
      ...base,
      titulo: 'T'.repeat(300),
      detalhe: 'D'.repeat(3000),
      token: 'segredo-no-corpo',
      senha: 'segredo-no-corpo',
      html: '<script>alert(1)</script>',
    })
    expect(r.status).toBe(201)
    const a = await db.alerta.findUniqueOrThrow({
      where: { id: (r.corpo as { alertaId: string }).alertaId },
    })
    expect(a.titulo).toHaveLength(200)
    expect(a.detalhe).toHaveLength(2000)
    const serializado = JSON.stringify(a)
    expect(serializado).not.toContain(token)
    expect(serializado).not.toContain('segredo-no-corpo')
    expect(serializado).not.toContain('<script>')

    const fonte = await db.fonteDeAlertas.findUniqueOrThrow({ where: { id: fonteId } })
    expect(JSON.stringify({ ...fonte, tokenHash: undefined })).not.toContain(token)
    expect(fonte.tokenHash).toBe(hashDoTokenDeAlertas(token))

    for (const espiao of [info, warn, erro]) {
      expect(JSON.stringify(espiao.mock.calls)).not.toContain(token)
    }
  })

  test('duas chamadas concorrentes com chave nova (Promise.all) → 1 alerta com ocorrencias 2', async () => {
    const [x, y] = await Promise.all([enviar(base), enviar(base)])
    expect([x.status, y.status].sort()).toEqual([200, 201])
    expect(await db.alerta.count()).toBe(1)
    expect((await db.alerta.findFirstOrThrow()).ocorrencias).toBe(2)
    expect(await db.eventoDeAlerta.count()).toBe(1)
  })
})
