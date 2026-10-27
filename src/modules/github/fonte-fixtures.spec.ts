import { describe, expect, test } from 'vitest'
import { criarFonteFixtures } from './fonte-fixtures'
import { resumirChecks } from './model'

describe('fonte de fixtures', () => {
  const fonte = criarFonteFixtures()

  test('quatro repositórios; issues do portal sem PRs; desde no futuro devolve []', async () => {
    const repos = await fonte.listarRepositorios()
    expect(repos.map((r) => r.nomeCompleto)).toEqual([
      'kustertech-exemplo/portal',
      'kustertech-exemplo/api',
      'kustertech-exemplo/site',
      'kustertech-exemplo/app-mobile',
    ])
    expect(new Set(repos.map((r) => r.githubId)).size).toBe(4)
    const portal = repos[0]!
    const issues = await fonte.listarIssuesAtualizadas(portal, null)
    expect(issues).toHaveLength(4)
    expect(issues.filter((i) => i.estado === 'ABERTA')).toHaveLength(3)
    expect(await fonte.listarIssuesAtualizadas(portal, new Date('2030-01-01T00:00:00Z'))).toEqual(
      [],
    )
  })

  test('githubId de issues e PRs é único entre repositórios; PRs e checks coerentes', async () => {
    const repos = await fonte.listarRepositorios()
    const ids = new Set<bigint>()
    for (const repo of repos) {
      for (const i of await fonte.listarIssuesAtualizadas(repo, null)) ids.add(i.githubId)
      const prs = await fonte.listarPullRequestsAtualizados(repo, null)
      for (const p of prs) ids.add(p.githubId)
      expect(prs.map((p) => p.estado).sort()).toEqual(['ABERTO', 'MERGEADO'])
      const resumos = await Promise.all(
        prs.map(async (p) => resumirChecks(await fonte.listarChecks(repo, p.shaHead))),
      )
      expect(resumos.sort()).toEqual(['FALHA', 'SUCESSO'])
      expect(prs.find((p) => p.estado === 'MERGEADO')?.issuesReferenciadas).toEqual([2])
    }
    expect(ids.size).toBe(4 * (4 + 2))
  })

  test('sha desconhecido → sem checks', async () => {
    const [repo] = await fonte.listarRepositorios()
    expect(await fonte.listarChecks(repo!, 'f'.repeat(40))).toEqual([])
  })

  test('listarDeployments: 5 por repositório; desde 2026-10-16T11:00:00Z → 3; compararCommits(portal, M, V1/V2/V3) → behind/ahead/diverged; par desconhecido → commit-desconhecido', async () => {
    const repos = await fonte.listarRepositorios()
    for (const repo of repos) {
      expect(await fonte.listarDeployments(repo, null)).toHaveLength(5)
      expect(await fonte.listarDeployments(repo, new Date('2026-10-16T11:00:00Z'))).toHaveLength(3)
    }
    const portal = repos[0]!
    const M = '1' + 'c'.repeat(39)
    const [V1, V2, V3] = ['d', 'e', 'f'].map((c) => '1' + c.repeat(39)) as [string, string, string]
    expect((await fonte.compararCommits(portal, M, V1)).status).toBe('behind')
    expect(await fonte.compararCommits(portal, M, V2)).toEqual({
      status: 'ahead',
      commits: [V2],
      truncada: false,
    })
    expect((await fonte.compararCommits(portal, M, V3)).status).toBe('diverged')
    await expect(fonte.compararCommits(portal, M, '9'.repeat(40))).rejects.toMatchObject({
      categoria: 'commit-desconhecido',
    })
    expect(await fonte.compararCommits(portal, V2, V2)).toEqual({
      status: 'identical',
      commits: [],
      truncada: false,
    })
  })

  test('deployments: o status mais recente de cada um; k=3 tem success (não o in_progress)', async () => {
    const [portal] = await fonte.listarRepositorios()
    const itens = await fonte.listarDeployments(portal!, null)
    expect(itens.map((d) => d.status?.estado)).toEqual([
      'success',
      'failure',
      'success',
      'success',
      'success',
    ])
  })

  test('PR #5 dos quatro repositórios tem shaMerge n+"c"×39; PR #6 tem null', async () => {
    const repos = await fonte.listarRepositorios()
    for (const [i, repo] of repos.entries()) {
      const prs = await fonte.listarPullRequestsAtualizados(repo, null)
      expect(prs.find((p) => p.numero === 5)?.shaMerge).toBe(String(i + 1) + 'c'.repeat(39))
      expect(prs.find((p) => p.numero === 6)?.shaMerge).toBeNull()
    }
  })
})
