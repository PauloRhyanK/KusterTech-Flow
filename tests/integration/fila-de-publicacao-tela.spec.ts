import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { MOTIVOS } from '@/modules/fila-de-publicacao/model'
import { obterTelaDePublicacao } from '@/modules/fila-de-publicacao/queries'
import {
  alternarPausaGeral,
  redefinirNoAr,
  retomarFila,
} from '@/modules/fila-de-publicacao/service'
import { commitNoAr } from '@/modules/fila-de-publicacao/worker'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

// 12:00 em São Paulo; o lote de ontem foi às 22:00 locais (01:00Z de hoje).
const AGORA = new Date('2026-11-19T15:00:00.000Z')
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000)
const LOTE = new Date('2026-11-19T01:00:00.000Z')
const noLote = (m: number) => new Date(LOTE.getTime() + m * 60_000)
const sha = (c: string) => c.repeat(40)

let admin: Sujeito
const semPermissao: Sujeito = {
  usuarioId: '00000000-0000-0000-0000-000000000000',
  papeis: [{ papel: 'APROVADOR', clienteId: null }],
}
let alfa: string
let beta: string
let gama: string
let gamaProjetoId: string

let githubId = 7000
async function repositorio(nome: string, projetoId: string) {
  githubId += 1
  const r = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(githubId),
      instalacaoId: BigInt(900001),
      nomeCompleto: `kustertech-exemplo/${nome}`,
      urlHtml: `https://github.com/kustertech-exemplo/${nome}`,
      privado: false,
      projetoId,
      vinculadoEm: AGORA,
      catalogadoEm: AGORA,
    },
  })
  return r.id
}

async function projeto(nome: string) {
  const p = await db.projeto.create({
    data: { nome, nomeNormalizado: nome.toLowerCase().replaceAll(' ', '-') },
  })
  return p.id
}

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-tela-publicacao@local.test',
    nome: 'Admin Tela',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }

  alfa = await repositorio('portal', await projeto('Projeto Alfa'))
  beta = await repositorio('beta', await projeto('Projeto Beta'))
  gamaProjetoId = await projeto('Projeto Gama')
  gama = await repositorio('gama', gamaProjetoId)
  // Projeto arquivado não aparece.
  const arquivado = await db.projeto.create({
    data: { nome: 'Projeto Velho', nomeNormalizado: 'projeto-velho', arquivadoEm: AGORA },
  })
  await repositorio('velho', arquivado.id)

  await db.configuracaoDePublicacao.create({
    data: { repositorioId: alfa, workflow: 'deploy.yml' },
  })
  await db.configuracaoDePublicacao.create({
    data: {
      repositorioId: beta,
      workflow: 'deploy.yml',
      situacao: 'PARADO',
      situacaoDesde: minutos(-5),
      situacaoMotivo: MOTIVOS.desistiu,
    },
  })

  // Alfa: no ar há 3 h, subindo há 2 min, um em seguida e um no lote.
  await db.pedidoDePublicacao.createMany({
    data: [
      {
        repositorioId: alfa,
        commit: sha('1'),
        modo: 'IMEDIATO',
        estado: 'PUBLICADO',
        iniciadoEm: minutos(-186),
        concluidoEm: minutos(-180),
      },
      {
        repositorioId: alfa,
        commit: sha('2'),
        modo: 'IMEDIATO',
        descricao: 'Corrige PDF cortado',
        estado: 'PUBLICANDO',
        checks: 'SUCESSO',
        iniciadoEm: minutos(-2),
        // Motivo provisório do disparo não aparece na tela.
        motivo: 'o GitHub não confirmou o disparo: rede',
      },
      {
        repositorioId: alfa,
        commit: sha('3'),
        modo: 'IMEDIATO',
        descricao: 'Exportar CSV',
        estado: 'NA_FILA',
        criadoEm: minutos(-1),
      },
      {
        repositorioId: alfa,
        commit: sha('4'),
        modo: 'LOTE',
        descricao: 'Máscara de telefone',
        estado: 'NA_FILA',
        criadoEm: minutos(-1),
      },
      // Lote de ontem: dois itens, um em cada projeto.
      {
        repositorioId: alfa,
        commit: sha('5'),
        modo: 'LOTE',
        descricao: 'Trocar rótulo do botão salvar',
        estado: 'PUBLICADO',
        loteEm: LOTE,
        iniciadoEm: LOTE,
        concluidoEm: noLote(6),
        criadoEm: minutos(-24 * 60),
      },
      {
        repositorioId: beta,
        commit: sha('6'),
        modo: 'LOTE',
        descricao: 'Fuso na agenda',
        estado: 'PUBLICADO',
        loteEm: LOTE,
        iniciadoEm: LOTE,
        concluidoEm: noLote(14),
        criadoEm: minutos(-24 * 60),
      },
    ],
  })
  // Beta: a publicação falhou e o conserto desistiu em 40 min.
  const falho = await db.pedidoDePublicacao.create({
    data: {
      repositorioId: beta,
      commit: sha('9'),
      modo: 'IMEDIATO',
      estado: 'FALHOU',
      execucaoUrl: 'https://github.com/kustertech-exemplo/beta/actions/runs/7',
      concluidoEm: minutos(-50),
    },
  })
  await db.pedidoDeConserto.create({
    data: {
      repositorioId: beta,
      pedidoId: falho.id,
      commit: sha('9'),
      trechoDoLog: 'erro',
      estado: 'DESISTIU',
      abertoEm: minutos(-45),
      encerradoEm: minutos(-5),
    },
  })
})

afterAll(async () => {
  await db.$disconnect()
})

describe('obterTelaDePublicacao', () => {
  test('sem desenvolvimento.ler → ErroDeAutorizacao; admin vê linhas, quadros e último lote do cenário', async () => {
    await expect(obterTelaDePublicacao(semPermissao, AGORA)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )

    const tela = await obterTelaDePublicacao(admin, AGORA)
    expect(tela.pausaGeral).toBe(false)
    expect(tela.podeGerenciar).toBe(true)
    expect(tela.podeRedefinir).toBe(true)
    expect(tela.linhas.map((l) => l.rotulo)).toEqual([
      'Projeto Alfa',
      'Projeto Beta',
      'Projeto Gama',
    ])

    const [a, b, g] = tela.linhas
    expect(a?.noAr).toEqual({ commit: sha('1'), desde: minutos(-180) })
    expect(a?.publicando).toMatchObject({ descricao: 'Corrige PDF cortado', checks: 'sucesso' })
    expect(a?.aguardando.map((p) => [p.descricao, p.modo])).toEqual([
      ['Exportar CSV', 'imediato'],
      ['Máscara de telefone', 'lote'],
    ])
    expect(a?.duracaoTipicaEmMin).toBe(6)
    expect(b?.configuracao?.situacao).toBe('parado')
    expect(g?.configuracao).toBeNull()
    expect(g?.projetoId).toBe(gamaProjetoId)

    expect(tela.resumo.subindo.n).toBe('Projeto Alfa · Corrige PDF cortado')
    expect(tela.resumo.subindo.m).toBe('há 2 min · costuma levar 6')
    expect(tela.resumo.naFila).toEqual({ n: '1', m: 'em 1 projeto' })
    expect(tela.resumo.lote).toEqual({ n: '1', m: 'às 22:00 · 1 projeto' })
    expect(tela.resumo.ultimoLote).toMatchObject({
      n: '2',
      de: 'de 2',
      m: 'ontem 22:00 · 14 min · sem falha',
    })
    expect(tela.ultimoLote.map((i) => [i.titulo, i.projeto])).toEqual([
      ['Trocar rótulo do botão salvar', 'Projeto Alfa'],
      ['Fuso na agenda', 'Projeto Beta'],
    ])
    expect(tela.rodapeDoLote).toBe('2 no ar · nenhuma voltou · terminou 22:14')

    expect(tela.avisos).toHaveLength(1)
    expect(tela.avisos[0]).toMatchObject({
      titulo: 'Projeto Beta parou: o agente não conseguiu consertar',
      contexto: 'falhou ao publicar 9999999 · conserto desistiu em 40 min',
      href: 'https://github.com/kustertech-exemplo/beta/actions/runs/7',
    })
  })

  test('projeto com dois repositórios mostra "<projeto> · <repo>"', async () => {
    const delta = await projeto('Projeto Delta')
    await repositorio('delta-api', delta)
    await repositorio('delta-web', delta)
    const tela = await obterTelaDePublicacao(admin, AGORA)
    expect(tela.linhas.map((l) => l.rotulo)).toContain('Projeto Delta · delta-api')
    expect(tela.linhas.map((l) => l.rotulo)).toContain('Projeto Delta · delta-web')
  })
})

describe('ações da tela', () => {
  test('alternarPausaGeral exige projetos.gerenciar e alterna; redefinirNoAr exige configuracoes.gerenciar e faz o próximo pedido valer como primeiro', async () => {
    await expect(alternarPausaGeral(semPermissao)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    expect(await alternarPausaGeral(admin)).toBe(true)
    expect((await obterTelaDePublicacao(admin, AGORA)).pausaGeral).toBe(true)
    expect(await alternarPausaGeral(admin)).toBe(false)
    expect((await obterTelaDePublicacao(admin, AGORA)).pausaGeral).toBe(false)

    await expect(redefinirNoAr(semPermissao, alfa)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    expect(await commitNoAr(alfa)).toBe(sha('1'))
    await redefinirNoAr(admin, alfa)
    const config = await db.configuracaoDePublicacao.findUniqueOrThrow({
      where: { repositorioId: alfa },
    })
    expect(config.baseRedefinidaEm).not.toBeNull()
    expect(await commitNoAr(alfa)).toBeNull()
    const tela = await obterTelaDePublicacao(admin, new Date())
    expect(tela.linhas[0]?.noAr).toBeNull()

    await expect(redefinirNoAr(admin, gama)).rejects.toBeInstanceOf(ErroDeDominio)
  })

  test('retomarFila: PARADO → NORMAL com situacaoMotivo null', async () => {
    await expect(retomarFila(semPermissao, beta)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await retomarFila(admin, beta)
    const config = await db.configuracaoDePublicacao.findUniqueOrThrow({
      where: { repositorioId: beta },
    })
    expect(config.situacao).toBe('NORMAL')
    expect(config.situacaoMotivo).toBeNull()
    await expect(retomarFila(admin, alfa)).rejects.toBeInstanceOf(ErroDeDominio)
  })
})
