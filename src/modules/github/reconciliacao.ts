import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { ErroDeIntegracao } from './erros'
import type { FonteGitHub } from './fonte'
import { repositorioDevido, resumirChecks, resumirErroParaLog } from './model'

const ID_INTEGRACAO = 'github'

function paraErroDeIntegracao(erro: unknown): ErroDeIntegracao {
  if (erro instanceof ErroDeIntegracao) {
    return erro
  }
  log.error({ erro: resumirErroParaLog(erro) }, 'falha inesperada na reconciliação do GitHub')
  return new ErroDeIntegracao('desconhecida')
}

function maior(datas: Date[], atual: Date | null): Date | null {
  return datas.reduce<Date | null>((m, d) => (m === null || d > m ? d : m), atual)
}

export async function registrarIntegracao(fonte: FonteGitHub | null): Promise<void> {
  const dados = { fonte: fonte?.tipo ?? 'app', configurada: fonte !== null }
  await db.integracaoGitHub.upsert({
    where: { id: ID_INTEGRACAO },
    create: { id: ID_INTEGRACAO, ...dados },
    update: dados,
  })
}

export async function sincronizarCatalogo(fonte: FonteGitHub, agora: Date): Promise<void> {
  const base = { fonte: fonte.tipo, configurada: true }
  try {
    const repositorios = await fonte.listarRepositorios()
    await db.$transaction(async (tx) => {
      for (const r of repositorios) {
        const dados = {
          nomeCompleto: r.nomeCompleto,
          urlHtml: r.urlHtml,
          privado: r.privado,
          arquivadoNoGitHub: r.arquivado,
          instalacaoId: r.instalacaoId,
          removidoDaInstalacaoEm: null,
        }
        await tx.repositorioGitHub.upsert({
          where: { githubId: r.githubId },
          create: { githubId: r.githubId, catalogadoEm: agora, ...dados },
          update: dados,
        })
      }
      await tx.repositorioGitHub.updateMany({
        where: {
          githubId: { notIn: repositorios.map((r) => r.githubId) },
          removidoDaInstalacaoEm: null,
        },
        data: { removidoDaInstalacaoEm: agora },
      })
      const sucesso = {
        ...base,
        catalogoSincronizadoEm: agora,
        ultimaFalhaEm: null,
        ultimaFalhaMotivo: null,
      }
      await tx.integracaoGitHub.upsert({
        where: { id: ID_INTEGRACAO },
        create: { id: ID_INTEGRACAO, ...sucesso },
        update: sucesso,
      })
    })
  } catch (erro) {
    const falha = {
      ...base,
      ultimaFalhaEm: agora,
      ultimaFalhaMotivo: paraErroDeIntegracao(erro).message,
    }
    await db.integracaoGitHub.upsert({
      where: { id: ID_INTEGRACAO },
      create: { id: ID_INTEGRACAO, ...falha },
      update: falha,
    })
  }
}

/** Repositório inexistente, sem projeto ou removido da instalação não é sincronizado (devolve 'ok'). */
export async function sincronizarRepositorio(
  fonte: FonteGitHub,
  repositorioId: string,
  agora: Date,
): Promise<'ok' | 'falha'> {
  const repo = await db.repositorioGitHub.findUnique({ where: { id: repositorioId } })
  if (!repo || repo.projetoId === null || repo.removidoDaInstalacaoEm !== null) {
    return 'ok'
  }
  const ref = {
    githubId: repo.githubId,
    instalacaoId: repo.instalacaoId,
    nomeCompleto: repo.nomeCompleto,
  }

  try {
    const issues = await fonte.listarIssuesAtualizadas(ref, repo.cursorIssues)
    const prs = await fonte.listarPullRequestsAtualizados(ref, repo.cursorPullRequests)

    const abertos = await db.pullRequestGitHub.findMany({
      where: { repositorioId: repo.id, estado: 'ABERTO' },
      select: { githubId: true, shaHead: true },
    })
    const shaPorPr = new Map<bigint, string>(abertos.map((p) => [p.githubId, p.shaHead]))
    for (const p of prs) {
      shaPorPr.set(p.githubId, p.shaHead)
    }
    const resumos = new Map<bigint, ReturnType<typeof resumirChecks>>()
    for (const [githubId, sha] of shaPorPr) {
      resumos.set(githubId, resumirChecks(await fonte.listarChecks(ref, sha)))
    }

    await db.$transaction(async (tx) => {
      for (const i of issues) {
        const dados = {
          numero: i.numero,
          titulo: i.titulo,
          corpo: i.corpo,
          estado: i.estado,
          autor: i.autor,
          responsaveis: i.responsaveis,
          rotulos: i.rotulos,
          urlHtml: i.urlHtml,
          criadaNoGitHub: i.criadaEm,
          atualizadaNoGitHub: i.atualizadaEm,
          fechadaNoGitHub: i.fechadaEm,
          sincronizadaEm: agora,
        }
        await tx.issueGitHub.upsert({
          where: { githubId: i.githubId },
          create: { githubId: i.githubId, repositorioId: repo.id, ...dados },
          update: dados,
        })
      }
      for (const p of prs) {
        const dados = {
          numero: p.numero,
          titulo: p.titulo,
          estado: p.estado,
          rascunho: p.rascunho,
          autor: p.autor,
          urlHtml: p.urlHtml,
          branch: p.branch,
          shaHead: p.shaHead,
          issuesReferenciadas: p.issuesReferenciadas,
          atualizadoNoGitHub: p.atualizadoEm,
          mergeadoNoGitHub: p.mergeadoEm,
          shaMerge: p.shaMerge,
          sincronizadoEm: agora,
        }
        await tx.pullRequestGitHub.upsert({
          where: { githubId: p.githubId },
          create: { githubId: p.githubId, repositorioId: repo.id, ...dados },
          update: dados,
        })
      }
      for (const [githubId, checks] of resumos) {
        await tx.pullRequestGitHub.update({
          where: { githubId },
          data: { checks, checksAtualizadosEm: agora },
        })
      }
      await tx.repositorioGitHub.update({
        where: { id: repo.id },
        data: {
          cursorIssues: maior(
            issues.map((i) => i.atualizadaEm),
            repo.cursorIssues,
          ),
          cursorPullRequests: maior(
            prs.map((p) => p.atualizadoEm),
            repo.cursorPullRequests,
          ),
          sincronizadoEm: agora,
          ultimaFalhaEm: null,
          ultimaFalhaMotivo: null,
          falhasConsecutivas: 0,
        },
      })
    })
    return 'ok'
  } catch (erro) {
    await db.repositorioGitHub.update({
      where: { id: repo.id },
      data: {
        ultimaFalhaEm: agora,
        ultimaFalhaMotivo: paraErroDeIntegracao(erro).message,
        falhasConsecutivas: { increment: 1 },
      },
    })
    return 'falha'
  }
}

export async function executarCiclo(
  fonte: FonteGitHub | null,
  agora: Date,
  intervaloMs: number,
): Promise<{ catalogo: boolean; repositorios: number; falhas: number }> {
  await registrarIntegracao(fonte)
  if (fonte === null) {
    return { catalogo: false, repositorios: 0, falhas: 0 }
  }

  const integracao = await db.integracaoGitHub.findUniqueOrThrow({ where: { id: ID_INTEGRACAO } })
  const venceu = (desde: Date | null) =>
    desde === null || agora.getTime() - desde.getTime() >= intervaloMs
  const catalogoDevido =
    venceu(integracao.catalogoSincronizadoEm) && venceu(integracao.ultimaFalhaEm)
  if (catalogoDevido) {
    await sincronizarCatalogo(fonte, agora)
  }

  const vinculados = await db.repositorioGitHub.findMany({
    where: { projetoId: { not: null }, removidoDaInstalacaoEm: null },
    orderBy: { nomeCompleto: 'asc' },
  })
  let repositorios = 0
  let falhas = 0
  for (const repo of vinculados) {
    if (!repositorioDevido(repo, agora, intervaloMs)) {
      continue
    }
    repositorios += 1
    if ((await sincronizarRepositorio(fonte, repo.id, agora)) === 'falha') {
      falhas += 1
    }
  }
  return { catalogo: catalogoDevido, repositorios, falhas }
}
