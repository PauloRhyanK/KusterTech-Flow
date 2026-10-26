import { cache } from 'react'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { listarClientesParaSelecao } from '@/modules/clientes/queries'
import { contarRepositoriosPorProjeto, obterResumoGitHubDoProjeto } from '@/modules/github/queries'
import type { EstadoIntegracao } from '@/modules/github/model'
import { calcularChecklist, type ContagensDoProjeto, type Contexto } from './model'
import { listarProjetos, obterProjeto, type ProjetoResumo } from './service'

export const CONTAGENS_AINDA_SEM_FONTE = {
  ambientes: 0,
  milestones: 0,
} as const

export async function listarProjetosParaTela(
  sujeito: Sujeito,
  busca?: string,
): Promise<(ProjetoResumo & { configuracaoPendente: boolean })[]> {
  const projetos = await listarProjetos(sujeito, busca ? { busca } : undefined)
  const repositoriosPorProjeto = await contarRepositoriosPorProjeto(sujeito)

  return projetos.map((projeto) => {
    const contagens: ContagensDoProjeto = {
      clientes: projeto.clientes.length,
      repositorios: repositoriosPorProjeto.get(projeto.id) ?? 0,
      ...CONTAGENS_AINDA_SEM_FONTE,
    }
    // Só o estado "pendente" interessa aqui; o estado da integração não o altera.
    const checklist = calcularChecklist(contagens, null, 'nao-configurada')
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
    clienteId: string | null,
  ): Promise<ProjetoResumo & { contagens: ContagensDoProjeto; estadoGitHub: EstadoIntegracao }> => {
    const contexto: Contexto =
      clienteId === null ? { tipo: 'global' } : { tipo: 'cliente', clienteId }
    const projeto = await obterProjeto(sujeito, projetoId, contexto)

    // Repositórios e estado da integração só existem na visão global (decisão 5, invariante 10).
    const github =
      clienteId === null
        ? await obterResumoGitHubDoProjeto(sujeito, projetoId)
        : { repositorios: 0, estado: 'nao-configurada' as const }

    const contagens: ContagensDoProjeto = {
      clientes: projeto.clientes.length,
      repositorios: github.repositorios,
      ...CONTAGENS_AINDA_SEM_FONTE,
    }

    return {
      ...projeto,
      contagens,
      estadoGitHub: github.estado,
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
