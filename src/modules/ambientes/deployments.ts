import { db } from '@/lib/db'
import type { FonteGitHub } from '@/modules/github/fonte'
import { paraErroDeIntegracao } from '@/modules/github/reconciliacao'
import {
  ambienteDoDeployment,
  deploymentsDevidos,
  JANELA_DE_REVISAO_DE_DEPLOYMENTS_MS,
  rotuloDaVersao,
  situacaoDoStatus,
} from './model'

type Resultado = 'ok' | 'falha' | 'ignorado'

async function lerDeployments(
  fonte: FonteGitHub,
  repositorioId: string,
  agora: Date,
): Promise<{ resultado: Resultado; evidencias: number }> {
  const repo = await db.repositorioGitHub.findUnique({
    where: { id: repositorioId },
    include: { projeto: { include: { ambientes: true } } },
  })
  if (!repo || repo.projeto === null || repo.removidoDaInstalacaoEm !== null) {
    return { resultado: 'ignorado', evidencias: 0 }
  }
  const projeto = repo.projeto
  const ambientes = projeto.ambientes.filter((a) => a.nomeNoGitHub !== null)
  if (ambientes.length === 0) {
    return { resultado: 'ignorado', evidencias: 0 }
  }

  const ref = {
    githubId: repo.githubId,
    instalacaoId: repo.instalacaoId,
    nomeCompleto: repo.nomeCompleto,
  }
  const desde =
    repo.cursorDeployments === null
      ? null
      : new Date(repo.cursorDeployments.getTime() - JANELA_DE_REVISAO_DE_DEPLOYMENTS_MS)

  try {
    const deployments = await fonte.listarDeployments(ref, desde)
    let evidencias = 0
    await db.$transaction(async (tx) => {
      for (const d of deployments) {
        const ambiente = ambienteDoDeployment(d.ambiente, ambientes)
        const situacao = situacaoDoStatus(d.status?.estado ?? null)
        if (ambiente === null || situacao === null) {
          continue
        }
        const versao = await tx.versao.upsert({
          where: { repositorioId_commitSha: { repositorioId: repo.id, commitSha: d.sha } },
          create: {
            projetoId: projeto.id,
            repositorioId: repo.id,
            commitSha: d.sha,
            rotulo: rotuloDaVersao({ informado: null, ref: d.ref, commitSha: d.sha }),
          },
          update: {},
        })
        const criadas = await tx.evidenciaDeploy.createMany({
          data: [
            {
              ambienteId: ambiente.id,
              versaoId: versao.id,
              origem: 'GITHUB_DEPLOYMENT',
              situacao,
              ocorridaEm: d.status?.criadoEm ?? d.criadoEm,
              idExterno: `${d.githubId}:${d.status?.githubId ?? 'sem-status'}`,
              detalhe: `Deployment ${d.githubId} (${d.ambiente})`.slice(0, 200),
            },
          ],
          skipDuplicates: true,
        })
        evidencias += criadas.count
      }
      const maisNovo = deployments.reduce<Date | null>(
        (m, d) => (m === null || d.criadoEm > m ? d.criadoEm : m),
        repo.cursorDeployments,
      )
      await tx.repositorioGitHub.update({
        where: { id: repo.id },
        data: {
          cursorDeployments: maisNovo,
          deploymentsSincronizadosEm: agora,
          deploymentsFalhaEm: null,
          deploymentsFalhaMotivo: null,
        },
      })
    })
    return { resultado: 'ok', evidencias }
  } catch (erro) {
    await db.repositorioGitHub.update({
      where: { id: repo.id },
      data: {
        deploymentsFalhaEm: agora,
        deploymentsFalhaMotivo: paraErroDeIntegracao(erro).message,
      },
    })
    return { resultado: 'falha', evidencias: 0 }
  }
}

export async function sincronizarDeploymentsDoRepositorio(
  fonte: FonteGitHub,
  repositorioId: string,
  agora: Date,
): Promise<Resultado> {
  return (await lerDeployments(fonte, repositorioId, agora)).resultado
}

export async function sincronizarDeployments(
  fonte: FonteGitHub | null,
  agora: Date,
  intervaloMs: number,
): Promise<{ repositorios: number; evidencias: number; falhas: number }> {
  const resumo = { repositorios: 0, evidencias: 0, falhas: 0 }
  if (fonte === null) {
    return resumo
  }
  const candidatos = await db.repositorioGitHub.findMany({
    where: {
      projetoId: { not: null },
      removidoDaInstalacaoEm: null,
      projeto: { ambientes: { some: { nomeNoGitHub: { not: null } } } },
    },
    orderBy: { nomeCompleto: 'asc' },
  })
  for (const repo of candidatos) {
    if (!deploymentsDevidos(repo, agora, intervaloMs)) {
      continue
    }
    const { resultado, evidencias } = await lerDeployments(fonte, repo.id, agora)
    if (resultado === 'ignorado') {
      continue
    }
    resumo.repositorios += 1
    resumo.evidencias += evidencias
    if (resultado === 'falha') {
      resumo.falhas += 1
    }
  }
  return resumo
}
