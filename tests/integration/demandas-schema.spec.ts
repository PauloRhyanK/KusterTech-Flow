import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { MODELO_PADRAO } from '@/modules/demandas/model'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-11-20T12:00:00.000Z')

async function cenario() {
  await sincronizarCatalogo(criarFonteFixtures(), agora)
  const repositorio = await db.repositorioGitHub.findFirstOrThrow()
  const projeto = await db.projeto.create({ data: { nome: 'P', nomeNormalizado: 'p' } })
  return { repositorio, projeto }
}

function dadosDaDemanda(projetoId: string, repositorioId: string, extra = {}) {
  return {
    projetoId,
    repositorioId,
    titulo: 'T',
    nivel: 'APROVAR_DESENHO' as const,
    temTela: true,
    origem: 'FLOW' as const,
    etapas: [],
    etapaAtual: 'recebida',
    ...extra,
  }
}

beforeEach(async () => {
  await limparBanco()
})

describe('schema de Demandas', () => {
  test('a migration deixa um único ModeloDeEtapas padrao com as seis etapas na ordem e esperaEm do MODELO_PADRAO', async () => {
    const modelos = await db.modeloDeEtapas.findMany({
      where: { padrao: true },
      include: { etapas: { orderBy: { ordem: 'asc' } } },
    })
    expect(modelos).toHaveLength(1)
    const etapas = modelos[0]!.etapas
    expect(etapas.map((e) => e.chave)).toEqual(MODELO_PADRAO.map((e) => e.chave))
    etapas.forEach((e, i) => {
      const esperado = MODELO_PADRAO[i]!
      expect(e).toMatchObject({
        nome: esperado.nome,
        rotulo: esperado.rotulo,
        marco: esperado.marco,
        quemConclui: esperado.quemConclui.toUpperCase(),
        puladaSemTela: esperado.puladaSemTela,
      })
      expect(e.esperaEm).toEqual(esperado.esperaEm.map((n) => n.toUpperCase()))
    })
  })

  test('segundo modelo com padrao true → P2002', async () => {
    await expect(
      db.modeloDeEtapas.create({ data: { nome: 'Outro', padrao: true } }),
    ).rejects.toMatchObject({
      code: 'P2002',
    })
    await expect(db.modeloDeEtapas.create({ data: { nome: 'Outro' } })).resolves.toBeTruthy()
  })

  test('Projeto nasce com nivelPadraoDeDemanda APROVAR_DESENHO e modeloDeEtapasId null', async () => {
    const { projeto } = await cenario()
    expect(projeto.nivelPadraoDeDemanda).toBe('APROVAR_DESENHO')
    expect(projeto.modeloDeEtapasId).toBeNull()
  })

  test('EventoDaDemanda.idExterno é único: repetir → P2002; seq cresce a cada inserção', async () => {
    const { projeto, repositorio } = await cenario()
    const d = await db.demanda.create({ data: dadosDaDemanda(projeto.id, repositorio.id) })
    const ev = (idExterno: string) =>
      db.eventoDaDemanda.create({
        data: { idExterno, demandaId: d.id, tipo: 'criada', origem: 'flow', dados: {}, em: agora },
      })
    const a = await ev('a')
    const b = await ev('b')
    expect(b.seq).toBeGreaterThan(a.seq)
    await expect(ev('a')).rejects.toMatchObject({ code: 'P2002' })
  })

  test('Demanda com a mesma (fonteId, chaveDaFonte) → P2002; chaveDaFonte null repetida → ok', async () => {
    const { projeto, repositorio } = await cenario()
    const admin = await db.usuario.create({
      data: { email: 'a@x.test', nome: 'A', senhaHash: 'x' },
    })
    const fonte = await db.fonteDeDemandas.create({
      data: { nome: 'f', tokenHash: 'h', criadaPorId: admin.id },
    })
    const nova = (chaveDaFonte: string | null) =>
      db.demanda.create({
        data: dadosDaDemanda(projeto.id, repositorio.id, { fonteId: fonte.id, chaveDaFonte }),
      })
    await nova('k')
    await expect(nova('k')).rejects.toMatchObject({ code: 'P2002' })
    await nova(null)
    await expect(nova(null)).resolves.toBeTruthy()
  })

  test('apagar a Demanda apaga eventos e arquivos (Cascade); zera PedidoDePublicacao.demandaId (SetNull)', async () => {
    const { projeto, repositorio } = await cenario()
    const d = await db.demanda.create({ data: dadosDaDemanda(projeto.id, repositorio.id) })
    await db.eventoDaDemanda.create({
      data: {
        idExterno: 'e',
        demandaId: d.id,
        tipo: 'criada',
        origem: 'flow',
        dados: {},
        em: agora,
      },
    })
    await db.arquivoDaDemanda.create({
      data: {
        id: 'arq',
        demandaId: d.id,
        tipo: 'ANEXO',
        nome: 'n',
        conteudo: 'c',
        tamanho: 1,
        enviadoPor: 'u',
      },
    })
    const pedido = await db.pedidoDePublicacao.create({
      data: { repositorioId: repositorio.id, modo: 'IMEDIATO', demandaId: d.id },
    })
    await db.demanda.delete({ where: { id: d.id } })
    expect(await db.eventoDaDemanda.count()).toBe(0)
    expect(await db.arquivoDaDemanda.count()).toBe(0)
    const depois = await db.pedidoDePublicacao.findUniqueOrThrow({ where: { id: pedido.id } })
    expect(depois.demandaId).toBeNull()
  })
})
