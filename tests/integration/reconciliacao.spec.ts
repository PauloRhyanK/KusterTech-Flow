import { inspect } from 'node:util'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { ErroDeIntegracao } from '@/modules/github/erros'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import type { FonteGitHub } from '@/modules/github/fonte'
import {
  executarCiclo,
  registrarIntegracao,
  sincronizarCatalogo,
  sincronizarRepositorio,
} from '@/modules/github/reconciliacao'
import { limparBanco } from './banco-de-teste'

const t0 = new Date('2026-10-26T15:00:00.000Z')
const t05 = new Date('2026-10-26T15:05:00.000Z')
const t1 = new Date('2026-10-26T15:10:00.000Z')
const t2 = new Date('2026-10-26T15:20:00.000Z')
const INTERVALO = 600_000

function fonteComFalha(falha: () => Error | null): FonteGitHub {
  const base = criarFonteFixtures()
  const guardar =
    <A extends unknown[], R>(f: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      const erro = falha()
      if (erro) {
        throw erro
      }
      return f(...a)
    }
  return {
    tipo: 'fixtures',
    listarRepositorios: guardar(base.listarRepositorios),
    listarIssuesAtualizadas: guardar(base.listarIssuesAtualizadas),
    listarPullRequestsAtualizados: guardar(base.listarPullRequestsAtualizados),
    listarChecks: guardar(base.listarChecks),
  }
}

async function repositorioPortal(vinculado: boolean) {
  const repo = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: 'kustertech-exemplo/portal' },
  })
  if (!vinculado) {
    return repo
  }
  const projeto = await db.projeto.create({ data: { nome: 'Portal', nomeNormalizado: 'portal' } })
  return db.repositorioGitHub.update({
    where: { id: repo.id },
    data: { projetoId: projeto.id, vinculadoEm: t0 },
  })
}

async function contagens() {
  return {
    issues: await db.issueGitHub.count(),
    prs: await db.pullRequestGitHub.count(),
  }
}

beforeEach(async () => {
  await limparBanco()
})

describe('reconciliação do GitHub', () => {
  test('catálogo: quatro repositórios sem projeto; segundo ciclo não duplica; repositório que sumiu da fonte ganha removidoDaInstalacaoEm e continua no banco', async () => {
    const fonte = criarFonteFixtures()
    await sincronizarCatalogo(fonte, t0)
    await sincronizarCatalogo(fonte, t1)

    const repos = await db.repositorioGitHub.findMany()
    expect(repos).toHaveLength(4)
    expect(repos.every((r) => r.projetoId === null && r.removidoDaInstalacaoEm === null)).toBe(true)
    expect(repos.every((r) => r.catalogadoEm.getTime() === t0.getTime())).toBe(true)
    const integracao = await db.integracaoGitHub.findUniqueOrThrow({ where: { id: 'github' } })
    expect(integracao.catalogoSincronizadoEm).toEqual(t1)

    const base = criarFonteFixtures()
    const semSite: FonteGitHub = {
      ...base,
      listarRepositorios: async () =>
        (await base.listarRepositorios()).filter((r) => !r.nomeCompleto.endsWith('/site')),
    }
    await sincronizarCatalogo(semSite, t2)
    const site = await db.repositorioGitHub.findFirstOrThrow({
      where: { nomeCompleto: 'kustertech-exemplo/site' },
    })
    expect(site.removidoDaInstalacaoEm).toEqual(t2)
    expect(await db.repositorioGitHub.count()).toBe(4)

    await sincronizarCatalogo(base, new Date('2026-10-26T15:30:00.000Z'))
    const volta = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: site.id } })
    expect(volta.removidoDaInstalacaoEm).toBeNull()
  })

  test('falha no catálogo grava a falha na integração e não toca o catálogo', async () => {
    await sincronizarCatalogo(criarFonteFixtures(), t0)
    await sincronizarCatalogo(
      fonteComFalha(() => new ErroDeIntegracao('autenticacao')),
      t1,
    )
    const integracao = await db.integracaoGitHub.findUniqueOrThrow({ where: { id: 'github' } })
    expect(integracao.ultimaFalhaEm).toEqual(t1)
    expect(integracao.ultimaFalhaMotivo).toBe('A GitHub App recusou as credenciais.')
    expect(integracao.catalogoSincronizadoEm).toEqual(t0)
    expect(await db.repositorioGitHub.count({ where: { removidoDaInstalacaoEm: null } })).toBe(4)
  })

  test('sincronizarRepositorio de portal vinculado: 4 issues (nenhum PR entre elas), 2 PRs, PR mergeado com issuesReferenciadas [2] e checks SUCESSO, PR aberto com FALHA', async () => {
    const fonte = criarFonteFixtures()
    await sincronizarCatalogo(fonte, t0)
    const repo = await repositorioPortal(true)

    expect(await sincronizarRepositorio(fonte, repo.id, t0)).toBe('ok')

    expect(await db.issueGitHub.count({ where: { repositorioId: repo.id } })).toBe(4)
    const prs = await db.pullRequestGitHub.findMany({
      where: { repositorioId: repo.id },
      orderBy: { numero: 'asc' },
    })
    expect(prs).toHaveLength(2)
    const mergeado = prs.find((p) => p.estado === 'MERGEADO')!
    expect(mergeado.issuesReferenciadas).toEqual([2])
    expect(mergeado.checks).toBe('SUCESSO')
    const aberto = prs.find((p) => p.estado === 'ABERTO')!
    expect(aberto.checks).toBe('FALHA')
    expect(aberto.checksAtualizadosEm).toEqual(t0)

    const depois = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })
    expect(depois.sincronizadoEm).toEqual(t0)
    expect(depois.falhasConsecutivas).toBe(0)
    expect(depois.cursorIssues).not.toBeNull()
    expect(depois.cursorPullRequests).not.toBeNull()
  })

  test('rodar duas vezes seguidas com os mesmos dados mantém as contagens e os ids (sem efeito duplo)', async () => {
    const fonte = criarFonteFixtures()
    await sincronizarCatalogo(fonte, t0)
    const repo = await repositorioPortal(true)

    await sincronizarRepositorio(fonte, repo.id, t0)
    const antes = await contagens()
    const idsAntes = (await db.issueGitHub.findMany({ orderBy: { githubId: 'asc' } })).map(
      (i) => i.id,
    )

    await sincronizarRepositorio(fonte, repo.id, t1)
    expect(await contagens()).toEqual(antes)
    const idsDepois = (await db.issueGitHub.findMany({ orderBy: { githubId: 'asc' } })).map(
      (i) => i.id,
    )
    expect(idsDepois).toEqual(idsAntes)

    // cursor nulo (reprocessa tudo, como após reinício sem cursor) também não duplica
    await db.repositorioGitHub.update({
      where: { id: repo.id },
      data: { cursorIssues: null, cursorPullRequests: null },
    })
    await sincronizarRepositorio(fonte, repo.id, t2)
    expect(await contagens()).toEqual(antes)
  })

  test('falha depois de um sucesso: issues continuam, sincronizadoEm não muda, ultimaFalhaMotivo é texto fixo, falhasConsecutivas = 1, cursores não avançam', async () => {
    const fonte = criarFonteFixtures()
    await sincronizarCatalogo(fonte, t0)
    const repo = await repositorioPortal(true)
    await sincronizarRepositorio(fonte, repo.id, t0)
    const antes = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })
    const totais = await contagens()

    const resultado = await sincronizarRepositorio(
      fonteComFalha(() => new ErroDeIntegracao('rede')),
      repo.id,
      t1,
    )

    expect(resultado).toBe('falha')
    const depois = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })
    expect(await contagens()).toEqual(totais)
    expect(depois.sincronizadoEm).toEqual(t0)
    expect(depois.ultimaFalhaEm).toEqual(t1)
    expect(depois.ultimaFalhaMotivo).toBe('Não foi possível falar com o GitHub.')
    expect(depois.falhasConsecutivas).toBe(1)
    expect(depois.cursorIssues).toEqual(antes.cursorIssues)
    expect(depois.cursorPullRequests).toEqual(antes.cursorPullRequests)
  })

  test('erro que não é ErroDeIntegracao vira falha desconhecida sem vazar a mensagem original', async () => {
    const fonte = criarFonteFixtures()
    await sincronizarCatalogo(fonte, t0)
    const repo = await repositorioPortal(true)
    const logDeErro = vi.spyOn(log, 'error').mockImplementation(() => undefined)

    const resultado = await sincronizarRepositorio(
      fonteComFalha(() => new Error('Bearer ghs_segredo-que-nao-pode-vazar')),
      repo.id,
      t1,
    )

    expect(resultado).toBe('falha')
    const depois = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })
    expect(depois.ultimaFalhaMotivo).toBe('Falha inesperada na sincronização.')
    expect(logDeErro).toHaveBeenCalledTimes(1)
    // inspect (e não JSON.stringify) para enxergar message e stack de um Error.
    expect(inspect(logDeErro.mock.calls, { depth: 5 })).not.toContain('ghs_segredo')
    logDeErro.mockRestore()
  })

  test('repositório não vinculado não é sincronizado; desvincular não apaga issues', async () => {
    const fonte = criarFonteFixtures()
    await sincronizarCatalogo(fonte, t0)
    const naoVinculado = await repositorioPortal(false)

    await sincronizarRepositorio(fonte, naoVinculado.id, t0)
    expect(await contagens()).toEqual({ issues: 0, prs: 0 })
    expect(
      (await db.repositorioGitHub.findUniqueOrThrow({ where: { id: naoVinculado.id } }))
        .sincronizadoEm,
    ).toBeNull()

    const repo = await repositorioPortal(true)
    await sincronizarRepositorio(fonte, repo.id, t0)
    const totais = await contagens()
    expect(totais.issues).toBe(4)

    await db.repositorioGitHub.update({ where: { id: repo.id }, data: { projetoId: null } })
    const resultado = await executarCiclo(fonte, t2, INTERVALO)
    expect(resultado.repositorios).toBe(0)
    expect(await contagens()).toEqual(totais)
  })

  test('repositório removido da instalação não é sincronizado e seus dados permanecem', async () => {
    const fonte = criarFonteFixtures()
    await sincronizarCatalogo(fonte, t0)
    const repo = await repositorioPortal(true)
    await sincronizarRepositorio(fonte, repo.id, t0)
    const totais = await contagens()
    await db.repositorioGitHub.update({
      where: { id: repo.id },
      data: { removidoDaInstalacaoEm: t1 },
    })

    // t05: catálogo ainda não venceu, então a remoção marcada não é desfeita pelo ciclo
    const resultado = await executarCiclo(fonte, t05, INTERVALO)

    expect(resultado).toEqual({ catalogo: false, repositorios: 0, falhas: 0 })
    expect(await contagens()).toEqual(totais)
  })

  test('executarCiclo sem fonte grava IntegracaoGitHub configurada = false e não toca repositórios', async () => {
    await sincronizarCatalogo(criarFonteFixtures(), t0)
    const resultado = await executarCiclo(null, t1, INTERVALO)

    expect(resultado).toEqual({ catalogo: false, repositorios: 0, falhas: 0 })
    const integracao = await db.integracaoGitHub.findUniqueOrThrow({ where: { id: 'github' } })
    expect(integracao.configurada).toBe(false)
    expect(integracao.fonte).toBe('app')
    expect(await db.repositorioGitHub.count()).toBe(4)
    expect(await contagens()).toEqual({ issues: 0, prs: 0 })
  })

  test('registrarIntegracao com fonte de fixtures grava configurada = true e fonte = fixtures', async () => {
    await registrarIntegracao(criarFonteFixtures())
    const integracao = await db.integracaoGitHub.findUniqueOrThrow({ where: { id: 'github' } })
    expect(integracao.configurada).toBe(true)
    expect(integracao.fonte).toBe('fixtures')
  })

  test('executarCiclo: cataloga, sincroniza só o vinculado devido e respeita o intervalo', async () => {
    const fonte = criarFonteFixtures()
    await sincronizarCatalogo(fonte, t0)
    const repo = await repositorioPortal(true)

    const primeiro = await executarCiclo(fonte, t05, INTERVALO)
    expect(primeiro).toEqual({ catalogo: false, repositorios: 1, falhas: 0 })
    expect((await contagens()).issues).toBe(4)

    const logoDepois = await executarCiclo(fonte, new Date(t05.getTime() + 30_000), INTERVALO)
    expect(logoDepois).toEqual({ catalogo: false, repositorios: 0, falhas: 0 })

    const vencido = await executarCiclo(fonte, t2, INTERVALO)
    expect(vencido).toEqual({ catalogo: true, repositorios: 1, falhas: 0 })
    expect(
      (await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })).sincronizadoEm,
    ).toEqual(t2)
  })

  test('executarCiclo conta falhas e aplica espera após falha', async () => {
    const fonte = criarFonteFixtures()
    await sincronizarCatalogo(fonte, t0)
    await repositorioPortal(true)
    const quebrada = fonteComFalha(() => new ErroDeIntegracao('limite'))

    const ciclo = await executarCiclo(quebrada, t1, INTERVALO)
    expect(ciclo.falhas).toBe(1)

    const logoDepois = await executarCiclo(quebrada, new Date(t1.getTime() + 30_000), INTERVALO)
    expect(logoDepois.repositorios).toBe(0)
  })
})
