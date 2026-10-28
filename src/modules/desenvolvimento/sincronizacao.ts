import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import type { FonteGitHub } from '@/modules/github/fonte'
import { paraErroDeIntegracao } from '@/modules/github/reconciliacao'
import {
  derivarExecucoes,
  estadoDaExecucao,
  leituraWarrenDevida,
  lerPlanosDeSeeds,
  lerSeeds,
  type ExecucaoDerivada,
} from './model'

const ARQUIVO_DE_SEEDS = '.seeds/issues.jsonl'
const ARQUIVO_DE_PLANOS = '.seeds/plans.jsonl'

type Resultado = 'ok' | 'falha'

interface DadosDaExecucao {
  seedId: string | null
  papel: string | null
  agente: string | null
  custo: Prisma.Decimal | null
  iniciadaEm: Date | null
  pullRequestId: string | null
  fonte: string
  estado: ExecucaoDerivada['estado']
  motivoDoEstado: string
}

function dadosDe(d: ExecucaoDerivada): DadosDaExecucao {
  return {
    seedId: d.seedId,
    papel: d.papel,
    agente: d.agente,
    custo: d.custoUsd === null ? null : new Prisma.Decimal(d.custoUsd),
    iniciadaEm: d.iniciadaEm,
    pullRequestId: d.pullRequestId,
    fonte: d.fonte,
    estado: d.estado,
    motivoDoEstado: d.motivo,
  }
}

function mudou(
  atual: Omit<DadosDaExecucao, 'iniciadaEm'> & { custo: Prisma.Decimal | null },
  novo: DadosDaExecucao,
): boolean {
  const mesmoCusto =
    atual.custo === null || novo.custo === null
      ? atual.custo === novo.custo
      : atual.custo.equals(novo.custo)
  return (
    !mesmoCusto ||
    atual.estado !== novo.estado ||
    atual.motivoDoEstado !== novo.motivoDoEstado ||
    atual.seedId !== novo.seedId ||
    atual.papel !== novo.papel ||
    atual.agente !== novo.agente ||
    atual.pullRequestId !== novo.pullRequestId ||
    atual.fonte !== novo.fonte
  )
}

async function lerRepositorio(
  fonte: FonteGitHub,
  repositorioId: string,
  agora: Date,
): Promise<{ resultado: Resultado; execucoes: number }> {
  const repo = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repositorioId } })
  const ref = {
    githubId: repo.githubId,
    instalacaoId: repo.instalacaoId,
    nomeCompleto: repo.nomeCompleto,
  }

  try {
    const issues = await fonte.lerArquivo(ref, ARQUIVO_DE_SEEDS)
    const planosTexto = await fonte.lerArquivo(ref, ARQUIVO_DE_PLANOS)
    const lidas = issues === null ? { seeds: [], linhasInvalidas: 0 } : lerSeeds(issues)
    const planos =
      planosTexto === null ? { planos: [], linhasInvalidas: 0 } : lerPlanosDeSeeds(planosTexto)
    const nomeDoPlano = new Map(planos.planos.map((p) => [p.planoId, p.nome]))
    const prs = await db.pullRequestGitHub.findMany({
      where: { repositorioId: repo.id },
      select: { id: true, autor: true, branch: true, corpo: true, atualizadoNoGitHub: true },
    })
    const derivadas = derivarExecucoes(
      lidas.seeds,
      prs.map((p) => ({
        id: p.id,
        autor: p.autor,
        branch: p.branch,
        corpo: p.corpo,
        atualizadoEm: p.atualizadoNoGitHub,
      })),
      agora,
    )

    let gravadas = 0
    await db.$transaction(async (tx) => {
      const vistas = new Set(lidas.seeds.map((s) => s.seedId))
      for (const seed of lidas.seeds) {
        const dados = {
          titulo: seed.titulo,
          status: seed.status,
          tipo: seed.tipo,
          planoId: seed.planoId,
          planoNome: seed.planoId === null ? null : (nomeDoPlano.get(seed.planoId) ?? null),
          bloqueadaPor: seed.bloqueadaPor,
          atualizadaNoSeeds: seed.atualizadaEm,
          ausenteDesde: null,
          lidaEm: agora,
        }
        await tx.seedDoRepositorio.upsert({
          where: { repositorioId_seedId: { repositorioId: repo.id, seedId: seed.seedId } },
          create: { repositorioId: repo.id, seedId: seed.seedId, ...dados },
          update: dados,
        })
      }
      await tx.seedDoRepositorio.updateMany({
        where: {
          repositorioId: repo.id,
          seedId: { notIn: [...vistas] },
          ausenteDesde: null,
        },
        data: { ausenteDesde: agora },
      })

      const existentes = await tx.execucaoAgente.findMany({ where: { repositorioId: repo.id } })
      const porRun = new Map(existentes.map((e) => [e.runId, e]))
      const derivadasPorRun = new Set(derivadas.map((d) => d.runId))

      for (const d of derivadas) {
        const dados = dadosDe(d)
        const atual = porRun.get(d.runId)
        if (atual === undefined) {
          const dono = await tx.execucaoAgente.findUnique({
            where: { runId: d.runId },
            select: { id: true },
          })
          if (dono !== null) {
            log.warn(
              { repositorio: repo.nomeCompleto },
              'execução do Warren pertence a outro repositório',
            )
            continue
          }
          await tx.execucaoAgente.create({
            data: {
              repositorioId: repo.id,
              runId: d.runId,
              ...dados,
              atualizadaEm: agora,
              sincronizadaEm: agora,
            },
          })
        } else {
          await tx.execucaoAgente.update({
            where: { id: atual.id },
            data: {
              ...dados,
              sincronizadaEm: agora,
              ...(mudou(atual, dados) ? { atualizadaEm: agora } : {}),
            },
          })
        }
        gravadas += 1
      }

      for (const atual of existentes) {
        if (derivadasPorRun.has(atual.runId)) continue
        const { estado, motivo } = estadoDaExecucao(
          { mencionadaNasFontes: false, temPullRequest: false, seed: null, registradaEm: null },
          agora,
        )
        const mudouEstado = atual.estado !== estado || atual.motivoDoEstado !== motivo
        await tx.execucaoAgente.update({
          where: { id: atual.id },
          data: {
            estado,
            motivoDoEstado: motivo,
            sincronizadaEm: agora,
            ...(mudouEstado ? { atualizadaEm: agora } : {}),
          },
        })
      }

      await tx.repositorioGitHub.update({
        where: { id: repo.id },
        data: {
          warrenLidoEm: agora,
          warrenFalhaEm: null,
          warrenFalhaMotivo: null,
          seedsEncontrado: issues !== null,
          seedsLinhasInvalidas: lidas.linhasInvalidas + planos.linhasInvalidas,
        },
      })
    })
    log.info(
      { repositorio: repo.nomeCompleto, seeds: lidas.seeds.length, execucoes: gravadas },
      'execuções do Warren sincronizadas',
    )
    return { resultado: 'ok', execucoes: gravadas }
  } catch (erro) {
    await db.repositorioGitHub.update({
      where: { id: repo.id },
      data: { warrenFalhaEm: agora, warrenFalhaMotivo: paraErroDeIntegracao(erro).message },
    })
    return { resultado: 'falha', execucoes: 0 }
  }
}

export async function sincronizarExecucoesWarren(
  fonte: FonteGitHub | null,
  agora: Date,
  intervaloMs: number,
): Promise<{ repositorios: number; execucoes: number; falhas: number }> {
  const resumo = { repositorios: 0, execucoes: 0, falhas: 0 }
  if (fonte === null) {
    return resumo
  }
  const candidatos = await db.repositorioGitHub.findMany({
    where: { projetoId: { not: null }, removidoDaInstalacaoEm: null },
    orderBy: { nomeCompleto: 'asc' },
  })
  for (const repo of candidatos) {
    if (!leituraWarrenDevida(repo, agora, intervaloMs)) {
      continue
    }
    const { resultado, execucoes } = await lerRepositorio(fonte, repo.id, agora)
    resumo.repositorios += 1
    resumo.execucoes += execucoes
    if (resultado === 'falha') {
      resumo.falhas += 1
    }
  }
  return resumo
}
