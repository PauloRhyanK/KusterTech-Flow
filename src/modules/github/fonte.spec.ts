import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { ErroDeIntegracao } from './erros'
import {
  mapearCheck,
  mapearComparacao,
  mapearDeployment,
  mapearIssue,
  mapearPullRequest,
  mapearRepositorio,
  obterFonteGitHub,
} from './fonte'

const usuario = { login: 'exemplo-ana', id: 1 }

const issueBruta = (parcial: Record<string, unknown> = {}) => ({
  id: 7001,
  number: 3,
  title: 'Título',
  body: null,
  state: 'closed',
  user: usuario,
  assignees: [{ login: 'exemplo-bia', id: 2 }],
  labels: [{ id: 1, name: 'bug' }],
  html_url: 'https://github.com/kustertech-exemplo/portal/issues/3',
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-02T10:00:00Z',
  closed_at: '2026-10-02T10:00:00Z',
  ...parcial,
})

const prBruto = (parcial: Record<string, unknown> = {}) => ({
  id: 8001,
  number: 9,
  title: 'PR',
  body: 'Fixes #7',
  state: 'closed',
  draft: false,
  user: usuario,
  html_url: 'https://github.com/kustertech-exemplo/portal/pull/9',
  head: { ref: 'feature/x', sha: 'a'.repeat(40) },
  updated_at: '2026-10-03T10:00:00Z',
  merged_at: '2026-10-03T10:00:00Z',
  ...parcial,
})

describe('mapearPullRequest: corpo e criadoEm', () => {
  test('mapearPullRequest preenche corpo e criadoEm; sem created_at → criadoEm null', () => {
    const pr = mapearPullRequest(prBruto({ created_at: '2026-10-03T09:00:00Z' }))
    expect(pr.corpo).toBe('Fixes #7')
    expect(pr.criadoEm).toEqual(new Date('2026-10-03T09:00:00Z'))
    const sem = mapearPullRequest(prBruto({ body: null }))
    expect(sem.corpo).toBeNull()
    expect(sem.criadoEm).toBeNull()
  })
})

describe('mapearIssue', () => {
  test('devolve null para item com pull_request; converte state closed em FECHADA e datas em Date', () => {
    expect(mapearIssue(issueBruta({ pull_request: { url: 'x' } }))).toBeNull()
    const issue = mapearIssue(issueBruta())
    expect(issue).toMatchObject({
      githubId: BigInt(7001),
      numero: 3,
      estado: 'FECHADA',
      autor: 'exemplo-ana',
      responsaveis: ['exemplo-bia'],
      rotulos: ['bug'],
    })
    expect(issue?.criadaEm).toEqual(new Date('2026-10-01T10:00:00Z'))
    expect(issue?.fechadaEm).toEqual(new Date('2026-10-02T10:00:00Z'))
    expect(mapearIssue(issueBruta({ state: 'open', closed_at: null }))?.estado).toBe('ABERTA')
  })

  test('payload sem number lança resposta-invalida sem repetir o payload na mensagem', () => {
    const semNumero: Record<string, unknown> = issueBruta({ title: 'SEGREDO-NO-PAYLOAD' })
    delete semNumero.number
    try {
      mapearIssue(semNumero)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ErroDeIntegracao)
      expect((e as ErroDeIntegracao).categoria).toBe('resposta-invalida')
      expect((e as Error).message).not.toContain('SEGREDO-NO-PAYLOAD')
    }
  })
})

describe('mapearPullRequest', () => {
  test('merged_at preenchido → MERGEADO; corpo "Fixes #7" → issuesReferenciadas [7]', () => {
    const pr = mapearPullRequest(prBruto())
    expect(pr.estado).toBe('MERGEADO')
    expect(pr.issuesReferenciadas).toEqual([7])
    expect(pr.shaHead).toBe('a'.repeat(40))
    expect(pr.branch).toBe('feature/x')
    expect(pr.mergeadoEm).toEqual(new Date('2026-10-03T10:00:00Z'))
  })

  test('mapearPullRequest: merged_at + merge_commit_sha → shaMerge = sha; aberto com merge_commit_sha preenchido → shaMerge null', () => {
    const sha = 'c'.repeat(40)
    expect(mapearPullRequest(prBruto({ merge_commit_sha: sha })).shaMerge).toBe(sha)
    expect(mapearPullRequest(prBruto()).shaMerge).toBeNull()
    expect(
      mapearPullRequest(prBruto({ state: 'open', merged_at: null, merge_commit_sha: sha }))
        .shaMerge,
    ).toBeNull()
  })

  test('aberto e fechado sem merge', () => {
    expect(mapearPullRequest(prBruto({ state: 'open', merged_at: null })).estado).toBe('ABERTO')
    expect(mapearPullRequest(prBruto({ merged_at: null })).estado).toBe('FECHADO')
  })
})

describe('mapearRepositorio e mapearCheck', () => {
  test('repositório e check', () => {
    const repo = mapearRepositorio(
      {
        id: 5001,
        full_name: 'kustertech-exemplo/portal',
        html_url: 'https://github.com/kustertech-exemplo/portal',
        private: true,
        archived: false,
      },
      BigInt(900001),
    )
    expect(repo).toMatchObject({
      githubId: BigInt(5001),
      instalacaoId: BigInt(900001),
      privado: true,
    })
    expect(mapearCheck({ status: 'completed', conclusion: 'failure' })).toEqual({
      status: 'completed',
      conclusao: 'failure',
    })
    expect(mapearCheck({ status: 'in_progress', conclusion: null }).conclusao).toBeNull()
  })

  test('formato inesperado → resposta-invalida', () => {
    expect(() => mapearCheck({})).toThrow(ErroDeIntegracao)
    expect(() => mapearRepositorio('x', BigInt(1))).toThrow(ErroDeIntegracao)
  })
})

describe('obterFonteGitHub', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })

  test('fixtures; app sem chave → null; chave com \\n literal é aceita', () => {
    expect(obterFonteGitHub({ GITHUB_FONTE: 'fixtures' })?.tipo).toBe('fixtures')
    expect(obterFonteGitHub({ GITHUB_FONTE: 'app', GITHUB_APP_ID: '1' })).toBeNull()
    expect(obterFonteGitHub({})).toBeNull()
    const comLiteral = privateKey.trim().replaceAll('\n', '\\n')
    const fonte = obterFonteGitHub({
      GITHUB_APP_ID: '1',
      GITHUB_APP_PRIVATE_KEY: comLiteral,
    })
    expect(fonte?.tipo).toBe('app')
  })

  test('GITHUB_FONTE vazia (como o Compose repassa) equivale a ausente', () => {
    const fonte = obterFonteGitHub({
      GITHUB_FONTE: '',
      GITHUB_APP_ID: '1',
      GITHUB_APP_PRIVATE_KEY: privateKey,
    })
    expect(fonte?.tipo).toBe('app')
    expect(obterFonteGitHub({ GITHUB_FONTE: '' })).toBeNull()
  })
})

describe('mapearDeployment e mapearComparacao', () => {
  const deploymentBruto = {
    id: 6000003,
    sha: 'e'.repeat(40),
    ref: 'v1.4.0',
    environment: 'qa',
    created_at: '2026-10-16T12:00:00Z',
  }

  test('mapearDeployment: environment "qa", ref, sha, criadoEm Date; status success com id e criadoEm; sem status → status null', () => {
    const d = mapearDeployment(deploymentBruto, {
      id: 5000003,
      state: 'success',
      created_at: '2026-10-16T12:05:00Z',
    })
    expect(d).toEqual({
      githubId: BigInt(6000003),
      sha: 'e'.repeat(40),
      ref: 'v1.4.0',
      ambiente: 'qa',
      criadoEm: new Date('2026-10-16T12:00:00Z'),
      status: {
        githubId: BigInt(5000003),
        estado: 'success',
        criadoEm: new Date('2026-10-16T12:05:00Z'),
      },
    })
    expect(mapearDeployment(deploymentBruto, null).status).toBeNull()
  })

  test('mapearComparacao: total_commits 3 com 2 commits → truncada true; status "unknown" → ErroDeIntegracao resposta-invalida', () => {
    const c = mapearComparacao({
      status: 'ahead',
      total_commits: 3,
      commits: [{ sha: 'a'.repeat(40) }, { sha: 'b'.repeat(40) }],
    })
    expect(c).toEqual({
      status: 'ahead',
      commits: ['a'.repeat(40), 'b'.repeat(40)],
      truncada: true,
    })
    expect(
      mapearComparacao({ status: 'ahead', total_commits: 1, commits: [{ sha: 'a' }] }).truncada,
    ).toBe(false)
    expect(() => mapearComparacao({ status: 'unknown', total_commits: 0, commits: [] })).toThrow(
      expect.objectContaining({ categoria: 'resposta-invalida' }),
    )
  })
})
