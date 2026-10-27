import { db } from '@/lib/db'
import { evidenciaVigente, type EvidenciaParaEstado } from '@/modules/ambientes/model'

export interface VersaoCorrente {
  id: string
  rotulo: string
}

// Versão corrente de QA por repositório: a do SUCESSO mais recente no Ambiente QA do projeto.
// FALHA e EM_ANDAMENTO não mudam a versão corrente (decisão 1 do 5a).
export async function versoesCorrentesEmQA(
  projetoId: string,
): Promise<Map<string, VersaoCorrente>> {
  const evidencias = await db.evidenciaDeploy.findMany({
    where: {
      ambiente: { projetoId, tipo: 'QA' },
      versao: { projetoId },
    },
    select: {
      versaoId: true,
      origem: true,
      situacao: true,
      ocorridaEm: true,
      registradaEm: true,
      versao: { select: { rotulo: true, repositorioId: true } },
    },
  })

  const porRepositorio = new Map<string, EvidenciaParaEstado[]>()
  for (const e of evidencias) {
    const lista = porRepositorio.get(e.versao.repositorioId) ?? []
    lista.push({
      versaoId: e.versaoId,
      rotulo: e.versao.rotulo,
      origem: e.origem,
      situacao: e.situacao,
      ocorridaEm: e.ocorridaEm,
      registradaEm: e.registradaEm,
    })
    porRepositorio.set(e.versao.repositorioId, lista)
  }

  const correntes = new Map<string, VersaoCorrente>()
  for (const [repositorioId, lista] of porRepositorio) {
    const vigente = evidenciaVigente(lista)
    if (vigente) {
      correntes.set(repositorioId, { id: vigente.versaoId, rotulo: vigente.rotulo })
    }
  }
  return correntes
}

export async function obterVersaoCorrenteEmQA(
  projetoId: string,
  repositorioId: string,
): Promise<VersaoCorrente | null> {
  return (await versoesCorrentesEmQA(projetoId)).get(repositorioId) ?? null
}
