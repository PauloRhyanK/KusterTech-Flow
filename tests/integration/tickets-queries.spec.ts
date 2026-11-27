import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { MODELO_PADRAO } from '@/modules/demandas/model'
import { obterPaginaDaDemanda } from '@/modules/demandas/queries'
import { idDoAnexo } from '@/modules/relatos/model'
import { obterTelaDeTickets, obterTicket } from '@/modules/tickets/queries'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-27T15:00:00.000Z')
const DIA = 86_400_000
const antes = (dias: number, horas = 0) =>
  new Date(AGORA.getTime() - dias * DIA - horas * 3_600_000)

let admin: Sujeito
const semPermissao: Sujeito = {
  usuarioId: '00000000-0000-0000-0000-000000000000',
  papeis: [{ papel: 'APROVADOR', clienteId: null }],
}
let projetoId: string
let repositorioId: string
let sistemaA: string
let sistemaB: string

async function criarDemanda(titulo: string) {
  return db.demanda.create({
    data: {
      projetoId,
      repositorioId,
      titulo,
      nivel: 'APROVAR_DESENHO',
      temTela: false,
      origem: 'SESSAO',
      etapas: MODELO_PADRAO as never,
      etapaAtual: 'planejada',
      concluidas: ['recebida'],
      tipo: 'FUNCAO_NOVA',
      destino: 'FILA_DE_AGENTES',
      criadaEm: antes(2),
    } as never,
  })
}

type Extra = Partial<Parameters<typeof db.relato.create>[0]['data']>
async function relato(idExterno: string, sistemaId: string, extra: Extra = {}) {
  return db.relato.create({
    data: {
      sistemaId,
      idExterno,
      resultado: 'SEGUE',
      canal: 'SISTEMA',
      em: antes(1),
      autorIdExterno: 'u1',
      autorNome: 'Ana',
      autorPapel: 'cliente',
      texto: 'O botão não funciona',
      ...extra,
    } as never,
  })
}

const ids = (t: { grupos: { tickets: { id: string }[] }[] }) =>
  t.grupos.flatMap((g) => g.tickets.map((x) => x.id))

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-tickets@local.test',
    nome: 'Admin Tickets',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto-alfa' },
  })
  projetoId = projeto.id
  const repo = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(8301),
      instalacaoId: BigInt(900003),
      nomeCompleto: 'kustertech-exemplo/alfa',
      urlHtml: 'https://github.com/kustertech-exemplo/alfa',
      privado: false,
      projetoId,
      vinculadoEm: AGORA,
      catalogadoEm: AGORA,
    },
  })
  repositorioId = repo.id
  const base = { projetoId, repositorioId, url: 'https://app.exemplo.com/v1' }
  sistemaA = (await db.sistemaConectado.create({ data: { ...base, nome: 'App Alfa' } })).id
  sistemaB = (
    await db.sistemaConectado.create({
      data: { ...base, nome: 'App Beta', estado: 'DESCONECTADO' },
    })
  ).id
})

afterAll(async () => {
  await db.$disconnect()
})

test('sem permissão lança ErroDeAutorizacao', async () => {
  await expect(obterTelaDeTickets(semPermissao, {}, AGORA)).rejects.toBeInstanceOf(
    ErroDeAutorizacao,
  )
  await expect(obterTicket(semPermissao, randomUUID(), AGORA)).rejects.toBeInstanceOf(
    ErroDeAutorizacao,
  )
})

async function semear() {
  const d = await criarDemanda('Corrigir botão')
  const a = await relato('r-a', sistemaA, { demandaId: d.id, em: antes(0, 2) })
  const b = await relato('r-b', sistemaA, { em: antes(1), autorIdExterno: 'u2', autorNome: 'Bia' })
  const c = await relato('r-c', sistemaB, {
    resultado: 'ORIENTADO',
    texto: null,
    assunto: 'Pedidos',
    em: antes(2),
  })
  const w = await relato('r-w', sistemaB, {
    canal: 'WHATSAPP',
    texto: null,
    transcricao: 'Mensagem de VOZ sobre o Relatório',
    em: antes(3),
  })
  const velho = await relato('r-velho', sistemaA, { em: antes(40) })
  return { d, a, b, c, w, velho }
}

test('padrão: 7 dias, agrupado por dia, o de 40 dias fica fora, quadros corretos', async () => {
  const s = await semear()
  const t = await obterTelaDeTickets(admin, {}, AGORA)
  expect(t.filtros.periodo).toBe('7')
  expect(ids(t).sort()).toEqual([s.a.id, s.b.id, s.c.id, s.w.id].sort())
  expect(ids(t)[0]).toBe(s.a.id)
  expect(t.grupos.length).toBeGreaterThan(1)
  expect(t.quadros).toEqual({ chegaram: 4, viraramDemanda: 1, orientados: 1, semDemanda: 2 })
  expect(t.total).toBe(4)
  expect(t.truncado).toBe(false)
  expect(t.semSistemas).toBe(false)
  expect(t.sistemasDesconectados).toEqual(['App Beta'])
  expect(t.opcoes.apps.map((x) => x.nome)).toEqual(['App Alfa', 'App Beta'])
  expect(t.opcoes.autores.map((x) => x.nome)).toEqual(['Ana', 'Bia'])
  expect(t.escolhido).toBeNull()
  const doApp = t.grupos.flatMap((g) => g.tickets).find((x) => x.id === s.a.id)
  expect(doApp?.demanda).toMatchObject({ id: s.d.id, titulo: 'Corrigir botão' })
  expect(doApp?.resultado).toBe('virou_demanda')
})

test('periodo=tudo traz o de 40 dias; app, canal, autor, resultado e demanda filtram', async () => {
  const s = await semear()
  const tudo = await obterTelaDeTickets(admin, { periodo: 'tudo' }, AGORA)
  expect(ids(tudo)).toContain(s.velho.id)
  expect(tudo.quadros.chegaram).toBe(5)

  const porApp = await obterTelaDeTickets(admin, { app: sistemaB }, AGORA)
  expect(ids(porApp).sort()).toEqual([s.c.id, s.w.id].sort())
  const porCanal = await obterTelaDeTickets(admin, { canal: 'whatsapp' }, AGORA)
  expect(ids(porCanal)).toEqual([s.w.id])
  const porAutor = await obterTelaDeTickets(admin, { autor: 'u2' }, AGORA)
  expect(ids(porAutor)).toEqual([s.b.id])
  const semDemanda = await obterTelaDeTickets(admin, { resultado: 'sem_demanda' }, AGORA)
  expect(ids(semDemanda).sort()).toEqual([s.b.id, s.w.id].sort())
  const orientado = await obterTelaDeTickets(admin, { resultado: 'orientado' }, AGORA)
  expect(ids(orientado)).toEqual([s.c.id])
  const virou = await obterTelaDeTickets(admin, { resultado: 'virou_demanda' }, AGORA)
  expect(ids(virou)).toEqual([s.a.id])
  const porDemanda = await obterTelaDeTickets(admin, { demanda: s.d.id }, AGORA)
  expect(ids(porDemanda)).toEqual([s.a.id])
})

test('q acha por texto, transcrição e tela, sem diferenciar maiúscula', async () => {
  const s = await semear()
  expect(ids(await obterTelaDeTickets(admin, { q: 'BOTÃO' }, AGORA)).sort()).toEqual(
    [s.a.id, s.b.id].sort(),
  )
  expect(ids(await obterTelaDeTickets(admin, { q: 'voz sobre' }, AGORA))).toEqual([s.w.id])
  expect(ids(await obterTelaDeTickets(admin, { q: 'pedidos' }, AGORA))).toEqual([s.c.id])
})

test('quadros contam só o período e ignoram os outros filtros', async () => {
  await semear()
  const t = await obterTelaDeTickets(admin, { canal: 'whatsapp', q: 'voz' }, AGORA)
  expect(t.total).toBe(1)
  expect(t.quadros).toEqual({ chegaram: 4, viraramDemanda: 1, orientados: 1, semDemanda: 2 })
})

test('t válido preenche escolhido com mídias, demanda e histórico; inválido ou inexistente → null', async () => {
  const d = await criarDemanda('Corrigir botão')
  await db.eventoDaDemanda.create({
    data: {
      demandaId: d.id,
      idExterno: randomUUID(),
      tipo: 'encerrada',
      origem: 'sistema',
      dados: {},
      em: antes(0, 1),
    },
  })
  const r = await relato('r-det', sistemaA, {
    demandaId: d.id,
    ticket: 'T-9',
    assunto: 'Checkout',
    versao: '1.2.3',
    anexos: [
      { tipo: 'imagem', bytes: 10, caminho: '/x.png' },
      { tipo: 'audio', bytes: 20, caminho: null },
    ],
    sinais: [
      {
        tipo: 'reforco',
        autor: { id: 'u9', nome: 'Caio', papel: 'cliente' },
        texto: 'Eu também',
        em: antes(0, 5).toISOString(),
      },
    ],
  } as Extra)
  await relato('r-irmao', sistemaA, { demandaId: d.id })
  await db.envioDeAndamento.create({
    data: {
      relatoId: r.id,
      estado: 'recebida',
      mensagem: 'Recebemos',
      origem: 'automatico',
      situacao: 'ENVIADO',
      enviadoEm: antes(0, 4),
    },
  })
  const arquivoId = idDoAnexo(`${sistemaA}:r-det`, 0)
  await db.arquivoDaDemanda.create({
    data: {
      id: arquivoId,
      demandaId: d.id,
      tipo: 'ANEXO',
      nome: 'imagem-1',
      conteudo: 'image/png',
      tamanho: 10,
      enviadoPor: 'sistema',
    } as never,
  })

  const t = await obterTelaDeTickets(admin, { t: r.id }, AGORA)
  const e = t.escolhido
  expect(e).not.toBeNull()
  expect(e?.id).toBe(r.id)
  expect(e).toMatchObject({
    ticket: 'T-9',
    tela: 'Checkout',
    versao: '1.2.3',
    idExterno: 'r-det',
    projeto: { nome: 'Projeto Alfa', clientes: [] },
  })
  expect(e?.midias.map((m) => m.situacao)).toEqual(['disponivel', 'indisponivel'])
  expect(e?.midias[0]?.url).toBe(`/demandas/${d.id}/arquivos/${arquivoId}`)
  expect(e?.demanda).toMatchObject({
    id: d.id,
    repositorio: 'kustertech-exemplo/alfa',
    outrosTickets: 1,
  })
  expect(e?.demanda?.trilho).toHaveLength(4)
  expect(typeof e?.demanda?.frase).toBe('string')
  const textos = e?.historico.map((h) => h.texto) ?? []
  expect(textos).toContain('Relatado no app')
  expect(textos).toContain('Aviso ao usuário: recebida')
  expect(textos).toContain('Reforço de Caio')

  const inexistente = await obterTelaDeTickets(admin, { t: randomUUID() }, AGORA)
  expect(inexistente.escolhido).toBeNull()
  const invalido = await obterTelaDeTickets(admin, { t: 'não-é-uuid' }, AGORA)
  expect(invalido.escolhido).toBeNull()
  expect(await obterTicket(admin, randomUUID(), AGORA)).toBeNull()
  expect(await obterTicket(admin, 'nao-uuid', AGORA)).toBeNull()
})

test('relato cuja demanda foi apagada vira sem_demanda e as mídias ficam indisponíveis', async () => {
  const d = await criarDemanda('Será apagada')
  const r = await relato('r-orfao', sistemaA, {
    demandaId: d.id,
    anexos: [{ tipo: 'imagem', bytes: 10, caminho: '/x.png' }],
  } as Extra)
  await db.demanda.delete({ where: { id: d.id } })
  const e = await obterTicket(admin, r.id, AGORA)
  expect(e?.resultado).toBe('sem_demanda')
  expect(e?.demanda).toBeNull()
  expect(e?.midias.map((m) => m.situacao)).toEqual(['indisponivel'])
})

test('sem nenhum sistema conectado: semSistemas', async () => {
  await db.sistemaConectado.deleteMany()
  const t = await obterTelaDeTickets(admin, {}, AGORA)
  expect(t.semSistemas).toBe(true)
  expect(t.grupos).toEqual([])
})

test('a lista trunca em 300 e avisa', async () => {
  await db.relato.createMany({
    data: Array.from({ length: 301 }, (_, i) => ({
      sistemaId: sistemaA,
      idExterno: `lote-${i}`,
      resultado: 'SEGUE' as const,
      canal: 'SISTEMA' as const,
      em: antes(0, 1),
      autorIdExterno: 'u1',
      autorNome: 'Ana',
      autorPapel: 'cliente',
    })),
  })
  const t = await obterTelaDeTickets(admin, {}, AGORA)
  expect(t.truncado).toBe(true)
  expect(t.total).toBe(300)
  expect(t.quadros.chegaram).toBe(301)
})

test('obterPaginaDaDemanda traz ticketsDeOrigem', async () => {
  const d = await criarDemanda('Com dois')
  await relato('o1', sistemaA, { demandaId: d.id })
  await relato('o2', sistemaA, { demandaId: d.id })
  const pagina = await obterPaginaDaDemanda(admin, d.id, AGORA)
  expect(pagina?.ticketsDeOrigem).toBe(2)
})
