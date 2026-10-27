import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { removerIssueDaMilestoneAction } from '@/app/(app)/projetos/_acoes/entregas'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional, type LinhaOperacional } from '@/lib/ui/lista-operacional'
import type { IssueDaMilestone } from '@/modules/entregas/queries'
import type { RotasDoProjeto } from '@/modules/projetos/model'

export interface IssuesDaMilestoneProps {
  projetoId: string
  milestoneId: string
  rotas: RotasDoProjeto
  issues: readonly IssueDaMilestone[]
  podeGerenciar: boolean
  comFiltros: boolean
}

export function IssuesDaMilestone({
  projetoId,
  milestoneId,
  rotas,
  issues,
  podeGerenciar,
  comFiltros,
}: IssuesDaMilestoneProps) {
  const linhas: LinhaOperacional[] = issues.map((issue) => ({
    id: issue.id,
    href: rotas.issue(issue.id, milestoneId),
    nome: `#${issue.numero} ${issue.titulo}`,
    contexto: issue.repositorio,
    estado: (
      <span className="flex flex-wrap items-center gap-1.5">
        {issue.estado === 'ABERTA' ? (
          <BadgeDeEstado tom="informacao">Aberta</BadgeDeEstado>
        ) : (
          <BadgeDeEstado tom="neutro">Fechada</BadgeDeEstado>
        )}
        {issue.origem === 'HERANCA_CORRECAO' && (
          <BadgeDeEstado tom="neutro">Correção herdada</BadgeDeEstado>
        )}
        {issue.foraDoEscopo && <BadgeDeEstado tom="neutro">Fora do escopo</BadgeDeEstado>}
      </span>
    ),
    acoes:
      podeGerenciar && issue.origem === 'MANUAL' ? (
        <BotaoDeConfirmacao
          rotulo="Remover"
          rotuloDeConfirmacao="Confirmar remoção"
          action={removerIssueDaMilestoneAction}
          camposOcultos={{ projetoId, milestoneId, issueId: issue.id }}
        />
      ) : undefined,
  }))

  return (
    <ListaOperacional
      rotulo="Issues da milestone"
      linhas={linhas}
      vazio={
        <EstadoVazio
          tipo="nenhum-registro"
          titulo={
            comFiltros
              ? 'Nenhuma issue com estes filtros.'
              : 'Nenhuma issue vinculada a esta milestone.'
          }
          descricao={
            comFiltros
              ? 'Ajuste a situação ou o repositório.'
              : podeGerenciar
                ? 'Adicione issues dos repositórios do projeto.'
                : 'As issues aparecem aqui quando forem vinculadas à milestone.'
          }
        />
      }
    />
  )
}
