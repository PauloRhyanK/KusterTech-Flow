import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { obterAtividade, obterAtividadeDoProjeto } from '@/modules/atividade/queries'
import { obterInicio } from '@/modules/inicio/queries'
import { criarProjeto } from '@/modules/projetos/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-20T12:00:00Z')
const MINUTO = 60_000
const HORA = 60 * MINUTO

let admin: Sujeito
let testadorEscopado: Sujeito
let proximoPr = 1

beforeEach(async () => {
  await limparBanco()
  proximoPr = 1
  const usuario = await criarUsuario({
    email: 'admin-atividade@local.test',
    nome: 'Admin Atividade',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }

  const cliente = await db.cliente.create({
    data: { nome: 'Cliente A', nomeNormalizado: 'cliente a' },
  })
  const testador = await criarUsuario({
    email: 'testador-atividade@local.test',
    nome: 'Testador Atividade',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'TESTADOR', clienteId: cliente.id }],
  })
  testadorEscopado = {
    usuarioId: testador.id,
    papeis: [{ papel: 'TESTADOR', clienteId: cliente.id }],
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await db.$disconnect()
})

async function criarRepositorio(
  sufixo: 'um' | 'dois',
  projetoId: string | null,
  situacao: { sincronizadoEm?: Date | null; ultimaFalhaEm?: Date | null } = {},
): Promise<string> {
  const repositorio = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(sufixo === 'um' ? 9_100_000_001 : 9_100_000_002),
      instalacaoId: BigInt(1),
      nomeCompleto: `kustertech-exemplo/atividade-${sufixo}`,
      urlHtml: `https://github.com/kustertech-exemplo/atividade-${sufixo}`,
      privado: true,
      projetoId,
      vinculadoEm: projetoId ? AGORA : null,
      sincronizadoEm:
        situacao.sincronizadoEm === undefined
          ? new Date(AGORA.getTime() - MINUTO)
          : situacao.sincronizadoEm,
      ultimaFalhaEm: situacao.ultimaFalhaEm ?? null,
      catalogadoEm: AGORA,
    },
  })
  return repositorio.id
}

async function criarPr(
  repositorioId: string,
  dados: {
    estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'
    mergeadoNoGitHub?: Date | null
    autor?: string | null
    branch?: string
    titulo?: string
  },
): Promise<void> {
  const numero = proximoPr++
  await db.pullRequestGitHub.create({
    data: {
      githubId: BigInt(9_200_000_000 + numero),
      repositorioId,
      numero,
      titulo: dados.titulo ?? `PR ${numero}`,
      estado: dados.estado,
      rascunho: false,
      autor: dados.autor ?? 'pessoa-exemplo',
      urlHtml: `https://github.com/kustertech-exemplo/atividade/pull/${numero}`,
      branch: dados.branch ?? `feat/pr-${numero}`,
      shaHead: `sha-${numero}`,
      atualizadoNoGitHub: AGORA,
      mergeadoNoGitHub: dados.mergeadoNoGitHub ?? null,
      sincronizadoEm: AGORA,
    },
  })
}

const haHoras = (h: number) => new Date(AGORA.getTime() - h * HORA)

test('dois repositórios do mesmo projeto: 3 mergeados na janela (2 no um, 1 no dois) e 2 abertos → uma linha { mergeadosHoje: 3, abertos: 2 }, totalHoje 3, sem dupla contagem', async () => {
  const projeto = await criarProjeto(admin, { nome: 'Projeto Atividade' })
  const um = await criarRepositorio('um', projeto.id)
  const dois = await criarRepositorio('dois', projeto.id)
  await criarPr(um, { estado: 'MERGEADO', mergeadoNoGitHub: haHoras(1), branch: 'claude/x' })
  await criarPr(um, {
    estado: 'MERGEADO',
    mergeadoNoGitHub: haHoras(2),
    autor: 'warren-forge[bot]',
  })
  await criarPr(dois, { estado: 'MERGEADO', mergeadoNoGitHub: haHoras(3) })
  await criarPr(um, { estado: 'ABERTO' })
  await criarPr(dois, { estado: 'ABERTO', branch: 'warren/run_1' })

  const atividade = await obterAtividade(admin, AGORA)

  expect(atividade.linhas).toEqual([
    {
      projeto: { id: projeto.id, nome: 'Projeto Atividade' },
      mergeadosHoje: 3,
      abertos: 2,
      porOrigem: { sessao: 1, fabrica: 2, outro: 2 },
      desatualizado: false,
    },
  ])
  expect(atividade.totalHoje).toBe(3)
  expect(atividade.desatualizado).toBe(false)
  expect(atividade.dadosDe).toEqual(new Date(AGORA.getTime() - MINUTO))
})

test('PR mergeado há 25 h, PR FECHADO e PR de projeto arquivado não contam; repositório sem projeto não conta', async () => {
  const ativo = await criarProjeto(admin, { nome: 'Projeto Ativo' })
  const arquivado = await criarProjeto(admin, { nome: 'Projeto Arquivado' })
  const um = await criarRepositorio('um', ativo.id)
  const dois = await criarRepositorio('dois', arquivado.id)
  await criarPr(um, { estado: 'MERGEADO', mergeadoNoGitHub: haHoras(25) })
  await criarPr(um, { estado: 'FECHADO' })
  await criarPr(um, { estado: 'MERGEADO', mergeadoNoGitHub: haHoras(1) })
  await criarPr(dois, { estado: 'MERGEADO', mergeadoNoGitHub: haHoras(1) })
  await criarPr(dois, { estado: 'ABERTO' })
  await db.projeto.update({ where: { id: arquivado.id }, data: { arquivadoEm: AGORA } })

  const comArquivado = await obterAtividade(admin, AGORA)
  expect(comArquivado.linhas.map((l) => [l.projeto.nome, l.mergeadosHoje, l.abertos])).toEqual([
    ['Projeto Ativo', 1, 0],
  ])
  expect(comArquivado.totalHoje).toBe(1)

  // Repositório desvinculado: os PRs dele não contam para ninguém.
  await db.repositorioGitHub.update({ where: { id: um }, data: { projetoId: null } })
  const semProjeto = await obterAtividade(admin, AGORA)
  expect(semProjeto.linhas).toEqual([])
  expect(semProjeto.totalHoje).toBe(0)
  expect(semProjeto.dadosDe).toBeNull()
})

test('repositório dois com ultimaFalhaEm depois de sincronizadoEm → linha desatualizado true, AtividadeGeral.desatualizado true, dadosDe = sincronizadoEm mais antigo', async () => {
  const projeto = await criarProjeto(admin, { nome: 'Projeto Atividade' })
  const um = await criarRepositorio('um', projeto.id, {
    sincronizadoEm: new Date(AGORA.getTime() - MINUTO),
  })
  await criarRepositorio('dois', projeto.id, {
    sincronizadoEm: new Date(AGORA.getTime() - 20 * MINUTO),
    ultimaFalhaEm: new Date(AGORA.getTime() - 5 * MINUTO),
  })
  await criarPr(um, { estado: 'MERGEADO', mergeadoNoGitHub: haHoras(1) })

  const atividade = await obterAtividade(admin, AGORA)

  expect(atividade.linhas).toHaveLength(1)
  expect(atividade.linhas[0]!.desatualizado).toBe(true)
  expect(atividade.desatualizado).toBe(true)
  expect(atividade.dadosDe).toEqual(new Date(AGORA.getTime() - 20 * MINUTO))

  const doProjeto = await obterAtividadeDoProjeto(admin, projeto.id, AGORA)
  expect(doProjeto.desatualizado).toBe(true)
  expect(doProjeto.dadosDe).toEqual(new Date(AGORA.getTime() - 20 * MINUTO))
})

test('nenhum PR → linhas [] e totalHoje 0', async () => {
  const projeto = await criarProjeto(admin, { nome: 'Projeto Vazio' })
  await criarRepositorio('um', projeto.id)

  const atividade = await obterAtividade(admin, AGORA)

  expect(atividade.linhas).toEqual([])
  expect(atividade.totalHoje).toBe(0)
  expect(atividade.desatualizado).toBe(false)
})

test('obterAtividadeDoProjeto: 12 merges → 10, do mais recente ao mais antigo, título de 130 caracteres cortado em 120, origem classificada, url = urlHtml', async () => {
  const projeto = await criarProjeto(admin, { nome: 'Projeto Atividade' })
  const outro = await criarProjeto(admin, { nome: 'Projeto Outro' })
  const um = await criarRepositorio('um', projeto.id)
  const dois = await criarRepositorio('dois', outro.id)
  for (let i = 1; i <= 12; i++) {
    await criarPr(um, {
      estado: 'MERGEADO',
      mergeadoNoGitHub: haHoras(i * 3),
      branch: i === 1 ? 'claude/primeiro' : `feat/${i}`,
      titulo: i === 1 ? 'a'.repeat(130) : `Merge ${i}`,
    })
  }
  await criarPr(um, { estado: 'ABERTO', autor: 'warren-forge[bot]' })
  await criarPr(dois, { estado: 'MERGEADO', mergeadoNoGitHub: haHoras(0.5) })

  const atividade = await obterAtividadeDoProjeto(admin, projeto.id, AGORA)

  // Janela de 24 h: merges há 3, 6, …, 24 h → 8 mergeados; mais 1 aberto.
  expect(atividade.mergeadosHoje).toBe(8)
  expect(atividade.abertos).toBe(1)
  expect(atividade.porOrigem).toEqual({ sessao: 1, fabrica: 1, outro: 7 })
  expect(atividade.desatualizado).toBe(false)

  expect(atividade.ultimosMerges).toHaveLength(10)
  expect(atividade.ultimosMerges.map((m) => m.mergeadoEm)).toEqual(
    Array.from({ length: 10 }, (_, i) => haHoras((i + 1) * 3)),
  )
  const primeiro = atividade.ultimosMerges[0]!
  expect(primeiro.titulo).toBe('a'.repeat(119) + '…')
  expect(primeiro.origem).toBe('sessao')
  expect(primeiro.numero).toBe(1)
  expect(primeiro.url).toBe('https://github.com/kustertech-exemplo/atividade/pull/1')
  expect(atividade.ultimosMerges[1]!.origem).toBe('outro')
})

test('TESTADOR escopado: obterAtividade e obterAtividadeDoProjeto lançam ErroDeAutorizacao', async () => {
  const projeto = await criarProjeto(admin, { nome: 'Projeto Atividade' })
  const findMany = vi.spyOn(db.pullRequestGitHub, 'findMany')

  await expect(obterAtividade(testadorEscopado, AGORA)).rejects.toBeInstanceOf(ErroDeAutorizacao)
  await expect(obterAtividadeDoProjeto(testadorEscopado, projeto.id, AGORA)).rejects.toBeInstanceOf(
    ErroDeAutorizacao,
  )
  expect(findMany).not.toHaveBeenCalled()
})

test('obterInicio para TESTADOR escopado → atividade null e pullRequestGitHub.findMany não é chamado (vi.spyOn)', async () => {
  const projeto = await criarProjeto(admin, { nome: 'Projeto Atividade' })
  const um = await criarRepositorio('um', projeto.id)
  await criarPr(um, { estado: 'MERGEADO', mergeadoNoGitHub: haHoras(1) })
  const findMany = vi.spyOn(db.pullRequestGitHub, 'findMany')

  const inicio = await obterInicio(testadorEscopado, AGORA)

  expect(inicio.atividade).toBeNull()
  expect(findMany).not.toHaveBeenCalled()
})

test('obterInicio para admin → atividade com a linha do projeto', async () => {
  const projeto = await criarProjeto(admin, { nome: 'Projeto Atividade' })
  const um = await criarRepositorio('um', projeto.id)
  await criarPr(um, { estado: 'MERGEADO', mergeadoNoGitHub: haHoras(1) })
  await criarPr(um, { estado: 'ABERTO' })

  const inicio = await obterInicio(admin, AGORA)

  expect(inicio.atividade).not.toBeNull()
  expect(inicio.atividade).not.toBe('falha')
  if (inicio.atividade === null || inicio.atividade === 'falha') return
  expect(inicio.atividade.linhas.map((l) => [l.projeto.id, l.mergeadosHoje, l.abertos])).toEqual([
    [projeto.id, 1, 1],
  ])
  expect(inicio.atividade.totalHoje).toBe(1)
})
