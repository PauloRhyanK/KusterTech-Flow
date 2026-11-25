import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { MOTIVOS } from '@/modules/fila-de-publicacao/model'
import { obterPilha } from '@/modules/decidir/queries'
import { esperasDePublicacao, obterTelaDePublicacao } from '@/modules/fila-de-publicacao/queries'
import { definirPausaGeral, redefinirNoAr, retomarFila } from '@/modules/fila-de-publicacao/service'
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
        criadoEm: minutos(-2),
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
    expect(a?.noAr).toMatchObject({ commit: sha('1'), desde: minutos(-180) })
    expect(a?.conferencia).toBe(false)
    expect(a?.versaoConferida).toBeNull()
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
  test('definirPausaGeral exige projetos.gerenciar e grava o valor pedido, nos dois sentidos e sem efeito quando já está nele', async () => {
    await expect(definirPausaGeral(semPermissao, true)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    const pausa = () => db.pausaGeralDePublicacao.findUnique({ where: { id: 1 } })

    expect(await definirPausaGeral(admin, true)).toBe(true)
    expect((await obterTelaDePublicacao(admin, AGORA)).pausaGeral).toBe(true)
    const primeira = (await pausa())?.pausadaEm
    expect(primeira).not.toBeNull()
    // De novo "pausar": continua pausada, com o mesmo instante.
    expect(await definirPausaGeral(admin, true)).toBe(true)
    expect((await pausa())?.pausadaEm).toEqual(primeira)

    expect(await definirPausaGeral(admin, false)).toBe(false)
    expect((await obterTelaDePublicacao(admin, AGORA)).pausaGeral).toBe(false)
    expect(await definirPausaGeral(admin, false)).toBe(false)
    expect((await pausa())?.pausadaEm).toBeNull()
  })

  test('aba velha: alguém já pausou tudo e outra aba ainda mostra "Pausar tudo" → continua pausada', async () => {
    await definirPausaGeral(admin, true)
    // A aba velha envia pausar=true (o que ela mostrava); nada é retomado.
    expect(await definirPausaGeral(admin, true)).toBe(true)
    expect((await obterTelaDePublicacao(admin, AGORA)).pausaGeral).toBe(true)
  })

  test('redefinirNoAr exige configuracoes.gerenciar, só age com o histórico reescrito e faz o próximo pedido valer como primeiro', async () => {
    await expect(redefinirNoAr(semPermissao, alfa)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    // Sem recusa por histórico reescrito: recusa redefinir.
    await expect(redefinirNoAr(admin, alfa)).rejects.toBeInstanceOf(ErroDeDominio)
    const recusar = (motivo: string, concluidoEm: Date) =>
      db.pedidoDePublicacao.create({
        data: {
          repositorioId: alfa,
          commit: sha('7'),
          modo: 'IMEDIATO',
          estado: 'RECUSADO',
          motivo,
          concluidoEm,
        },
      })
    await recusar(MOTIVOS.foraDeMain, minutos(-20))
    await expect(redefinirNoAr(admin, alfa)).rejects.toBeInstanceOf(ErroDeDominio)
    // Recusa antiga, com uma publicação depois dela: o histórico já voltou a andar.
    await recusar(MOTIVOS.historicoReescrito, minutos(-200))
    await expect(redefinirNoAr(admin, alfa)).rejects.toBeInstanceOf(ErroDeDominio)
    expect(
      (await db.configuracaoDePublicacao.findUniqueOrThrow({ where: { repositorioId: alfa } }))
        .baseRedefinidaEm,
    ).toBeNull()

    await recusar(MOTIVOS.historicoReescrito, minutos(-10))
    expect(await commitNoAr(alfa)).toBe(sha('1'))
    await redefinirNoAr(admin, alfa)
    const config = await db.configuracaoDePublicacao.findUniqueOrThrow({
      where: { repositorioId: alfa },
    })
    expect(config.baseRedefinidaEm).not.toBeNull()
    expect(await commitNoAr(alfa)).toBeNull()
    const tela = await obterTelaDePublicacao(admin, new Date())
    expect(tela.linhas[0]?.noAr).toBeNull()
    // Redefinido: a recusa ficou antes da base e não pede outra redefinição.
    await expect(redefinirNoAr(admin, alfa)).rejects.toBeInstanceOf(ErroDeDominio)

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

describe('versão no ar: tela, Início e Decidir', () => {
  const RUN = 'https://github.com/kustertech-exemplo/cais/actions/runs/88'
  const MOTIVO = `o deploy terminou, mas o site no ar mostra a versão ${'7'.repeat(7)}, não ${'8'.repeat(7)}`

  test('publicação que não conferiu: a linha mostra a versão conferida e o aviso chega à tela, ao Início e ao Decidir', async () => {
    const cais = await repositorio('cais', await projeto('CAIS'))
    await db.configuracaoDePublicacao.create({
      data: {
        repositorioId: cais,
        workflow: 'deploy.yml',
        urlDaVersao: 'https://cais.exemplo.test/versao.json',
        versaoNoAr: sha('7'),
        versaoConferidaEm: minutos(-60),
        situacao: 'PARADO',
        situacaoDesde: minutos(-3),
        situacaoMotivo: MOTIVO,
      },
    })
    await db.pedidoDePublicacao.createMany({
      data: [
        {
          repositorioId: cais,
          commit: sha('7'),
          modo: 'IMEDIATO',
          estado: 'PUBLICADO',
          execucaoUrl: 'https://github.com/kustertech-exemplo/cais/actions/runs/80',
          iniciadoEm: minutos(-66),
          concluidoEm: minutos(-60),
        },
        {
          repositorioId: cais,
          commit: sha('8'),
          modo: 'IMEDIATO',
          estado: 'FALHOU',
          motivo: MOTIVO,
          execucaoUrl: RUN,
          conferindoDesde: minutos(-6),
          concluidoEm: minutos(-3),
        },
      ],
    })

    const tela = await obterTelaDePublicacao(admin, AGORA)
    const linha = tela.linhas.find((l) => l.repositorioId === cais)!
    expect(linha.conferencia).toBe(true)
    expect(linha.versaoConferida).toEqual({ commit: sha('7'), em: minutos(-60) })
    const aviso = tela.avisos.find((a) => a.id === `parado-${cais}`)
    expect(aviso).toMatchObject({ titulo: `CAIS parou: ${MOTIVO}`, href: RUN, tom: 'erro' })

    const inicio = await esperasDePublicacao(admin, AGORA)
    expect(inicio.find((i) => i.id === `publicacao:parado-${cais}`)).toMatchObject({
      titulo: `CAIS parou: ${MOTIVO}`,
      href: '/publicacao',
      linkDoRun: RUN,
    })

    const pilha = await obterPilha(admin, AGORA)
    const item = pilha.itens.find(
      (i) => i.ref.tipo === 'publicacao' && i.ref.repositorioId === cais,
    )
    expect(item).toMatchObject({
      tipo: 'publicacao',
      titulo: `CAIS parou: ${MOTIVO}`,
      projeto: 'CAIS',
      repositorio: 'kustertech-exemplo/cais',
      relato: { href: RUN, externo: true },
    })
    // Retomada a fila, o aviso sai da pilha.
    await retomarFila(admin, cais)
    const depois = await obterPilha(admin, AGORA)
    expect(depois.itens.some((i) => i.chave === item!.chave)).toBe(false)
  })

  test('pedido dispensado por "já está no ar" aparece com a versão conferida', async () => {
    const cais = await repositorio('cais', await projeto('CAIS'))
    await db.configuracaoDePublicacao.create({
      data: {
        repositorioId: cais,
        workflow: 'deploy.yml',
        urlDaVersao: 'https://cais.exemplo.test/versao.json',
        versaoNoAr: sha('7'),
        versaoConferidaEm: minutos(-60),
      },
    })
    await db.pedidoDePublicacao.createMany({
      data: [
        {
          repositorioId: cais,
          commit: sha('7'),
          modo: 'IMEDIATO',
          estado: 'PUBLICADO',
          execucaoUrl: 'https://github.com/kustertech-exemplo/cais/actions/runs/80',
          concluidoEm: minutos(-60),
        },
        {
          repositorioId: cais,
          commit: sha('7'),
          modo: 'LOTE',
          descricao: 'Modo editor',
          estado: 'DISPENSADO',
          motivo: MOTIVOS.jaNoAr,
          concluidoEm: minutos(-10),
        },
      ],
    })
    const pilha = await obterPilha(admin, AGORA)
    expect(
      pilha.itens.find((i) => i.chave.startsWith(`publicacao:dispensado-${cais}`)),
    ).toMatchObject({
      titulo: 'CAIS: Modo editor não subiu de novo',
      relato: {
        resumo: `já está no ar: o site mostra ${'7'.repeat(7)}, que contém ${'7'.repeat(7)}`,
        href: 'https://github.com/kustertech-exemplo/cais/actions/runs/80',
      },
    })
  })
})
