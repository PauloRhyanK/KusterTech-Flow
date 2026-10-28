import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import {
  lerFiltrosDaFila,
  listarFilaDeDesenvolvimento,
  type FiltrosDaFila,
  type ItemDaFila,
} from '@/modules/desenvolvimento/queries'
import { sincronizarExecucoesWarren } from '@/modules/desenvolvimento/sincronizacao'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const t0 = new Date('2026-10-21T10:00:00.000Z')
const INTERVALO = 600_000

let admin: Sujeito
let projetoP: { id: string }
let projetoQ: { id: string }

const padrao: FiltrosDaFila = { projetoId: null, situacao: 'abertos', origem: 'todas' }

async function vincular(nomeCompleto: string, projetoId: string) {
  const repo = await db.repositorioGitHub.findFirstOrThrow({ where: { nomeCompleto } })
  await db.repositorioGitHub.update({
    where: { id: repo.id },
    data: { projetoId, vinculadoEm: t0 },
  })
  await sincronizarRepositorio(criarFonteFixtures(), repo.id, t0)
  return repo
}

function resumo(i: ItemDaFila): string {
  return `${i.projeto.nome}|${i.repositorio.split('/')[1]}|${i.referencia}`
}

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-dev@local.test',
    nome: 'Admin Dev',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }

  await sincronizarCatalogo(criarFonteFixtures(), t0)
  projetoP = await db.projeto.create({ data: { nome: 'P', nomeNormalizado: 'p' } })
  projetoQ = await db.projeto.create({ data: { nome: 'Q', nomeNormalizado: 'q' } })
  await vincular('kustertech-exemplo/automacao', projetoP.id)
  await vincular('kustertech-exemplo/portal', projetoQ.id)
  const api = await vincular('kustertech-exemplo/api', projetoQ.id)
  await db.repositorioGitHub.update({
    where: { id: api.id },
    data: { projetoId: null, vinculadoEm: null },
  })
  await sincronizarExecucoesWarren(criarFonteFixtures(), t0, INTERVALO)
})

afterAll(async () => {
  await db.$disconnect()
})

describe('fila de desenvolvimento (integração)', () => {
  test('padrão (abertos, todas as origens): 8 itens — P: issue #1, PR #3, PR #5, run_exemplo0003; Q: issues #1–#3 e PR #6; os dois primeiros são PR #3 de automacao e PR #6 de portal (intervenção), o terceiro run_exemplo0003 (Executando); nada de api', async () => {
    const { itens, total } = await listarFilaDeDesenvolvimento(admin, padrao, t0)

    expect(total).toBe(8)
    expect(itens.map(resumo).slice(0, 3)).toEqual([
      'P|automacao|PR #3',
      'Q|portal|PR #6',
      'P|automacao|Execução',
    ])
    expect(itens[0]).toMatchObject({
      situacao: 'intervencao',
      motivo: 'Checks com falha no GitHub.',
      abertaPeloWarren: true,
      externo: true,
      checks: { texto: 'Checks com falha', tom: 'erro' },
    })
    expect(itens[1]).toMatchObject({ situacao: 'intervencao', abertaPeloWarren: false })
    expect(itens[2]).toMatchObject({
      tipo: 'execucao',
      origem: 'warren',
      titulo: 'EXEM-a003 · Agendar envio do relatório (Task 3)',
      estado: { texto: 'Executando', tom: 'execucao' },
      externo: false,
    })
    expect(itens[2]?.href).toMatch(/^\/desenvolvimento\/execucoes\/[0-9a-f-]{36}$/)
    expect(itens.map(resumo).slice(3).sort()).toEqual(
      [
        'P|automacao|PR #5',
        'P|automacao|Issue #1',
        'Q|portal|Issue #1',
        'Q|portal|Issue #2',
        'Q|portal|Issue #3',
      ].sort(),
    )
    expect(itens.map(resumo).slice(3, 4)).toEqual(['P|automacao|PR #5'])
    expect(itens.some((i) => i.repositorio.endsWith('/api'))).toBe(false)
    const issue = itens.find((i) => i.referencia === 'Issue #1' && i.projeto.nome === 'P')
    expect(issue?.href).toMatch(new RegExp(`^/projetos/${projetoP.id}/entregas/issues/`))
    expect(issue?.estado).toEqual({ texto: 'Aberta', tom: 'informacao' })
    expect(itens.some((i) => i.estado.tom === 'sucesso' || i.checks?.tom === 'sucesso')).toBe(false)
  })

  test('projeto=Q → 4; origem=warren e situacao=todos → 3 execuções; situacao=intervencao → 2; projeto=P e situacao=encerrados → issue #2, PR #4, run_exemplo0001, run_exemplo0002', async () => {
    const q = await listarFilaDeDesenvolvimento(admin, { ...padrao, projetoId: projetoQ.id }, t0)
    expect(q.itens).toHaveLength(4)
    expect(q.itens.every((i) => i.projeto.nome === 'Q')).toBe(true)

    const warren = await listarFilaDeDesenvolvimento(
      admin,
      { ...padrao, situacao: 'todos', origem: 'warren' },
      t0,
    )
    expect(warren.itens).toHaveLength(3)
    expect(warren.itens.every((i) => i.tipo === 'execucao')).toBe(true)

    const github = await listarFilaDeDesenvolvimento(admin, { ...padrao, origem: 'github' }, t0)
    expect(github.itens.every((i) => i.tipo !== 'execucao')).toBe(true)
    expect(github.total).toBe(7)

    const intervencao = await listarFilaDeDesenvolvimento(
      admin,
      { ...padrao, situacao: 'intervencao' },
      t0,
    )
    expect(intervencao.itens.map(resumo)).toEqual(['P|automacao|PR #3', 'Q|portal|PR #6'])

    const encerrados = await listarFilaDeDesenvolvimento(
      admin,
      { projetoId: projetoP.id, situacao: 'encerrados', origem: 'todas' },
      t0,
    )
    expect(encerrados.itens.map(resumo).sort()).toEqual(
      [
        'P|automacao|Issue #2',
        'P|automacao|PR #4',
        'P|automacao|Execução',
        'P|automacao|Execução',
      ].sort(),
    )
    expect(
      encerrados.itens
        .filter((i) => i.tipo === 'execucao')
        .map((i) => i.titulo)
        .sort(),
    ).toEqual([
      'EXEM-a001 · Exportar relatório de entregas (Task 1)',
      'EXEM-a002 · Ajustar filtro de clientes (Task 2)',
    ])
    expect(encerrados.itens.find((i) => i.referencia === 'PR #4')?.estado).toEqual({
      texto: 'Mergeado',
      tom: 'neutro',
    })
  })

  test('fontes: execucoesPorEstado { CONCLUIDA: 2, EXECUTANDO: 1 } e zeros; automacao lido com 1 linha inválida; portal sem-seeds; projeto arquivado sai da fila e da lista de projetos', async () => {
    const { fontes, projetos } = await listarFilaDeDesenvolvimento(admin, padrao, t0)

    expect(fontes.execucoesPorEstado).toEqual({
      NA_FILA: 0,
      AGUARDANDO_CAPACIDADE: 0,
      AGUARDANDO_DEPENDENCIA: 0,
      EXECUTANDO: 1,
      INTERVENCAO_NECESSARIA: 0,
      CONCLUIDA: 2,
      SEM_DADOS: 0,
    })
    expect(fontes.githubConfigurado).toBe(true)
    expect(fontes.github).toBe('conectada')
    expect(fontes.githubSincronizadoEm).toEqual(t0)
    expect(fontes.repositorios).toEqual([
      {
        repositorio: 'kustertech-exemplo/automacao',
        situacao: 'lido',
        lidoEm: t0,
        falhaMotivo: null,
        linhasInvalidas: 1,
      },
      {
        repositorio: 'kustertech-exemplo/portal',
        situacao: 'sem-seeds',
        lidoEm: t0,
        falhaMotivo: null,
        linhasInvalidas: 0,
      },
    ])
    expect(projetos).toEqual([
      { id: projetoP.id, nome: 'P' },
      { id: projetoQ.id, nome: 'Q' },
    ])

    await db.projeto.update({ where: { id: projetoQ.id }, data: { arquivadoEm: t0 } })
    const depois = await listarFilaDeDesenvolvimento(admin, padrao, t0)
    expect(depois.projetos).toEqual([{ id: projetoP.id, nome: 'P' }])
    expect(depois.total).toBe(4)
    expect(depois.itens.every((i) => i.projeto.nome === 'P')).toBe(true)
    expect(depois.fontes.repositorios.map((r) => r.repositorio)).toEqual([
      'kustertech-exemplo/automacao',
    ])
  })

  test('falha e leitura desatualizada do Warren aparecem na situação das fontes sem esconder a lista', async () => {
    const automacao = await db.repositorioGitHub.findFirstOrThrow({
      where: { nomeCompleto: 'kustertech-exemplo/automacao' },
    })
    const depois = new Date(t0.getTime() + 60_000)
    await db.repositorioGitHub.update({
      where: { id: automacao.id },
      data: { warrenFalhaEm: depois, warrenFalhaMotivo: 'Não foi possível falar com o GitHub.' },
    })
    const comFalha = await listarFilaDeDesenvolvimento(admin, padrao, depois)
    const leitura = comFalha.fontes.repositorios.find((r) => r.repositorio.endsWith('/automacao'))
    expect(leitura).toMatchObject({
      situacao: 'falha',
      lidoEm: t0,
      falhaMotivo: 'Não foi possível falar com o GitHub.',
    })
    expect(comFalha.total).toBe(8)

    await db.repositorioGitHub.update({
      where: { id: automacao.id },
      data: { warrenFalhaEm: null, warrenFalhaMotivo: null },
    })
    const muitoDepois = new Date(t0.getTime() + 3 * INTERVALO + 1)
    const velho = await listarFilaDeDesenvolvimento(admin, padrao, muitoDepois)
    expect(
      velho.fontes.repositorios.find((r) => r.repositorio.endsWith('/automacao'))?.situacao,
    ).toBe('desatualizado')
  })

  test('mais de 100 itens: devolve 100 linhas e o total real', async () => {
    const repo = await db.repositorioGitHub.findFirstOrThrow({
      where: { nomeCompleto: 'kustertech-exemplo/portal' },
    })
    await db.issueGitHub.createMany({
      data: Array.from({ length: 110 }, (_, n) => ({
        githubId: BigInt(9_000_000 + n),
        repositorioId: repo.id,
        numero: 1000 + n,
        titulo: `Issue em massa ${n}`,
        estado: 'ABERTA' as const,
        responsaveis: [],
        rotulos: [],
        urlHtml: `https://github.com/kustertech-exemplo/portal/issues/${1000 + n}`,
        criadaNoGitHub: t0,
        atualizadaNoGitHub: t0,
        sincronizadaEm: t0,
      })),
    })

    const { itens, total } = await listarFilaDeDesenvolvimento(admin, padrao, t0)

    expect(itens).toHaveLength(100)
    expect(total).toBe(118)
  })

  test('lerFiltrosDaFila continua coerente com o que a consulta aceita', () => {
    expect(lerFiltrosDaFila({ situacao: 'todos', origem: 'github' })).toEqual({
      projetoId: null,
      situacao: 'todos',
      origem: 'github',
    })
  })
})
