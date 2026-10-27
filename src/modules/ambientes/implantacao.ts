import { db } from '@/lib/db'
import {
  estadoDeImplantacaoNoAmbiente,
  evidenciaVigente,
  type EvidenciaParaEstado,
  type ImplantacaoNoAmbiente,
  type PresencaCalculada,
  type TipoAmbiente,
} from './model'

export interface ImplantacaoDetalhada extends ImplantacaoNoAmbiente {
  commitSha: string | null
  autorDoDeploy: string | null
  confirmadaPor: { nome: string; em: Date } | null
}

interface EvidenciaDoRepositorio extends EvidenciaParaEstado {
  commitSha: string
  autor: string | null
}

// Leitura sem sujeito: quem chama autoriza. Evidências do ambiente para o repositório de cada
// issue + presença da versão vigente. Ids que não são de issues do projeto ficam fora do mapa.
export async function implantacaoDasIssues(
  projetoId: string,
  issueIds: readonly string[],
  tipo: TipoAmbiente,
): Promise<Map<string, ImplantacaoDetalhada>> {
  const resultado = new Map<string, ImplantacaoDetalhada>()
  if (issueIds.length === 0) {
    return resultado
  }

  const [ambiente, issues] = await Promise.all([
    db.ambiente.findUnique({ where: { projetoId_tipo: { projetoId, tipo } } }),
    db.issueGitHub.findMany({
      where: { id: { in: [...issueIds] }, repositorio: { projetoId } },
      select: { id: true, repositorioId: true },
    }),
  ])

  const evidenciasPorRepositorio = new Map<string, EvidenciaDoRepositorio[]>()
  if (ambiente) {
    const linhas = await db.evidenciaDeploy.findMany({
      where: {
        ambienteId: ambiente.id,
        versao: { repositorioId: { in: [...new Set(issues.map((i) => i.repositorioId))] } },
      },
      include: {
        versao: { select: { rotulo: true, commitSha: true, repositorioId: true } },
        autor: { select: { nome: true } },
      },
    })
    for (const l of linhas) {
      const lista = evidenciasPorRepositorio.get(l.versao.repositorioId) ?? []
      lista.push({
        versaoId: l.versaoId,
        rotulo: l.versao.rotulo,
        origem: l.origem,
        situacao: l.situacao,
        ocorridaEm: l.ocorridaEm,
        registradaEm: l.registradaEm,
        commitSha: l.versao.commitSha,
        autor: l.autor?.nome ?? null,
      })
      evidenciasPorRepositorio.set(l.versao.repositorioId, lista)
    }
  }

  const vigentes = new Map<string, EvidenciaDoRepositorio>()
  for (const [repositorioId, lista] of evidenciasPorRepositorio) {
    const vigente = evidenciaVigente(lista) as EvidenciaDoRepositorio | null
    if (vigente) {
      vigentes.set(repositorioId, vigente)
    }
  }

  const presencas =
    vigentes.size === 0
      ? []
      : await db.presencaIssueVersao.findMany({
          where: {
            issueId: { in: issues.map((i) => i.id) },
            versaoId: { in: [...new Set([...vigentes.values()].map((v) => v.versaoId))] },
          },
          include: { confirmadaPor: { select: { nome: true } } },
        })
  const presencaDe = new Map(presencas.map((p) => [`${p.issueId}:${p.versaoId}`, p] as const))

  for (const issue of issues) {
    const evidencias = evidenciasPorRepositorio.get(issue.repositorioId) ?? []
    const vigente = vigentes.get(issue.repositorioId)
    const linha = vigente ? presencaDe.get(`${issue.id}:${vigente.versaoId}`) : undefined
    const presencas = new Map<string, PresencaCalculada>()
    if (vigente && linha) {
      presencas.set(vigente.versaoId, { estado: linha.estado, motivo: linha.motivo })
    }

    const estado = estadoDeImplantacaoNoAmbiente({
      configurado: ambiente !== null,
      evidencias,
      presencas,
    })
    resultado.set(issue.id, {
      ...estado,
      commitSha: vigente?.commitSha ?? null,
      autorDoDeploy: vigente?.origem === 'MANUAL' ? vigente.autor : null,
      confirmadaPor:
        linha?.confirmadaPorId && linha.confirmadaPor
          ? { nome: linha.confirmadaPor.nome, em: linha.calculadaEm }
          : null,
    })
  }
  return resultado
}
