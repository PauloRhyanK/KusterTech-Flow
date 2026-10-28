import type { OrigemDaBase, Prisma } from '@prisma/client'
import {
  evidenciaVigente,
  type EvidenciaParaEstado,
  type OrigemEvidencia,
} from '@/modules/ambientes/model'
import { SHA_NULO } from './model'

export interface BaseEscolhida {
  commitBase: string
  origemDaBase: OrigemDaBase
}

export interface VersaoEmAmbiente {
  versaoId: string
  rotulo: string
  commitSha: string
  origem: OrigemEvidencia
  ocorridaEm: Date
}

export interface SituacaoDePublicacao {
  repositorio: {
    id: string
    nomeCompleto: string
    projetoId: string
    githubId: bigint
    instalacaoId: bigint
    sincronizadoEm: Date | null
    ultimaFalhaEm: Date | null
    removidoDaInstalacaoEm: Date | null
  }
  qa: { id: string } | null
  prod: { id: string; criadoEm: Date } | null
  candidata: VersaoEmAmbiente | null
  emProd: VersaoEmAmbiente | null
  base: BaseEscolhida | null
}

// Decisão 3 do Incremento 6: autorização da própria candidata, senão a última autorização do
// repositório, senão a versão em PROD pela evidência, senão sem base.
export function escolherBase(e: {
  candidataId: string
  autorizacoes: readonly {
    versaoAlvoId: string
    commitBase: string
    composicao: { origemDaBase: OrigemDaBase }
    versaoAlvo: { commitSha: string }
  }[]
  emProd: { commitSha: string } | null
}): BaseEscolhida {
  const propria = e.autorizacoes.find((a) => a.versaoAlvoId === e.candidataId)
  if (propria) {
    return { commitBase: propria.commitBase, origemDaBase: propria.composicao.origemDaBase }
  }
  const ultima = e.autorizacoes[0]
  if (ultima) {
    return { commitBase: ultima.versaoAlvo.commitSha, origemDaBase: 'AUTORIZACAO' }
  }
  if (e.emProd) {
    return { commitBase: e.emProd.commitSha, origemDaBase: 'EVIDENCIA_PROD' }
  }
  return { commitBase: SHA_NULO, origemDaBase: 'SEM_BASE' }
}

// Decisões 2 e 3: versão candidata (QA), versão em PROD e base da composição de um repositório.
// Única leitura usada pelo worker, pela página e pelo service.
export async function localizarSituacaoDePublicacao(
  cliente: Prisma.TransactionClient,
  repositorioId: string,
): Promise<SituacaoDePublicacao | null> {
  const repo = await cliente.repositorioGitHub.findUniqueOrThrow({ where: { id: repositorioId } })
  if (repo.projetoId === null) return null
  const repositorio = { ...repo, projetoId: repo.projetoId }

  const ambientes = await cliente.ambiente.findMany({
    where: { projetoId: repo.projetoId, tipo: { in: ['QA', 'PROD'] } },
  })
  const qa = ambientes.find((a) => a.tipo === 'QA') ?? null
  const prod = ambientes.find((a) => a.tipo === 'PROD') ?? null
  const semBase = { repositorio, qa, prod, candidata: null, emProd: null, base: null }
  if (!qa || !prod) return semBase

  const evidencias = await cliente.evidenciaDeploy.findMany({
    where: {
      ambienteId: { in: [qa.id, prod.id] },
      situacao: 'SUCESSO',
      versao: { repositorioId },
    },
    include: { versao: { select: { rotulo: true, commitSha: true } } },
  })
  const doAmbiente = (ambienteId: string): VersaoEmAmbiente | null => {
    const paraEstado: EvidenciaParaEstado[] = evidencias
      .filter((e) => e.ambienteId === ambienteId)
      .map((e) => ({
        versaoId: e.versaoId,
        rotulo: e.versao.rotulo,
        origem: e.origem,
        situacao: e.situacao,
        ocorridaEm: e.ocorridaEm,
        registradaEm: e.registradaEm,
      }))
    const vigente = evidenciaVigente(paraEstado)
    const evidencia = vigente && evidencias.find((e) => e.versaoId === vigente.versaoId)
    if (!vigente || !evidencia) return null
    return {
      versaoId: vigente.versaoId,
      rotulo: vigente.rotulo,
      commitSha: evidencia.versao.commitSha,
      origem: vigente.origem,
      ocorridaEm: vigente.ocorridaEm,
    }
  }
  const emProd = doAmbiente(prod.id)
  const candidata = doAmbiente(qa.id)
  // Quando a candidata é a versão em PROD, não há candidata.
  if (!candidata || candidata.versaoId === emProd?.versaoId) {
    return { ...semBase, emProd }
  }

  const autorizacoes = await cliente.autorizacaoProd.findMany({
    where: { repositorioId, revogadaEm: null },
    include: {
      composicao: { select: { origemDaBase: true } },
      versaoAlvo: { select: { commitSha: true } },
    },
    orderBy: { criadaEm: 'desc' },
  })
  const base = escolherBase({ candidataId: candidata.versaoId, autorizacoes, emProd })
  return { repositorio, qa, prod, candidata, emProd, base }
}
