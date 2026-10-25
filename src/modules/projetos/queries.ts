import { cache } from 'react'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { listarClientesParaSelecao } from '@/modules/clientes/queries'
import { calcularChecklist, type ContagensDoProjeto, type Contexto } from './model'
import { listarProjetos, obterProjeto, type ProjetoResumo } from './service'

export const CONTAGENS_AINDA_SEM_FONTE = {
  repositorios: 0,
  ambientes: 0,
  milestones: 0,
} as const

export async function listarProjetosParaTela(
  sujeito: Sujeito,
  busca?: string,
): Promise<(ProjetoResumo & { configuracaoPendente: boolean })[]> {
  const projetos = await listarProjetos(sujeito, busca ? { busca } : undefined)

  return projetos.map((projeto) => {
    const contagens: ContagensDoProjeto = {
      clientes: projeto.clientes.length,
      ...CONTAGENS_AINDA_SEM_FONTE,
    }
    const checklist = calcularChecklist(contagens, null)
    const configuracaoPendente = checklist.some((item) => item.estado === 'pendente')

    return {
      ...projeto,
      configuracaoPendente,
    }
  })
}

export const obterProjetoParaResumo = cache(
  async (
    sujeito: Sujeito,
    projetoId: string,
    contexto: Contexto,
  ): Promise<ProjetoResumo & { contagens: ContagensDoProjeto }> => {
    const projeto = await obterProjeto(sujeito, projetoId, contexto)

    const contagens: ContagensDoProjeto = {
      clientes: projeto.clientes.length,
      ...CONTAGENS_AINDA_SEM_FONTE,
    }

    return {
      ...projeto,
      contagens,
    }
  },
)

export async function obterProjetoParaConfiguracao(
  sujeito: Sujeito,
  projetoId: string,
): Promise<ProjetoResumo & { clientesDisponiveis: { id: string; nome: string }[] }> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const projeto = await obterProjeto(sujeito, projetoId, { tipo: 'global' })
  const clientes = await listarClientesParaSelecao(sujeito)

  const associadosIds = new Set(projeto.clientes.map((c) => c.id))
  const clientesDisponiveis = clientes.filter((c) => !associadosIds.has(c.id))

  return {
    ...projeto,
    clientesDisponiveis,
  }
}
