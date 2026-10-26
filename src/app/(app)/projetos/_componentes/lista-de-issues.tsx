import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional, type LinhaOperacional } from '@/lib/ui/lista-operacional'
import type { IssueNaLista } from '@/modules/github/queries'

export interface ListaDeIssuesProps {
  projetoId: string
  issues: readonly IssueNaLista[]
  total: number
  comFiltros: boolean
}

export function ListaDeIssues({ projetoId, issues, total, comFiltros }: ListaDeIssuesProps) {
  const linhas: LinhaOperacional[] = issues.map((issue) => ({
    id: issue.id,
    href: `/projetos/${projetoId}/entregas/issues/${issue.id}`,
    nome: `#${issue.numero} ${issue.titulo}`,
    contexto: issue.repositorio,
    indicador: (
      <span className="text-xs text-text-secondary">
        {issue.totalDePullRequests === 1 ? '1 PR' : `${issue.totalDePullRequests} PRs`}
      </span>
    ),
    estado:
      issue.estado === 'ABERTA' ? (
        <BadgeDeEstado tom="informacao">Aberta</BadgeDeEstado>
      ) : (
        <BadgeDeEstado tom="neutro">Fechada</BadgeDeEstado>
      ),
  }))

  return (
    <div className="space-y-3">
      <ListaOperacional
        rotulo="Issues sem milestone"
        linhas={linhas}
        vazio={
          <EstadoVazio
            tipo="nenhum-registro"
            titulo={
              comFiltros ? 'Nenhuma issue com estes filtros.' : 'Nenhuma issue espelhada ainda.'
            }
            descricao={
              comFiltros
                ? 'Ajuste a situação, o repositório ou a busca.'
                : 'As issues aparecem aqui depois da primeira sincronização.'
            }
          />
        }
      />
      {total > issues.length && (
        <p className="text-sm text-text-secondary">
          Mostrando {issues.length} de {total} issues. Refine os filtros.
        </p>
      )}
    </div>
  )
}
