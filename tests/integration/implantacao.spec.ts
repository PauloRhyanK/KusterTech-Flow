import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { sincronizarDeployments } from '@/modules/ambientes/deployments'
import { implantacaoDasIssues } from '@/modules/ambientes/implantacao'
import { calcularPresencas } from '@/modules/ambientes/presencas'
import { listarPresencaEmQA, obterImplantacaoDaIssue } from '@/modules/ambientes/queries'
import { confirmarPresencaManual } from '@/modules/ambientes/service'
import { criarCliente } from '@/modules/clientes/service'
import { adicionarIssuesAMilestone, criarMilestone } from '@/modules/entregas/service'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { criarProjeto } from '@/modules/projetos/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const t0 = new Date('2026-10-27T12:00:00.000Z')
const t1 = new Date('2026-10-27T12:30:00.000Z')
const INTERVALO = 600_000
const SHA_V1 = `1${'d'.repeat(39)}`
const SHA_V2 = `1${'e'.repeat(39)}`

let admin: Sujeito
let testadorDeAcme: Sujeito
let testadorDeBeta: Sujeito
let clienteAcme: string
let clienteBeta: string
let projetoId: string
let repoPortal: string
let issue2: string
let issue3: string
let issue4: string

async function issueId(numero: number) {
  return (
    await db.issueGitHub.findUniqueOrThrow({
      where: { repositorioId_numero: { repositorioId: repoPortal, numero } },
    })
  ).id
}

async function prepararAmbientes(dev: string | null = 'dev') {
  await db.ambiente.createMany({
    data: [
      { projetoId, tipo: 'DEV', nomeNoGitHub: dev },
      { projetoId, tipo: 'QA', nomeNoGitHub: 'qa' },
      { projetoId, tipo: 'PROD', nomeNoGitHub: 'production' },
    ],
  })
  await sincronizarDeployments(criarFonteFixtures(), t0, INTERVALO)
  await calcularPresencas(criarFonteFixtures(), t0, INTERVALO)
}

async function versaoVigente(sha: string) {
  return db.versao.findFirstOrThrow({ where: { repositorioId: repoPortal, commitSha: sha } })
}

const global = { tipo: 'global' } as const
const contextoAcme = () => ({ tipo: 'cliente', clienteId: clienteAcme }) as const

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-impl@local.test',
    nome: 'Admin Impl',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  clienteAcme = (await criarCliente(admin, { nome: 'Acme' })).id
  clienteBeta = (await criarCliente(admin, { nome: 'Beta' })).id
  const ta = await criarUsuario({
    email: 'testador-acme-impl@local.test',
    nome: 'Testador Acme',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'TESTADOR', clienteId: clienteAcme }],
  })
  testadorDeAcme = { usuarioId: ta.id, papeis: [{ papel: 'TESTADOR', clienteId: clienteAcme }] }
  const tb = await criarUsuario({
    email: 'testador-beta-impl@local.test',
    nome: 'Testador Beta',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'TESTADOR', clienteId: clienteBeta }],
  })
  testadorDeBeta = { usuarioId: tb.id, papeis: [{ papel: 'TESTADOR', clienteId: clienteBeta }] }

  projetoId = (
    await criarProjeto(admin, { nome: 'Projeto Impl', clientesIds: [clienteAcme, clienteBeta] })
  ).id
  const fonte = criarFonteFixtures()
  await sincronizarCatalogo(fonte, t0)
  const repo = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: 'kustertech-exemplo/portal' },
  })
  await db.repositorioGitHub.update({
    where: { id: repo.id },
    data: { projetoId, vinculadoEm: t0 },
  })
  await sincronizarRepositorio(fonte, repo.id, t0)
  repoPortal = repo.id
  issue2 = await issueId(2)
  issue3 = await issueId(3)
  issue4 = await issueId(4)

  const mAcme = await criarMilestone(admin, projetoId, {
    titulo: 'M-Acme',
    clientesIds: [clienteAcme],
  })
  const mBeta = await criarMilestone(admin, projetoId, {
    titulo: 'M-Beta',
    clientesIds: [clienteBeta],
  })
  await adicionarIssuesAMilestone(admin, mAcme.id, [issue2, issue4])
  await adicionarIssuesAMilestone(admin, mBeta.id, [issue3])
})

afterAll(async () => {
  await db.$disconnect()
})

describe('presença por ambiente (integração)', () => {
  test('obterImplantacaoDaIssue com fixtures (portal; dev/qa/production; worker rodado): #2 → DEV e QA PRESENCA_CONFIRMADA v1.4.0, PROD SEM_EVIDENCIA v1.3.0 "Não contém o merge do PR #5."; #4 → VERIFICACAO_NECESSARIA nos três', async () => {
    await prepararAmbientes()

    const i2 = await obterImplantacaoDaIssue(admin, projetoId, issue2, global)
    expect(i2.nenhumConfigurado).toBe(false)
    expect(i2.podeConfirmar).toBe(true)
    expect(i2.ambientes.map((a) => a.tipo)).toEqual(['DEV', 'QA', 'PROD'])
    const [dev, qa, prod] = i2.ambientes
    expect(dev?.estado).toBe('PRESENCA_CONFIRMADA')
    expect(dev?.versao?.rotulo).toBe('v1.4.0')
    expect(qa?.estado).toBe('PRESENCA_CONFIRMADA')
    expect(qa?.versao?.rotulo).toBe('v1.4.0')
    expect(qa?.commitCurto).toBe('1eeeeee')
    expect(prod?.estado).toBe('SEM_EVIDENCIA')
    expect(prod?.versao?.rotulo).toBe('v1.3.0')
    expect(prod?.motivo).toBe('Não contém o merge do PR #5.')

    const i4 = await obterImplantacaoDaIssue(admin, projetoId, issue4, global)
    expect(i4.ambientes.map((a) => a.estado)).toEqual([
      'VERIFICACAO_NECESSARIA',
      'VERIFICACAO_NECESSARIA',
      'VERIFICACAO_NECESSARIA',
    ])
  })

  test('sem ambientes: nenhumConfigurado true e todos os ambientes não configurados', async () => {
    const i2 = await obterImplantacaoDaIssue(admin, projetoId, issue2, global)
    expect(i2.nenhumConfigurado).toBe(true)
    expect(i2.ambientes.every((a) => !a.configurado)).toBe(true)
  })

  test('evidência MANUAL de V2 em DEV sem nome no GitHub: #2 em DEV → CONFIRMACAO_MANUAL; evidência ENDPOINT da mesma versão depois → PRESENCA_CONFIRMADA', async () => {
    await prepararAmbientes(null)
    const semDev = await implantacaoDasIssues(projetoId, [issue2], 'DEV')
    expect(semDev.get(issue2)?.estado).toBe('SEM_EVIDENCIA')

    const versao = await versaoVigente(SHA_V2)
    const dev = await db.ambiente.findUniqueOrThrow({
      where: { projetoId_tipo: { projetoId, tipo: 'DEV' } },
    })
    await db.evidenciaDeploy.create({
      data: {
        ambienteId: dev.id,
        versaoId: versao.id,
        origem: 'MANUAL',
        situacao: 'SUCESSO',
        ocorridaEm: t0,
        registradaEm: t0,
        autorId: admin.usuarioId,
        detalhe: 'Registro manual',
      },
    })
    await calcularPresencas(criarFonteFixtures(), t1, INTERVALO)

    const manual = await implantacaoDasIssues(projetoId, [issue2], 'DEV')
    expect(manual.get(issue2)?.estado).toBe('CONFIRMACAO_MANUAL')
    expect(manual.get(issue2)?.autorDoDeploy).toBe('Admin Impl')

    await db.evidenciaDeploy.create({
      data: {
        ambienteId: dev.id,
        versaoId: versao.id,
        origem: 'ENDPOINT',
        situacao: 'SUCESSO',
        ocorridaEm: new Date(t0.getTime() + 1000),
        registradaEm: t1,
        idExterno: 'x:1',
      },
    })
    const automatica = await implantacaoDasIssues(projetoId, [issue2], 'DEV')
    expect(automatica.get(issue2)?.estado).toBe('PRESENCA_CONFIRMADA')
  })

  test('confirmarPresencaManual de #4 em QA: CONFIRMACAO_MANUAL com confirmadaPorId; repetir → "Esta issue não precisa de confirmação manual nesta versão."; #2 (confirmada) → mesma mensagem; nova evidência SUCESSO de V1 em QA antes de confirmar → "A versão em QA mudou desde que a página foi aberta. Confira de novo."', async () => {
    await prepararAmbientes()
    const v2 = await versaoVigente(SHA_V2)
    const v1 = await versaoVigente(SHA_V1)
    const dados = { issueId: issue4, versaoId: v2.id, tipo: 'QA' as const }

    await confirmarPresencaManual(admin, projetoId, dados, t1)

    const linha = await db.presencaIssueVersao.findUniqueOrThrow({
      where: { issueId_versaoId: { issueId: issue4, versaoId: v2.id } },
    })
    expect(linha.estado).toBe('CONFIRMACAO_MANUAL')
    expect(linha.motivo).toBe('Presença confirmada manualmente.')
    expect(linha.confirmadaPorId).toBe(admin.usuarioId)
    expect(linha.calculadaEm).toEqual(t1)

    const tela = await obterImplantacaoDaIssue(admin, projetoId, issue4, global)
    const qa = tela.ambientes.find((a) => a.tipo === 'QA')
    expect(qa?.estado).toBe('CONFIRMACAO_MANUAL')
    expect(qa?.confirmadaPor).toEqual({ nome: 'Admin Impl', em: t1 })

    const semNecessidade = 'Esta issue não precisa de confirmação manual nesta versão.'
    await expect(confirmarPresencaManual(admin, projetoId, dados, t1)).rejects.toThrow(
      semNecessidade,
    )
    await expect(
      confirmarPresencaManual(admin, projetoId, { ...dados, issueId: issue2 }, t1),
    ).rejects.toThrow(semNecessidade)

    const qaAmbiente = await db.ambiente.findUniqueOrThrow({
      where: { projetoId_tipo: { projetoId, tipo: 'QA' } },
    })
    await db.evidenciaDeploy.create({
      data: {
        ambienteId: qaAmbiente.id,
        versaoId: v1.id,
        origem: 'ENDPOINT',
        situacao: 'SUCESSO',
        ocorridaEm: new Date('2026-11-01T00:00:00Z'),
        registradaEm: t1,
        idExterno: 'x:v1',
      },
    })
    await expect(
      confirmarPresencaManual(admin, projetoId, { ...dados, issueId: issue2 }, t1),
    ).rejects.toThrow('A versão em QA mudou desde que a página foi aberta. Confira de novo.')
  })

  test('contexto de cliente: TESTADOR de Acme lê #2 de milestone associada a Acme sem commitCurto nem origem; issue de milestone só de Beta → "Issue não encontrada."; TESTADOR de Beta no contexto de Acme → ErroDeAutorizacao; confirmarPresencaManual por TESTADOR → ErroDeAutorizacao e linha intacta', async () => {
    await prepararAmbientes()

    const lida = await obterImplantacaoDaIssue(testadorDeAcme, projetoId, issue2, contextoAcme())
    expect(lida.podeConfirmar).toBe(false)
    expect(lida.leituras).toEqual([])
    const qa = lida.ambientes.find((a) => a.tipo === 'QA')
    expect(qa?.estado).toBe('PRESENCA_CONFIRMADA')
    expect(qa?.versao?.rotulo).toBe('v1.4.0')
    for (const ambiente of lida.ambientes) {
      expect(ambiente.commitCurto).toBeNull()
      expect(ambiente.origem).toBeNull()
      expect(ambiente.autorDoDeploy).toBeNull()
    }

    await expect(
      obterImplantacaoDaIssue(testadorDeAcme, projetoId, issue3, contextoAcme()),
    ).rejects.toThrow('Issue não encontrada.')
    await expect(
      obterImplantacaoDaIssue(testadorDeBeta, projetoId, issue2, contextoAcme()),
    ).rejects.toThrow(ErroDeAutorizacao)

    const v2 = await versaoVigente(SHA_V2)
    await expect(
      confirmarPresencaManual(
        testadorDeAcme,
        projetoId,
        { issueId: issue4, versaoId: v2.id, tipo: 'QA' },
        t1,
      ),
    ).rejects.toThrow(ErroDeAutorizacao)
    const linha = await db.presencaIssueVersao.findUniqueOrThrow({
      where: { issueId_versaoId: { issueId: issue4, versaoId: v2.id } },
    })
    expect(linha.estado).toBe('VERIFICACAO_NECESSARIA')
    expect(linha.confirmadaPorId).toBeNull()
  })

  test('listarPresencaEmQA devolve só ids das milestones do cliente no contexto de cliente', async () => {
    await prepararAmbientes()
    const ids = [issue2, issue3, issue4]

    const doCliente = await listarPresencaEmQA(testadorDeAcme, projetoId, ids, contextoAcme())
    expect([...doCliente.keys()].sort()).toEqual([issue2, issue4].sort())
    expect(doCliente.get(issue2)?.estado).toBe('PRESENCA_CONFIRMADA')
    expect(doCliente.get(issue4)?.estado).toBe('VERIFICACAO_NECESSARIA')
    expect(doCliente.get(issue2)?.commitCurto).toBeNull()

    const globais = await listarPresencaEmQA(admin, projetoId, ids, global)
    expect([...globais.keys()].sort()).toEqual([...ids].sort())
    expect(globais.get(issue2)?.commitCurto).toBe('1eeeeee')
  })
})
