import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import {
  consultarDemandaDaSessao,
  receberDemandaDaSessao,
  receberPlanoDaSessao,
} from '@/modules/demandas/recepcao-sessao'
import {
  abrirDemanda,
  criarFonteDeDemandas,
  listarFontesDeDemandas,
  registrarEvento,
  revogarFonteDeDemandas,
} from '@/modules/demandas/service'
import { criarFonteDaFabrica } from '@/modules/fabrica/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-19T15:00:00.000Z')
const MB = 1024 * 1024

let dir: string
const anterior = process.env.FLOW_ARQUIVOS_DIR
let admin: Sujeito
let fonteId: string
let token: string
let projetoId: string
let repositorioId: string

beforeEach(async () => {
  await limparBanco()
  dir = await mkdtemp(join(tmpdir(), 'flow-api-sessao-'))
  process.env.FLOW_ARQUIVOS_DIR = dir
  const usuario = await criarUsuario({
    email: 'admin-sessao-api@local.test',
    nome: 'Admin Sessão',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  const fonte = await criarFonteDeDemandas(admin, 'Sessão do Alfa')
  fonteId = fonte.id
  token = fonte.token
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto alfa' },
  })
  projetoId = projeto.id
  repositorioId = (
    await db.repositorioGitHub.create({
      data: {
        githubId: BigInt(9100),
        instalacaoId: BigInt(1),
        nomeCompleto: 'Kustertech-Exemplo/Portal',
        urlHtml: 'https://github.com/kustertech-exemplo/portal',
        privado: true,
        catalogadoEm: AGORA,
        projetoId,
      },
    })
  ).id
})

afterEach(async () => {
  if (anterior === undefined) delete process.env.FLOW_ARQUIVOS_DIR
  else process.env.FLOW_ARQUIVOS_DIR = anterior
  await rm(dir, { recursive: true, force: true })
})

afterAll(async () => {
  await db.$disconnect()
})

const auth = () => `Bearer ${token}`

function entrada(corpo: unknown, autorizacao: string | null = auth()) {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
  return {
    authorization: autorizacao,
    contentType: 'application/json',
    contentLength: String(Buffer.byteLength(texto)),
    corpo: async () => texto,
  }
}

const pedido = (extra: Record<string, unknown> = {}) => ({
  repositorio: 'kustertech-exemplo/portal',
  titulo: 'Corrigir o botão',
  temTela: true,
  ...extra,
})

const PNG_1KB = Buffer.alloc(1024, 1).toString('base64')

async function demandaDoPaulo(nivel: 'planejar_comigo' | 'aprovar_desenho' | 'vai_sozinho') {
  const { id } = await db.$transaction((tx) =>
    abrirDemanda(
      tx,
      {
        projetoId,
        repositorioId,
        titulo: 'Do Paulo',
        descricao: null,
        tipo: null,
        nivel,
        temTela: true,
        origem: 'flow',
        usuarioId: admin.usuarioId,
      },
      new Date(),
    ),
  )
  // A triagem da Fábrica leva a demanda à etapa "planejada".
  const triagem = await registrarEvento({
    demandaId: id,
    idExterno: randomUUID(),
    evento: {
      tipo: 'triagem',
      dados: {
        tipo: 'ajuste',
        destino: 'fila_de_agentes',
        tamanho: 'pequeno',
        mexeEm: 'tela de entrada',
        risco: 'baixo',
        dados: 'nenhum',
        impacto: { toca: [], podeQuebrar: [], autorizacao: false, caminhoProtegido: false },
        resposta: null,
        motivo: 'ajuste simples',
      },
      ator: 'fabrica',
    },
    origem: 'fabrica',
    em: new Date(),
  })
  expect(triagem.resultado).toBe('aplicado')
  return id
}

describe('fontes de demandas', () => {
  test('token tem prefixo fd_ e o banco guarda só o hash; ff_ → 401; revogado → 401', async () => {
    expect(token).toMatch(/^fd_[A-Za-z0-9_-]{43}$/)
    const linha = await db.fonteDeDemandas.findUniqueOrThrow({ where: { id: fonteId } })
    expect(linha.tokenHash).not.toContain(token)
    expect(JSON.stringify(linha)).not.toContain(token)
    expect((await receberDemandaDaSessao(entrada(pedido()), AGORA)).status).toBe(201)

    const ff = await criarFonteDaFabrica(admin, 'Fábrica')
    expect(
      (await receberDemandaDaSessao(entrada(pedido(), `Bearer ${ff.token}`), AGORA)).status,
    ).toBe(401)
    expect((await consultarDemandaDaSessao(`Bearer ${ff.token}`, randomUUID())).status).toBe(401)
    expect((await receberDemandaDaSessao(entrada(pedido(), null), AGORA)).status).toBe(401)

    await revogarFonteDeDemandas(admin, fonteId)
    expect((await receberDemandaDaSessao(entrada(pedido()), AGORA)).status).toBe(401)
    expect((await listarFontesDeDemandas(admin))[0]!.revogadaEm).not.toBeNull()
  })

  test('só quem gerencia configurações cria, revoga e lista', async () => {
    const leitor: Sujeito = {
      usuarioId: admin.usuarioId,
      papeis: [{ papel: 'APROVADOR', clienteId: null }],
    }
    await expect(criarFonteDeDemandas(leitor, 'x')).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await expect(revogarFonteDeDemandas(leitor, fonteId)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await expect(listarFontesDeDemandas(leitor)).rejects.toBeInstanceOf(ErroDeAutorizacao)
  })
})

describe('POST /api/demandas', () => {
  test('válido → 201, origem SESSAO com fonteId, nível padrão do projeto e evento criada origem sessao', async () => {
    const r = await receberDemandaDaSessao(entrada(pedido()), AGORA)
    expect(r.status).toBe(201)
    const corpo = r.corpo as { id: string; etapa: string; url: string }
    expect(corpo.etapa).toBe('recebida')
    expect(corpo.url).toBe(`/demandas/${corpo.id}`)
    const d = await db.demanda.findUniqueOrThrow({
      where: { id: corpo.id },
      include: { eventos: true },
    })
    expect(d.origem).toBe('SESSAO')
    expect(d.fonteId).toBe(fonteId)
    expect(d.nivel).toBe('APROVAR_DESENHO')
    expect(d.eventos).toHaveLength(1)
    expect(d.eventos[0]).toMatchObject({ tipo: 'criada', origem: 'sessao' })
  })

  test('Review Focus 5: mesma chave → 201 e 200 com o mesmo id; uma só demanda', async () => {
    const a = await receberDemandaDaSessao(entrada(pedido({ chave: 'k1' })), AGORA)
    const b = await receberDemandaDaSessao(entrada(pedido({ chave: 'k1' })), AGORA)
    expect([a.status, b.status]).toEqual([201, 200])
    expect((a.corpo as { id: string }).id).toBe((b.corpo as { id: string }).id)
    expect(await db.demanda.count()).toBe(1)
  })

  test('repositório casa sem diferenciar maiúsculas; sem projeto ou desconhecido → 404', async () => {
    expect(
      (
        await receberDemandaDaSessao(
          entrada(pedido({ repositorio: 'KUSTERTECH-EXEMPLO/PORTAL' })),
          AGORA,
        )
      ).status,
    ).toBe(201)
    await db.repositorioGitHub.create({
      data: {
        githubId: BigInt(9101),
        instalacaoId: BigInt(1),
        nomeCompleto: 'kustertech-exemplo/solto',
        urlHtml: 'https://github.com/kustertech-exemplo/solto',
        privado: true,
        catalogadoEm: AGORA,
      },
    })
    for (const repositorio of ['kustertech-exemplo/solto', 'kustertech-exemplo/nada']) {
      const r = await receberDemandaDaSessao(entrada(pedido({ repositorio })), AGORA)
      expect(r.status).toBe(404)
      expect(r.corpo).toEqual({ erro: 'Repositório não encontrado.' })
    }
  })

  test('corpo inválido → 422; JSON de outro tipo → 415; corpo grande demais → 413', async () => {
    expect((await receberDemandaDaSessao(entrada('{'), AGORA)).status).toBe(422)
    expect((await receberDemandaDaSessao(entrada(pedido({ extra: 1 })), AGORA)).status).toBe(422)
    const e = entrada(pedido())
    expect((await receberDemandaDaSessao({ ...e, contentType: 'text/plain' }, AGORA)).status).toBe(
      415,
    )
    const grande = await receberDemandaDaSessao({ ...e, contentLength: String(43 * MB) }, AGORA)
    expect(grande.status).toBe(413)
    expect(grande.corpo).toEqual({ erro: 'Corpo maior que 42 MB.' })
    const mentiu = await receberDemandaDaSessao(
      { ...e, contentLength: null, corpo: async () => 'x'.repeat(42 * MB + 1) },
      AGORA,
    )
    expect(mentiu.status).toBe(413)
  })

  test('um anexo png de 1 KB vira ArquivoDaDemanda ANEXO', async () => {
    const r = await receberDemandaDaSessao(
      entrada(pedido({ anexos: [{ nome: 'tela.png', conteudo: 'image/png', base64: PNG_1KB }] })),
      AGORA,
    )
    expect(r.status).toBe(201)
    const arquivos = await db.arquivoDaDemanda.findMany({
      where: { demandaId: (r.corpo as { id: string }).id },
    })
    expect(arquivos).toHaveLength(1)
    expect(arquivos[0]).toMatchObject({
      tipo: 'ANEXO',
      tamanho: 1024,
      nome: 'tela.png',
      enviadoPor: 'sessao',
    })
  })

  test('anexo de 10 MB + 1, base64 inválido ou tipo não aceito → 422 e nenhuma demanda', async () => {
    const grande = Buffer.alloc(10 * MB + 1, 1).toString('base64')
    const casos = [
      { nome: 'a.png', conteudo: 'image/png', base64: grande },
      { nome: 'a.png', conteudo: 'image/png', base64: '***não é base64***' },
      { nome: 'a.exe', conteudo: 'application/x-msdownload', base64: PNG_1KB },
    ]
    for (const anexo of casos) {
      const r = await receberDemandaDaSessao(
        entrada(
          pedido({ anexos: [{ nome: 'ok.png', conteudo: 'image/png', base64: PNG_1KB }, anexo] }),
        ),
        AGORA,
      )
      expect(r.status).toBe(422)
      expect(typeof (r.corpo as { erro: string }).erro).toBe('string')
    }
    expect(
      (await receberDemandaDaSessao(entrada(pedido({ anexos: [casos[0]] })), AGORA)).corpo,
    ).toEqual({ erro: 'Arquivo maior que 10 MB.' })
    expect(await db.demanda.count()).toBe(0)
    expect(await db.arquivoDaDemanda.count()).toBe(0)
  })
})

describe('GET /api/demandas/<id>', () => {
  test('demanda aberta pelo Paulo → 200 com espera e desenho null; inexistente → 404', async () => {
    const id = await demandaDoPaulo('planejar_comigo')
    const r = await consultarDemandaDaSessao(auth(), id)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({
      id,
      repositorio: 'Kustertech-Exemplo/Portal',
      titulo: 'Do Paulo',
      nivel: 'planejar_comigo',
      temTela: true,
      desenho: null,
      artefato: null,
      plano: null,
      publicacao: null,
      url: `/demandas/${id}`,
    })
    const corpo = r.corpo as {
      etapa: { chave: string; nome: string }
      espera: { tipo: string } | null
    }
    expect(corpo.etapa.chave).toBeTruthy()
    expect(corpo.espera).not.toBeNull()
    expect((await consultarDemandaDaSessao(auth(), randomUUID())).status).toBe(404)
    expect((await consultarDemandaDaSessao(auth(), 'nada')).status).toBe(404)
    expect((await consultarDemandaDaSessao(null, id)).status).toBe(401)
  })
})

describe('POST /api/demandas/<id>/plano', () => {
  const plano = (extra: Record<string, unknown> = {}) => ({
    plano: '.fabrica/planos/exemplo.json',
    ...extra,
  })

  test('planejar_comigo esperando → 201 e espera null; repetir o mesmo id → 200', async () => {
    const id = await demandaDoPaulo('planejar_comigo')
    const eid = randomUUID()
    const r = await receberPlanoDaSessao(
      auth(),
      id,
      entrada(plano({ id: eid, artefato: 'https://claude.ai/public/artifacts/x' })),
    )
    expect(r.status).toBe(201)
    expect(r.corpo).toEqual({ resultado: 'aplicado', espera: null })
    const d = await db.demanda.findUniqueOrThrow({ where: { id } })
    expect(d.planoCaminho).toBe('.fabrica/planos/exemplo.json')
    expect(d.artefatoUrl).toBe('https://claude.ai/public/artifacts/x')
    const ev = await db.eventoDaDemanda.findUniqueOrThrow({ where: { idExterno: eid } })
    expect(ev).toMatchObject({ origem: 'sessao', fonteId })
    const de_novo = await receberPlanoDaSessao(
      auth(),
      id,
      entrada(plano({ id: eid, artefato: 'https://claude.ai/public/artifacts/x' })),
    )
    expect(de_novo.status).toBe(200)
  })

  test('aprovar_desenho em planejada sem espera → 201 (qualquer conclui); já planejada → 409 com o motivo', async () => {
    const id = await demandaDoPaulo('aprovar_desenho')
    const r = await receberPlanoDaSessao(auth(), id, entrada(plano()))
    expect(r.status).toBe(201)
    const segunda = await receberPlanoDaSessao(auth(), id, entrada(plano()))
    expect(segunda.status).toBe(409)
    expect(typeof (segunda.corpo as { erro: string }).erro).toBe('string')
    // registrarEvento direto para garantir que o motivo vem da transição
    const direto = await registrarEvento({
      demandaId: id,
      idExterno: randomUUID(),
      evento: {
        tipo: 'plano_entregue',
        dados: { plano: '.fabrica/planos/exemplo.json', resumo: null, artefato: null },
        ator: 'sessao',
      },
      origem: 'sessao',
      em: new Date(),
    })
    expect(direto.resultado).toBe('recusado')
    expect((segunda.corpo as { erro: string }).erro).toBe((direto as { motivo: string }).motivo)
  })

  test('artefato fora de https://claude.ai → 422 "Corpo inválido."; demanda inexistente → 404; sem token → 401', async () => {
    const id = await demandaDoPaulo('planejar_comigo')
    const r = await receberPlanoDaSessao(
      auth(),
      id,
      entrada(plano({ artefato: 'https://exemplo.test/x' })),
    )
    expect(r.status).toBe(422)
    expect(r.corpo).toEqual({ erro: 'Corpo inválido.' })
    expect((await receberPlanoDaSessao(auth(), randomUUID(), entrada(plano()))).status).toBe(404)
    expect((await receberPlanoDaSessao(null, id, entrada(plano(), null))).status).toBe(401)
  })
})
