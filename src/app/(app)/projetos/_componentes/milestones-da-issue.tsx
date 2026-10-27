import Link from 'next/link'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { voltarAoEscopoAction } from '@/app/(app)/projetos/_acoes/entregas'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import type { MilestoneDaIssue } from '@/modules/entregas/queries'
import type { RotasDoProjeto } from '@/modules/projetos/model'
import { FormularioAdicionar, FormularioForaDoEscopo } from './formularios-da-issue'

export interface MilestonesDaIssueProps {
  projetoId: string
  issueId: string
  rotas: RotasDoProjeto
  milestones: readonly MilestoneDaIssue[]
  milestonesDisponiveis: readonly { id: string; titulo: string }[]
  podeGerenciar: boolean
}

export function MilestonesDaIssue({
  projetoId,
  issueId,
  rotas,
  milestones,
  milestonesDisponiveis,
  podeGerenciar,
}: MilestonesDaIssueProps) {
  return (
    <section className="space-y-3 rounded-padrao border border-border bg-surface p-4">
      <h2 className="text-[15px] font-[600] text-text-primary">Milestones</h2>
      {milestones.length === 0 ? (
        <p className="text-sm text-text-secondary">Esta issue não está em nenhuma milestone.</p>
      ) : (
        <ul className="space-y-4">
          {milestones.map((m) => (
            <li key={m.id} className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link href={rotas.milestone(m.id)} className="text-text-link hover:underline">
                  {m.titulo}
                </Link>
                <BadgeDeEstado tom="neutro">
                  {m.origem === 'HERANCA_CORRECAO' ? 'Correção herdada' : 'Vínculo manual'}
                </BadgeDeEstado>
                {m.arquivadaEm && <BadgeDeEstado tom="neutro">Arquivada</BadgeDeEstado>}
              </div>
              {m.foraDoEscopo && (
                <p className="text-text-secondary">
                  Fora do escopo — {m.justificativaForaDoEscopo}
                </p>
              )}
              {podeGerenciar && m.arquivadaEm === null && m.origem === 'HERANCA_CORRECAO' && (
                <>
                  {m.foraDoEscopo ? (
                    <BotaoDeConfirmacao
                      rotulo="Voltar ao escopo"
                      rotuloDeConfirmacao="Confirmar volta ao escopo"
                      action={voltarAoEscopoAction}
                      camposOcultos={{ projetoId, milestoneId: m.id, issueId }}
                    />
                  ) : (
                    <FormularioForaDoEscopo projetoId={projetoId} milestone={m} issueId={issueId} />
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {podeGerenciar && milestonesDisponiveis.length > 0 && (
        <FormularioAdicionar
          projetoId={projetoId}
          issueId={issueId}
          disponiveis={milestonesDisponiveis}
        />
      )}
    </section>
  )
}
