import { afterAll, beforeEach, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { MODELO_PADRAO } from '@/modules/demandas/model'
import { conferirNoArPeloPaulo } from '@/modules/demandas/partes-service'
import { obterListaDeDemandas, obterPaginaDaDemanda } from '@/modules/demandas/queries'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

// 12:00 em São Paulo.
const AGORA = new Date('2026-11-20T15:00:00.000Z')
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000)

let admin: Sujeito
const semPermissao: Sujeito = {
  usuarioId: '00000000-0000-0000-0000-000000000000',
  papeis: [{ papel: 'APROVADOR', clienteId: null }],
}
let projetoId: string
let repositorioId: string

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-tela-demandas@local.test',
    nome: 'Admin Demandas',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto-alfa' },
  })
  projetoId = projeto.id
  const repositorio = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(8101),
      instalacaoId: BigInt(900001),
      nomeCompleto: 'kustertech-exemplo/alfa',
      urlHtml: 'https://github.com/kustertech-exemplo/alfa',
      privado: false,
      projetoId,
      vinculadoEm: AGORA,
      catalogadoEm: AGORA,
    },
  })
  repositorioId = repositorio.id
})

afterAll(async () => {
  await db.$disconnect()
})

type Extra = Partial<Parameters<typeof db.demanda.create>[0]['data']>

async function demanda(titulo: string, extra: Extra = {}) {
  return db.demanda.create({
    data: {
      projetoId,
      repositorioId,
      titulo,
      nivel: 'APROVAR_DESENHO',
      temTela: true,
      origem: 'FLOW',
      etapas: MODELO_PADRAO as never,
      etapaAtual: 'recebida',
      criadaEm: minutos(-30),
      ...extra,
    } as never,
  })
}

test('obterListaDeDemandas sem desenvolvimento.ler → ErroDeAutorizacao; ?destino=urgente só traz urgentes', async () => {
  await expect(obterListaDeDemandas(semPermissao, null, AGORA)).rejects.toBeInstanceOf(
    ErroDeAutorizacao,
  )

  await demanda('Corrige a exportação', {
    destino: 'URGENTE',
    tipo: 'DEFEITO',
    etapaAtual: 'desenvolvida',
    concluidas: ['recebida', 'planejada', 'desenho'],
  })
  await demanda('Tela de funil de vendas', {
    destino: 'FILA_DE_AGENTES',
    tipo: 'FUNCAO_NOVA',
    origem: 'SESSAO',
    etapaAtual: 'desenho',
    concluidas: ['recebida', 'planejada'],
    espera: 'aprovar_desenho',
    esperaDesde: minutos(-180),
  })
  await demanda('Exportar contatos em CSV', { tipo: 'AJUSTE', criadaEm: minutos(-5) })
  await demanda('Orientada hoje', {
    destino: 'ORIENTADA',
    origem: 'SESSAO',
    encerrada: 'orientada',
    atualizadaEm: minutos(-10),
  })
  await demanda('Precisa de decisão', {
    destino: 'DECISAO_DO_PAULO',
    espera: 'decidir_destino',
    esperaDesde: minutos(-120),
  })
  // Ontem em São Paulo: não entra nas Recebidas de hoje.
  await demanda('De ontem', {
    criadaEm: new Date('2026-11-20T02:00:00.000Z'),
    etapaAtual: 'planejada',
  })

  const tela = await obterListaDeDemandas(admin, null, AGORA)
  expect(tela.podeCriar).toBe(true)
  expect(tela.orientadasHoje).toBe(1)
  expect(tela.grupos.map((g) => [g.titulo, g.linhas.map((l) => l.titulo)])).toEqual([
    ['Espera você', ['Tela de funil de vendas', 'Precisa de decisão']],
    ['Não chegou ao ar', []],
    [
      'A caminho',
      expect.arrayContaining(['Corrige a exportação', 'De ontem', 'Exportar contatos em CSV']),
    ],
    ['No ar', []],
  ])
  const funil = tela.grupos[0]?.linhas[0]
  expect(funil).toMatchObject({
    projeto: 'Projeto Alfa',
    estado: { texto: 'Aprovar desenho', tom: 'atencao' },
    idade: '3 h',
  })

  const urgentes = await obterListaDeDemandas(admin, 'urgente', AGORA)
  expect(urgentes.grupos.flatMap((g) => g.linhas.map((l) => l.titulo))).toEqual([
    'Corrige a exportação',
  ])
  // O filtro só muda a lista; os números continuam com todas.
  expect(urgentes.quadros.find((q) => q.chave === 'a_caminho')?.numero).toBe(3)
})

test('Fábrica sem buscar há 12 min com recebidas → fabricaSemBuscar "a Fábrica não busca há 12 min"', async () => {
  await demanda('Recebida parada', { criadaEm: minutos(-15) })
  await db.fonteDaFabrica.create({
    data: {
      nome: 'Fábrica',
      tokenHash: 'hash-tela-demandas',
      criadaPorId: admin.usuarioId,
      demandasBuscadasEm: minutos(-12),
    },
  })
  await db.configuracaoDePublicacao.create({
    data: { repositorioId, workflow: 'publicar.yml', horaDoLote: '21:30' },
  })

  const tela = await obterListaDeDemandas(admin, null, AGORA)
  expect(tela.fabricaSemBuscar).toBe('a Fábrica não busca há 12 min')

  await db.fonteDaFabrica.updateMany({ data: { demandasBuscadasEm: minutos(-1) } })
  expect((await obterListaDeDemandas(admin, null, AGORA)).fabricaSemBuscar).toBeNull()
})

test('?destino=orientada traz o grupo "Orientadas hoje" só com as orientadas de hoje', async () => {
  await demanda('Orientada hoje', {
    destino: 'ORIENTADA',
    encerrada: 'orientada',
    atualizadaEm: minutos(-20),
  })
  await demanda('Orientada ontem', {
    destino: 'ORIENTADA',
    encerrada: 'orientada',
    criadaEm: new Date('2026-11-19T12:00:00.000Z'),
    atualizadaEm: new Date('2026-11-20T02:00:00.000Z'),
  })
  await demanda('Entregue hoje', { encerrada: 'entregue', etapaAtual: 'entregue' })
  await demanda('Aberta', { etapaAtual: 'desenvolvida' })

  const tela = await obterListaDeDemandas(admin, 'orientada', AGORA)
  expect(tela.grupos.map((g) => [g.titulo, g.linhas.map((l) => l.titulo)])).toEqual([
    ['Espera você', []],
    ['Não chegou ao ar', []],
    ['A caminho', []],
    ['No ar', []],
    ['Orientadas hoje', ['Orientada hoje']],
  ])
  expect(tela.grupos[4]?.linhas[0]?.estado).toEqual({ texto: 'Orientada', tom: 'neutro' })

  const semFiltro = await obterListaDeDemandas(admin, null, AGORA)
  expect(semFiltro.grupos.map((g) => g.titulo)).not.toContain('Orientadas hoje')
  const urgentes = await obterListaDeDemandas(admin, 'urgente', AGORA)
  expect(urgentes.grupos.map((g) => g.titulo)).not.toContain('Orientadas hoje')
})

test('projeto arquivado some da lista e dos quadros', async () => {
  await demanda('Do arquivado', { etapaAtual: 'desenvolvida' })
  await db.projeto.update({ where: { id: projetoId }, data: { arquivadoEm: AGORA } })
  const tela = await obterListaDeDemandas(admin, null, AGORA)
  expect(tela.quadros.every((q) => q.numero === 0)).toBe(true)
  expect(tela.grupos.every((g) => g.linhas.length === 0)).toBe(true)
})

const NO_AR = ['recebida', 'planejada', 'desenho', 'desenvolvida', 'testada', 'entregue'] as const

async function comPartes(
  titulo: string,
  partes: { chave: string; ordem: number; dependeDe?: string[]; [k: string]: unknown }[],
  extra: Extra = {},
) {
  const d = await demanda(titulo, {
    etapaAtual: 'no_ar',
    concluidas: [...NO_AR],
    ...extra,
  })
  await db.parteDaDemanda.deleteMany({ where: { demandaId: d.id } })
  for (const p of partes) {
    await db.parteDaDemanda.create({
      data: { demandaId: d.id, repositorioId, dependeDe: [], ...p } as never,
    })
  }
  return d
}

test('os quatro números batem com os grupos; no ar há mais de 30 dias e entregue antiga ficam fora', async () => {
  await demanda('Espera', { espera: 'travada', esperaDesde: minutos(-60 * 24 * 4) })
  await comPartes(
    'Modo editor com IA',
    [
      { chave: 'back', ordem: 1 },
      {
        chave: 'front',
        ordem: 2,
        dependeDe: ['back'],
        estado: 'NAO_CHEGOU',
        motivo: 'Publicação dispensada',
      },
    ],
    { naoChegouDesde: minutos(-60 * 24) },
  )
  await comPartes('Suporte por IA', [
    { chave: 'back', ordem: 1, estado: 'PUBLICANDO', motivo: 'Conferindo o site' },
  ])
  await comPartes(
    'Nome da aba',
    [
      {
        chave: 'front',
        ordem: 1,
        estado: 'NO_AR',
        commitNoAr: 'c5c01ba0000',
        noArEm: minutos(-30),
      },
    ],
    { encerrada: 'no_ar', noArEm: minutos(-30) },
  )
  await comPartes('Velha', [{ chave: 'front', ordem: 1, estado: 'NO_AR' }], {
    encerrada: 'no_ar',
    noArEm: new Date('2026-10-01T12:00:00.000Z'),
  })
  await demanda('Entregue antiga', { encerrada: 'entregue', entregueEm: minutos(-60) })

  const tela = await obterListaDeDemandas(admin, null, AGORA)
  expect(tela.quadros.map((q) => [q.chave, q.numero, q.meta])).toEqual([
    ['no_ar', 1, 'conferidas no site'],
    ['a_caminho', 1, 'Fábrica trabalhando'],
    ['nao_chegou', 1, 'feita, mas falta algo'],
    ['espera_voce', 1, 'há 4 dias'],
  ])
  for (const q of tela.quadros) {
    expect(tela.grupos.find((g) => g.chave === q.chave)?.linhas).toHaveLength(q.numero)
  }
  const falta = tela.grupos.find((g) => g.chave === 'nao_chegou')?.linhas[0]
  expect(falta).toMatchObject({
    titulo: 'Modo editor com IA',
    partes: [
      { chave: 'back', texto: 'planejando', tom: 'neutro' },
      { chave: 'front', texto: 'dispensada', tom: 'nao' },
    ],
    trilho: ['cheio', 'cheio', 'andando', 'vermelho'],
    estado: { texto: 'Falta a parte do back', tom: 'erro' },
  })
  expect(tela.grupos.find((g) => g.chave === 'no_ar')?.linhas[0]?.estado).toEqual({
    texto: 'No ar · c5c01ba',
    tom: 'sucesso',
  })

  const pagina = await obterPaginaDaDemanda(admin, falta!.id, AGORA)
  expect(pagina?.falta?.titulo).toBe('Falta: a parte do back')
  expect(pagina?.ordem).toBe('Ordem de publicação: back antes do front')
  expect(pagina?.partes.map((p) => p.titulo)).toEqual(['1 · Back', '2 · Front'])
  expect(pagina?.trilho).toEqual(['cheio', 'cheio', 'andando', 'vermelho'])
})

test('conferirNoArPeloPaulo: sem permissão lança; parte que não espera é recusada; com permissão fecha a demanda', async () => {
  const d = await comPartes(
    'Publicada sem conferir',
    [
      {
        chave: 'alfa',
        ordem: 1,
        estado: 'NAO_CHEGOU',
        motivo: 'Publicada sem conferir o site',
        commitAlvo: 'abc1234def',
      },
    ],
    { naoChegouDesde: minutos(-60) },
  )
  const leitor: Sujeito = {
    usuarioId: admin.usuarioId,
    papeis: [{ papel: 'APROVADOR', clienteId: null }],
  }
  await expect(conferirNoArPeloPaulo(leitor, d.id, 'alfa')).rejects.toBeInstanceOf(
    ErroDeAutorizacao,
  )
  await expect(conferirNoArPeloPaulo(admin, d.id, 'outra')).rejects.toThrow(
    'Esta parte não espera a sua conferência.',
  )

  const antes = await obterPaginaDaDemanda(admin, d.id, AGORA)
  expect(antes?.falta).toEqual({
    titulo: 'Falta: a parte do alfa',
    contexto: 'Publicada sem conferir o site.',
    conferir: 'alfa',
  })

  await conferirNoArPeloPaulo(admin, d.id, 'alfa')
  const parte = await db.parteDaDemanda.findFirstOrThrow({ where: { demandaId: d.id } })
  expect(parte).toMatchObject({
    estado: 'NO_AR',
    conferidaPorId: admin.usuarioId,
    commitNoAr: 'abc1234def',
    motivo: null,
  })
  const fechada = await db.demanda.findUniqueOrThrow({ where: { id: d.id } })
  expect(fechada.encerrada).toBe('no_ar')
  expect(fechada.naoChegouDesde).toBeNull()
  const eventos = await db.eventoDaDemanda.findMany({
    where: { demandaId: d.id },
    orderBy: { seq: 'asc' },
    select: { tipo: true },
  })
  expect(eventos.map((e) => e.tipo)).toEqual(['parte_conferida_pelo_paulo', 'no_ar'])

  const depois = await obterPaginaDaDemanda(admin, d.id, AGORA)
  expect(depois?.falta).toBeNull()
  expect(depois?.entrega).toBe('✓ No ar · abc1234')
  expect(depois?.historico[1]?.evento).toBe('Parte alfa conferida pelo Paulo')

  // Repetir não muda nada: a parte já está no ar.
  await expect(conferirNoArPeloPaulo(admin, d.id, 'alfa')).rejects.toThrow()
})
