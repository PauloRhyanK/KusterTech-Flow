import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { sincronizarDeployments } from '@/modules/ambientes/deployments'
import { calcularPresencas } from '@/modules/ambientes/presencas'
import { ErroDeIntegracao } from '@/modules/github/erros'
import type { FonteGitHub } from '@/modules/github/fonte'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { limparBanco } from './banco-de-teste'

const t0 = new Date('2026-10-27T12:00:00.000Z')
const t1 = new Date('2026-10-27T12:05:00.000Z')
const t2 = new Date('2026-10-27T12:30:00.000Z')
const INTERVALO = 600_000

async function prepararPortal(comDeployments = true) {
  const fonte = criarFonteFixtures()
  await sincronizarCatalogo(fonte, t0)
  const projeto = await db.projeto.create({ data: { nome: 'Portal', nomeNormalizado: 'portal' } })
  const repo = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: 'kustertech-exemplo/portal' },
  })
  await db.repositorioGitHub.update({
    where: { id: repo.id },
    data: { projetoId: projeto.id, vinculadoEm: t0 },
  })
  await sincronizarRepositorio(fonte, repo.id, t0)
  await db.ambiente.createMany({
    data: [
      { projetoId: projeto.id, tipo: 'DEV', nomeNoGitHub: 'dev' },
      { projetoId: projeto.id, tipo: 'QA', nomeNoGitHub: 'qa' },
      { projetoId: projeto.id, tipo: 'PROD', nomeNoGitHub: 'production' },
    ],
  })
  if (comDeployments) {
    await sincronizarDeployments(fonte, t0, INTERVALO)
  }
  return { fonte, projeto, repo }
}

async function linhas() {
  const lista = await db.presencaIssueVersao.findMany({
    include: { issue: true, versao: true },
  })
  return lista.sort(
    (a, b) => a.issue.numero - b.issue.numero || a.versao.rotulo.localeCompare(b.versao.rotulo),
  )
}

function espiar(base: FonteGitHub, aoComparar?: () => Error | null) {
  const chamadas: [string, string][] = []
  const fonte: FonteGitHub = {
    ...base,
    compararCommits: async (repo, a, b) => {
      chamadas.push([a, b])
      const erro = aoComparar?.() ?? null
      if (erro) {
        throw erro
      }
      return base.compararCommits(repo, a, b)
    },
  }
  return { fonte, chamadas }
}

beforeEach(async () => {
  await limparBanco()
})

describe('calcular-presencas', () => {
  test('8 linhas para portal (issues 1–4 × v1.3.0 e v1.4.0): #2 em v1.4.0 PRESENCA_CONFIRMADA "Contém o merge do PR #5.", em v1.3.0 SEM_EVIDENCIA; #4 VERIFICACAO_NECESSARIA nas duas; #1 e #3 SEM_EVIDENCIA; nenhuma linha para 1ffffff (só FALHA)', async () => {
    const { fonte } = await prepararPortal()

    const resumo = await calcularPresencas(fonte, t0, INTERVALO)

    expect(resumo).toEqual({ repositorios: 1, calculadas: 8, falhas: 0 })
    const lista = await linhas()
    expect(lista).toHaveLength(8)
    const por = (numero: number, rotulo: string) =>
      lista.find((l) => l.issue.numero === numero && l.versao.rotulo === rotulo)!
    expect(por(2, 'v1.4.0').estado).toBe('PRESENCA_CONFIRMADA')
    expect(por(2, 'v1.4.0').motivo).toBe('Contém o merge do PR #5.')
    expect(por(2, 'v1.3.0').estado).toBe('SEM_EVIDENCIA')
    expect(por(4, 'v1.3.0').estado).toBe('VERIFICACAO_NECESSARIA')
    expect(por(4, 'v1.4.0').estado).toBe('VERIFICACAO_NECESSARIA')
    for (const n of [1, 3]) {
      expect(por(n, 'v1.3.0').estado).toBe('SEM_EVIDENCIA')
      expect(por(n, 'v1.4.0').estado).toBe('SEM_EVIDENCIA')
    }
    expect(lista.some((l) => l.versao.rotulo === '1ffffff')).toBe(false)
    expect(lista.every((l) => l.calculadaEm.getTime() === t0.getTime())).toBe(true)
  })

  test('segunda execução sem mudança: fonte espiã registra 0 chamadas a compararCommits e calculadaEm não muda', async () => {
    const { fonte } = await prepararPortal()
    await calcularPresencas(fonte, t0, INTERVALO)
    const { fonte: espia, chamadas } = espiar(fonte)

    const resumo = await calcularPresencas(espia, t1, INTERVALO)

    expect(chamadas).toHaveLength(0)
    expect(resumo.calculadas).toBe(0)
    expect((await linhas()).every((l) => l.calculadaEm.getTime() === t0.getTime())).toBe(true)
  })

  test('linha de #4 com confirmadaPorId e CONFIRMACAO_MANUAL não é sobrescrita', async () => {
    const { fonte } = await prepararPortal()
    await calcularPresencas(fonte, t0, INTERVALO)
    const autor = await db.usuario.create({
      data: { nome: 'Admin', email: 'admin@exemplo.test', senhaHash: 'x' },
    })
    const alvo = (await linhas()).find((l) => l.issue.numero === 4 && l.versao.rotulo === 'v1.4.0')!
    await db.presencaIssueVersao.update({
      where: { issueId_versaoId: { issueId: alvo.issueId, versaoId: alvo.versaoId } },
      data: {
        estado: 'CONFIRMACAO_MANUAL',
        motivo: 'Presença confirmada manualmente.',
        confirmadaPorId: autor.id,
      },
    })

    await calcularPresencas(fonte, t2, INTERVALO)

    const depois = (await linhas()).find(
      (l) => l.issue.numero === 4 && l.versao.rotulo === 'v1.4.0',
    )!
    expect(depois.estado).toBe('CONFIRMACAO_MANUAL')
    expect(depois.confirmadaPorId).toBe(autor.id)
    expect(depois.calculadaEm).toEqual(t0)
  })

  test('compararCommits lançando "limite": nenhuma linha de portal muda e o resultado é falha; lançando "commit-desconhecido": #2 em v1.4.0 VERIFICACAO_NECESSARIA "Não foi possível comparar o PR #5 com a versão."', async () => {
    const { fonte } = await prepararPortal()
    const { fonte: limite } = espiar(fonte, () => new ErroDeIntegracao('limite'))

    const resumo = await calcularPresencas(limite, t0, INTERVALO)

    expect(resumo).toEqual({ repositorios: 1, calculadas: 0, falhas: 1 })
    expect(await db.presencaIssueVersao.count()).toBe(0)

    const { fonte: desconhecido } = espiar(fonte, () => new ErroDeIntegracao('commit-desconhecido'))
    await calcularPresencas(desconhecido, t0, INTERVALO)
    const dois = (await linhas()).find((l) => l.issue.numero === 2 && l.versao.rotulo === 'v1.4.0')!
    expect(dois.estado).toBe('VERIFICACAO_NECESSARIA')
    expect(dois.motivo).toBe('Não foi possível comparar o PR #5 com a versão.')
  })

  test('limite numa recalculação: as linhas anteriores do repositório ficam intactas', async () => {
    const { fonte } = await prepararPortal()
    await calcularPresencas(fonte, t0, INTERVALO)
    const antes = await linhas()
    const { fonte: limite } = espiar(fonte, () => new ErroDeIntegracao('limite'))
    await db.pullRequestGitHub.updateMany({
      where: { numero: 5 },
      data: { shaMerge: 'a'.repeat(40) },
    })

    const resumo = await calcularPresencas(limite, t2, INTERVALO)

    expect(resumo.falhas).toBe(1)
    expect(await linhas()).toEqual(antes)
  })

  test('fonte nula: #2 em v1.4.0 VERIFICACAO_NECESSARIA; #1 SEM_EVIDENCIA', async () => {
    await prepararPortal()

    await calcularPresencas(null, t0, INTERVALO)

    const lista = await linhas()
    const dois = lista.find((l) => l.issue.numero === 2 && l.versao.rotulo === 'v1.4.0')!
    expect(dois.estado).toBe('VERIFICACAO_NECESSARIA')
    expect(lista.find((l) => l.issue.numero === 1 && l.versao.rotulo === 'v1.4.0')!.estado).toBe(
      'SEM_EVIDENCIA',
    )
  })
})
