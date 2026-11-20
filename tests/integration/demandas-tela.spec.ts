import { afterAll, beforeEach, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { MODELO_PADRAO } from '@/modules/demandas/model'
import { obterListaDeDemandas } from '@/modules/demandas/queries'
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
  expect(tela.quadros.map((q) => [q.chave, q.n, q.meta])).toEqual([
    ['recebidas', 5, 'você 3 · sessões 2'],
    ['orientadas', 1, 'sem ir à Fábrica'],
    ['urgente', 1, 'na frente da fila'],
    ['lote', 0, 'publica às 22:00'],
    ['agentes', 1, 'sem notícias da Fábrica'],
    ['decisao', 1, 'a mais antiga: 2 h'],
  ])
  expect(tela.grupos.map((g) => [g.titulo, g.linhas.map((l) => l.titulo)])).toEqual([
    ['Espera você', ['Tela de funil de vendas', 'Precisa de decisão']],
    ['Em andamento', expect.arrayContaining(['Corrige a exportação', 'De ontem'])],
    ['Na fila', ['Exportar contatos em CSV']],
  ])
  const funil = tela.grupos[0]?.linhas[0]
  expect(funil).toMatchObject({
    projeto: 'Projeto Alfa',
    icone: { letra: 'F', tom: 'execucao' },
    estado: { texto: 'Aprovar desenho', tom: 'atencao' },
    idade: '3 h',
  })

  const urgentes = await obterListaDeDemandas(admin, 'urgente', AGORA)
  expect(urgentes.grupos.flatMap((g) => g.linhas.map((l) => l.titulo))).toEqual([
    'Corrige a exportação',
  ])
  // O filtro só muda a lista; os quadros continuam com o dia inteiro.
  expect(urgentes.quadros[0]?.n).toBe(5)
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
  expect(tela.quadros.find((q) => q.chave === 'lote')?.meta).toBe('publica às 21:30')

  await db.fonteDaFabrica.updateMany({ data: { demandasBuscadasEm: minutos(-1) } })
  expect((await obterListaDeDemandas(admin, null, AGORA)).fabricaSemBuscar).toBeNull()
})

test('projeto arquivado some da lista e dos quadros', async () => {
  await demanda('Do arquivado', { etapaAtual: 'desenvolvida' })
  await db.projeto.update({ where: { id: projetoId }, data: { arquivadoEm: AGORA } })
  const tela = await obterListaDeDemandas(admin, null, AGORA)
  expect(tela.quadros[0]?.n).toBe(0)
  expect(tela.grupos.every((g) => g.linhas.length === 0)).toBe(true)
})
