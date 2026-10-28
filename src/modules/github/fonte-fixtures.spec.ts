import { describe, expect, test } from 'vitest'
import { criarFonteFixtures } from './fonte-fixtures'
import { resumirChecks } from './model'

describe('fonte de fixtures', () => {
  const fonte = criarFonteFixtures()

  test('seis repositórios; issues do portal sem PRs; desde no futuro devolve []', async () => {
    const repos = await fonte.listarRepositorios()
    expect(repos.map((r) => r.nomeCompleto)).toEqual([
      'kustertech-exemplo/portal',
      'kustertech-exemplo/api',
      'kustertech-exemplo/site',
      'kustertech-exemplo/app-mobile',
      'kustertech-exemplo/automacao',
      'kustertech-exemplo/automacao-mobile',
    ])
    expect(new Set(repos.map((r) => r.githubId)).size).toBe(6)
    const portal = repos[0]!
    const issues = await fonte.listarIssuesAtualizadas(portal, null)
    expect(issues).toHaveLength(4)
    expect(issues.filter((i) => i.estado === 'ABERTA')).toHaveLength(3)
    expect(await fonte.listarIssuesAtualizadas(portal, new Date('2030-01-01T00:00:00Z'))).toEqual(
      [],
    )
  })

  test('githubId de issues e PRs é único entre repositórios; PRs e checks coerentes', async () => {
    const repos = (await fonte.listarRepositorios()).slice(0, 4)
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

  test('automacao: lerArquivo(".seeds/issues.jsonl") tem 6 linhas não vazias e plans.jsonl 1; portal → null; repositório desconhecido → sem-acesso', async () => {
    const repos = await fonte.listarRepositorios()
    const linhas = (t: string | null) => (t ?? '').split('\n').filter((l) => l.trim() !== '')
    for (const nome of ['automacao', 'automacao-mobile']) {
      const repo = repos.find((r) => r.nomeCompleto === `kustertech-exemplo/${nome}`)!
      expect(linhas(await fonte.lerArquivo(repo, '.seeds/issues.jsonl'))).toHaveLength(6)
      expect(linhas(await fonte.lerArquivo(repo, '.seeds/plans.jsonl'))).toHaveLength(1)
      expect(await fonte.lerArquivo(repo, '.seeds/inexistente.jsonl')).toBeNull()
    }
    expect(await fonte.lerArquivo(repos[0]!, '.seeds/issues.jsonl')).toBeNull()
    await expect(
      fonte.lerArquivo(
        { githubId: BigInt(1), instalacaoId: BigInt(1), nomeCompleto: 'outro/desconhecido' },
        '.seeds/issues.jsonl',
      ),
    ).rejects.toMatchObject({ categoria: 'sem-acesso' })
  })

  test('automacao e automacao-mobile: 2 issues (1 aberta) e 3 PRs cada; PR #3 autor warren-forge-exemplo[bot] e issuesReferenciadas [1]; checks #3 FALHA, #4 SUCESSO, #5 SEM_CHECKS; githubIds únicos nos 6 repositórios (24 + 10 = 34)', async () => {
    const repos = await fonte.listarRepositorios()
    const ids = new Set<bigint>()
    let total = 0
    for (const repo of repos) {
      const issues = await fonte.listarIssuesAtualizadas(repo, null)
      const prs = await fonte.listarPullRequestsAtualizados(repo, null)
      for (const i of issues) ids.add(i.githubId)
      for (const p of prs) ids.add(p.githubId)
      total += issues.length + prs.length
    }
    expect(ids.size).toBe(34)
    expect(total).toBe(34)

    for (const [nome, prefixo, runs] of [
      ['automacao', '5', ['run_exemplo0001', 'run_exemplo0002', 'run_exemplo0009']],
      ['automacao-mobile', '6', ['run_exemplo1001', 'run_exemplo1002', 'run_exemplo1009']],
    ] as const) {
      const repo = repos.find((r) => r.nomeCompleto === `kustertech-exemplo/${nome}`)!
      const issues = await fonte.listarIssuesAtualizadas(repo, null)
      expect(issues).toHaveLength(2)
      expect(issues.filter((i) => i.estado === 'ABERTA')).toHaveLength(1)
      const prs = (await fonte.listarPullRequestsAtualizados(repo, null)).sort(
        (a, b) => a.numero - b.numero,
      )
      expect(prs.map((p) => p.numero)).toEqual([3, 4, 5])
      expect(prs.map((p) => p.branch)).toEqual(runs.map((r) => `warren/${r}`))
      expect(prs[0]).toMatchObject({
        autor: 'warren-forge-exemplo[bot]',
        issuesReferenciadas: [issues.find((i) => i.estado === 'ABERTA')!.numero],
        estado: 'ABERTO',
        shaHead: prefixo + 'a'.repeat(39),
      })
      expect(prs[0]!.corpo).toContain('## Prompt')
      expect(prs[1]).toMatchObject({ estado: 'MERGEADO', shaHead: prefixo + 'b'.repeat(39) })
      expect(prs[2]).toMatchObject({ autor: 'exemplo-bia', estado: 'ABERTO' })
      const resumos = await Promise.all(
        prs.map(async (p) => resumirChecks(await fonte.listarChecks(repo, p.shaHead))),
      )
      expect(resumos).toEqual(['FALHA', 'SUCESSO', 'SEM_CHECKS'])
      expect(prs.every((p) => p.criadoEm instanceof Date)).toBe(true)
    }
  })

  test('automacao e automacao-mobile: listarDeployments → [] e compararCommits → commit-desconhecido', async () => {
    const repos = await fonte.listarRepositorios()
    for (const repo of repos.slice(4)) {
      expect(await fonte.listarDeployments(repo, null)).toEqual([])
      await expect(
        fonte.compararCommits(repo, '5'.repeat(40), '6'.repeat(40)),
      ).rejects.toMatchObject({ categoria: 'commit-desconhecido' })
    }
  })

  test('sha desconhecido → sem checks', async () => {
    const [repo] = await fonte.listarRepositorios()
    expect(await fonte.listarChecks(repo!, 'f'.repeat(40))).toEqual([])
  })

  test('listarDeployments: 7 por repositório; desde 2026-10-16T11:00:00Z → 4; compararCommits(portal, M, V1/V2/V3) → behind/ahead/diverged; par desconhecido → commit-desconhecido', async () => {
    const repos = (await fonte.listarRepositorios()).slice(0, 4)
    for (const repo of repos) {
      expect(await fonte.listarDeployments(repo, null)).toHaveLength(7)
      expect(await fonte.listarDeployments(repo, new Date('2026-10-16T11:00:00Z'))).toHaveLength(4)
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
      'success',
      'success',
    ])
  })

  test('portal tem 916001 producao-publicacao B1 e 916002 qa-publicacao M1; compararCommits(portal, B1, M1) → ahead [M1] não truncada', async () => {
    const [portal] = await fonte.listarRepositorios()
    const B1 = '16b' + '0'.repeat(37)
    const M1 = '1' + 'c'.repeat(39)
    const itens = await fonte.listarDeployments(portal!, null)
    const novos = itens
      .filter((d) => d.githubId < BigInt(1_000_000))
      .sort((a, b) => Number(a.githubId - b.githubId))
    expect(
      novos.map((d) => [d.githubId, d.ambiente, d.sha, d.criadoEm.toISOString(), d.status?.estado]),
    ).toEqual([
      [BigInt(916001), 'producao-publicacao', B1, '2026-10-10T12:00:00.000Z', 'success'],
      [BigInt(916002), 'qa-publicacao', M1, '2026-10-16T12:00:00.000Z', 'success'],
    ])
    expect(novos.map((d) => d.status?.githubId)).toEqual([BigInt(915001), BigInt(915002)])
    expect(await fonte.compararCommits(portal!, B1, M1)).toEqual({
      status: 'ahead',
      commits: [M1],
      truncada: false,
    })
    expect((await fonte.compararCommits(portal!, M1, B1)).status).toBe('behind')
  })

  test('api (n=2) e app-mobile (n=4): 9n6001 producao-publicacao Bn e 9n6003 producao-publicacao Dn; Mn…Bn → behind; Mn…Dn → ahead [Dn]', async () => {
    const repos = await fonte.listarRepositorios()
    for (const [indice, n] of [
      [1, 2],
      [3, 4],
    ] as const) {
      const repo = repos[indice]!
      const M = String(n) + 'c'.repeat(39)
      const B = `${n}6b` + '0'.repeat(37)
      const D = `${n}6d` + '0'.repeat(37)
      const itens = (await fonte.listarDeployments(repo, null))
        .filter((d) => d.githubId < BigInt(1_000_000))
        .sort((a, b) => Number(a.githubId - b.githubId))
      expect(itens.map((d) => [d.githubId, d.ambiente, d.sha, d.criadoEm.toISOString()])).toEqual([
        [BigInt(`9${n}6001`), 'producao-publicacao', B, '2026-10-10T12:00:00.000Z'],
        [BigInt(`9${n}6003`), 'producao-publicacao', D, '2026-10-18T12:00:00.000Z'],
      ])
      expect((await fonte.compararCommits(repo, M, B)).status).toBe('behind')
      expect(await fonte.compararCommits(repo, M, D)).toEqual({
        status: 'ahead',
        commits: [D],
        truncada: false,
      })
    }
  })

  test('PR #5 dos quatro repositórios tem shaMerge n+"c"×39; PR #6 tem null', async () => {
    const repos = (await fonte.listarRepositorios()).slice(0, 4)
    for (const [i, repo] of repos.entries()) {
      const prs = await fonte.listarPullRequestsAtualizados(repo, null)
      expect(prs.find((p) => p.numero === 5)?.shaMerge).toBe(String(i + 1) + 'c'.repeat(39))
      expect(prs.find((p) => p.numero === 6)?.shaMerge).toBeNull()
    }
  })

  test('criarIssue em portal com relógio 2026-10-26T12:00:00Z → { numero: 316000, githubId: BigInt(5001316000), urlHtml: ".../portal/issues/316000" }; segunda chamada → 316001; escritas tem 2 itens; listarIssuesAtualizadas(portal, null) continua com 4', async () => {
    const f = criarFonteFixtures(() => new Date('2026-10-26T12:00:00Z'))
    const [portal] = await f.listarRepositorios()
    expect(await f.criarIssue(portal!, { titulo: 'Correção: x', corpo: 'y' })).toEqual({
      numero: 316000,
      githubId: BigInt(5001316000),
      urlHtml: 'https://github.com/kustertech-exemplo/portal/issues/316000',
    })
    expect((await f.criarIssue(portal!, { titulo: 'Correção: x', corpo: 'y' })).numero).toBe(316001)
    expect(f.escritas).toHaveLength(2)
    expect(f.escritas).toEqual([
      { tipo: 'criar', repositorio: 'kustertech-exemplo/portal', numero: 316000 },
      { tipo: 'criar', repositorio: 'kustertech-exemplo/portal', numero: 316001 },
    ])
    expect(await f.listarIssuesAtualizadas(portal!, null)).toHaveLength(4)
  })

  test('reabrirIssue(portal, 4) → ABERTA, fechadaEm null, atualizadaEm = relógio; reabrirIssue(portal, 99) → ErroDeIntegracao sem-acesso', async () => {
    const agora = new Date('2026-10-26T12:00:00Z')
    const f = criarFonteFixtures(() => agora)
    const [portal] = await f.listarRepositorios()
    const issue = await f.reabrirIssue(portal!, 4)
    expect(issue).toMatchObject({
      numero: 4,
      estado: 'ABERTA',
      fechadaEm: null,
      atualizadaEm: agora,
    })
    await expect(f.reabrirIssue(portal!, 99)).rejects.toMatchObject({ categoria: 'sem-acesso' })
    expect(f.escritas).toEqual([
      { tipo: 'reabrir', repositorio: 'kustertech-exemplo/portal', numero: 4 },
    ])
  })
})
