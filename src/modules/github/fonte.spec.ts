import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { ErroDeIntegracao } from './erros'
import {
  mapearCheck,
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
})
