'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import {
  adicionarIssuesAMilestoneAction,
  marcarForaDoEscopoAction,
  voltarAoEscopoAction,
  type EstadoEntregas,
} from '@/app/(app)/projetos/_acoes/entregas'
import { Button } from '@/components/ui/button'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import type { MilestoneDaIssue } from '@/modules/entregas/queries'
import type { RotasDoProjeto } from '@/modules/projetos/model'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface MilestonesDaIssueProps {
  projetoId: string
  issueId: string
  rotas: RotasDoProjeto
  milestones: readonly MilestoneDaIssue[]
  milestonesDisponiveis: readonly { id: string; titulo: string }[]
  podeGerenciar: boolean
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

function FormularioForaDoEscopo({
  projetoId,
  milestone,
  issueId,
}: {
  projetoId: string
  milestone: MilestoneDaIssue
  issueId: string
}) {
  const [estado, formAction, pendente] = useActionState<EstadoEntregas, FormData>(
    marcarForaDoEscopoAction,
    {},
  )
  const idDoCampo = `justificativa-${milestone.id}`

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="projetoId" value={projetoId} />
      <input type="hidden" name="milestoneId" value={milestone.id} />
      <input type="hidden" name="issueId" value={issueId} />
      <div className="space-y-1">
        <label htmlFor={idDoCampo} className="block text-sm font-medium text-text-primary">
          Justificativa
        </label>
        <textarea
          id={idDoCampo}
          name="justificativa"
          required
          maxLength={500}
          rows={2}
          className={CLASSE_CAMPO}
        />
      </div>
      <MensagensDeEstado estado={estado} />
      <Button
        type="submit"
        variant="outline"
        aria-busy={pendente}
        onClick={(e) => {
          if (pendente) {
            e.preventDefault()
          }
        }}
      >
        Marcar fora do escopo de {milestone.titulo}
      </Button>
    </form>
  )
}

function FormularioAdicionar({
  projetoId,
  issueId,
  disponiveis,
}: {
  projetoId: string
  issueId: string
  disponiveis: readonly { id: string; titulo: string }[]
}) {
  const [estado, formAction, pendente] = useActionState<EstadoEntregas, FormData>(
    adicionarIssuesAMilestoneAction,
    {},
  )

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="projetoId" value={projetoId} />
      <input type="hidden" name="issueIds" value={issueId} />
      <div className="space-y-1">
        <label htmlFor="milestone-da-issue" className="block text-sm font-medium text-text-primary">
          Milestone
        </label>
        <select id="milestone-da-issue" name="milestoneId" required className={CLASSE_CAMPO}>
          {disponiveis.map((m) => (
            <option key={m.id} value={m.id}>
              {m.titulo}
            </option>
          ))}
        </select>
      </div>
      <MensagensDeEstado estado={estado} />
      <Button
        type="submit"
        aria-busy={pendente}
        onClick={(e) => {
          if (pendente) {
            e.preventDefault()
          }
        }}
      >
        Adicionar à milestone
      </Button>
    </form>
  )
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
