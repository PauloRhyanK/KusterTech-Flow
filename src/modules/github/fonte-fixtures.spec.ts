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
})
