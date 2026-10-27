import { db } from '@/lib/db'
import { ErroDeIntegracao } from '@/modules/github/erros'
import type { FonteGitHub, RefRepositorio } from '@/modules/github/fonte'
import { paraErroDeIntegracao } from '@/modules/github/reconciliacao'
import {
  assinaturaDaEntrada,
  evidenciaVigente,
  presencaDeIssueNaVersao,
  prsMergeadosDaIssue,
  type EstadoImplantacao,
  type EvidenciaParaEstado,
  type ResultadoDeComparacao,
} from './model'

type Resultado = 'ok' | 'falha' | 'ignorado'

interface LinhaCalculada {
  issueId: string
  versaoId: string
  existe: boolean
  estado: EstadoImplantacao
  motivo: string
  assinaturaEntrada: string
}

// Só estas falhas tornam um par indisponível; as demais abortam o repositório inteiro.
function falhaDoPar(erro: unknown): boolean {
  return (
    erro instanceof ErroDeIntegracao &&
    (erro.categoria === 'commit-desconhecido' || erro.categoria === 'resposta-invalida')
  )
}

async function calcular(
  fonte: FonteGitHub | null,
  repositorioId: string,
  agora: Date,
  intervaloMs: number,
): Promise<{ resultado: Resultado; calculadas: number }> {
  const repo = await db.repositorioGitHub.findUnique({
    where: { id: repositorioId },
    include: { projeto: { include: { ambientes: true } } },
  })
  if (
    !repo ||
    repo.projeto === null ||
    repo.removidoDaInstalacaoEm !== null ||
    repo.projeto.ambientes.length === 0
  ) {
    return { resultado: 'ignorado', calculadas: 0 }
  }

  const evidenciasDoRepo = await db.evidenciaDeploy.findMany({
    where: {
      ambienteId: { in: repo.projeto.ambientes.map((a) => a.id) },
      versao: { repositorioId: repo.id },
    },
    include: { versao: { select: { rotulo: true } } },
  })
  const versaoIds = new Set<string>()
  for (const ambiente of repo.projeto.ambientes) {
    const lista: EvidenciaParaEstado[] = evidenciasDoRepo
      .filter((e) => e.ambienteId === ambiente.id)
      .map((e) => ({
        versaoId: e.versaoId,
        rotulo: e.versao.rotulo,
        origem: e.origem,
        situacao: e.situacao,
        ocorridaEm: e.ocorridaEm,
        registradaEm: e.registradaEm,
      }))
    const vigente = evidenciaVigente(lista)
    if (vigente) {
      versaoIds.add(vigente.versaoId)
    }
  }
  if (versaoIds.size === 0) {
    return { resultado: 'ok', calculadas: 0 }
  }

  const [versoes, issues, prs, existentes] = await Promise.all([
    db.versao.findMany({ where: { id: { in: [...versaoIds] } } }),
    db.issueGitHub.findMany({ where: { repositorioId: repo.id } }),
    db.pullRequestGitHub.findMany({ where: { repositorioId: repo.id } }),
    db.presencaIssueVersao.findMany({ where: { versaoId: { in: [...versaoIds] } } }),
  ])
  const linhaExistente = new Map(existentes.map((l) => [`${l.issueId}:${l.versaoId}`, l]))
  const ref: RefRepositorio = {
    githubId: repo.githubId,
    instalacaoId: repo.instalacaoId,
    nomeCompleto: repo.nomeCompleto,
  }

  const cache = new Map<string, ResultadoDeComparacao>()
  async function comparar(base: string, cabeca: string): Promise<ResultadoDeComparacao> {
    if (fonte === null) {
      return 'indisponivel'
    }
    const chave = `${base}...${cabeca}`
    const guardado = cache.get(chave)
    if (guardado) {
      return guardado
    }
    let resultado: ResultadoDeComparacao
    try {
      resultado = (await fonte.compararCommits(ref, base, cabeca)).status
    } catch (erro) {
      if (!falhaDoPar(erro)) {
        throw erro
      }
      resultado = 'indisponivel'
    }
    cache.set(chave, resultado)
    return resultado
  }

  const calculadas: LinhaCalculada[] = []
  try {
    for (const versao of versoes) {
      for (const issue of issues) {
        const doIssue = prsMergeadosDaIssue(issue.numero, prs)
        const assinaturaEntrada = assinaturaDaEntrada(doIssue)
        const atual = linhaExistente.get(`${issue.id}:${versao.id}`)
        if (atual) {
          const inalterada = atual.assinaturaEntrada === assinaturaEntrada
          const incertaVencida =
            atual.estado === 'VERIFICACAO_NECESSARIA' &&
            agora.getTime() - atual.calculadaEm.getTime() >= intervaloMs
          if (atual.confirmadaPorId !== null || (inalterada && !incertaVencida)) {
            continue
          }
        }
        const prsParaPresenca = []
        for (const pr of doIssue) {
          prsParaPresenca.push({
            numero: pr.numero,
            shaMerge: pr.shaMerge,
            mergeadoEm: pr.mergeadoNoGitHub,
            comparacao:
              pr.shaMerge === null
                ? ('indisponivel' as const)
                : await comparar(pr.shaMerge, versao.commitSha),
          })
        }
        const { estado, motivo } = presencaDeIssueNaVersao({
          issue: { numero: issue.numero, estado: issue.estado },
          versao: { commitSha: versao.commitSha, criadaEm: versao.criadaEm },
          prsMergeados: prsParaPresenca,
          confirmacaoManual: null,
        })
        calculadas.push({
          issueId: issue.id,
          versaoId: versao.id,
          existe: atual !== undefined,
          estado,
          motivo,
          assinaturaEntrada,
        })
      }
    }
    await db.$transaction(async (tx) => {
      for (const l of calculadas) {
        const dados = {
          estado: l.estado,
          motivo: l.motivo,
          assinaturaEntrada: l.assinaturaEntrada,
          calculadaEm: agora,
        }
        if (l.existe) {
          await tx.presencaIssueVersao.updateMany({
            where: { issueId: l.issueId, versaoId: l.versaoId, confirmadaPorId: null },
            data: dados,
          })
        } else {
          await tx.presencaIssueVersao.create({
            data: { issueId: l.issueId, versaoId: l.versaoId, ...dados },
          })
        }
      }
    })
  } catch (erro) {
    paraErroDeIntegracao(erro) // registra, sem mensagem, o que não for falha de integração
    return { resultado: 'falha', calculadas: 0 }
  }
  return { resultado: 'ok', calculadas: calculadas.length }
}

export async function calcularPresencasDoRepositorio(
  fonte: FonteGitHub | null,
  repositorioId: string,
  agora: Date,
  intervaloMs: number,
): Promise<Resultado> {
  return (await calcular(fonte, repositorioId, agora, intervaloMs)).resultado
}

export async function calcularPresencas(
  fonte: FonteGitHub | null,
  agora: Date,
  intervaloMs: number,
): Promise<{ repositorios: number; calculadas: number; falhas: number }> {
  const resumo = { repositorios: 0, calculadas: 0, falhas: 0 }
  const candidatos = await db.repositorioGitHub.findMany({
    where: {
      projetoId: { not: null },
      removidoDaInstalacaoEm: null,
      projeto: { ambientes: { some: {} } },
    },
    orderBy: { nomeCompleto: 'asc' },
  })
  for (const repo of candidatos) {
    const { resultado, calculadas } = await calcular(fonte, repo.id, agora, intervaloMs)
    if (resultado === 'ignorado') {
      continue
    }
    resumo.repositorios += 1
    resumo.calculadas += calculadas
    if (resultado === 'falha') {
      resumo.falhas += 1
    }
  }
  return resumo
}
