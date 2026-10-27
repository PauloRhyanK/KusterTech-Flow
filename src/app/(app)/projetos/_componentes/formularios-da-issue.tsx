'use client'

import { useActionState } from 'react'
import {
  adicionarIssuesAMilestoneAction,
  marcarForaDoEscopoAction,
  registrarCorrecaoAction,
  type EstadoEntregas,
} from '@/app/(app)/projetos/_acoes/entregas'
import { Button } from '@/components/ui/button'
import type { MilestoneDaIssue } from '@/modules/entregas/queries'
import { MensagensDeEstado } from './mensagens-de-estado'

// Formulários da página da issue: client components com props serializáveis (a página é um
// server component e não pode passar funções, como as rotas, a um componente de cliente).
const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

export function FormularioForaDoEscopo({
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

export function FormularioAdicionar({
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

export function FormularioDeCorrecao({
  projetoId,
  issueId,
  repositorios,
}: {
  projetoId: string
  issueId: string
  repositorios: readonly { id: string; nomeCompleto: string }[]
}) {
  const [estado, formAction, pendente] = useActionState<EstadoEntregas, FormData>(
    registrarCorrecaoAction,
    {},
  )

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="projetoId" value={projetoId} />
      <input type="hidden" name="issueCorrecaoId" value={issueId} />
      <p className="text-sm font-medium text-text-primary">Esta issue corrige</p>
      <div className="space-y-1">
        <label
          htmlFor="correcao-repositorio"
          className="block text-sm font-medium text-text-primary"
        >
          Repositório
        </label>
        <select
          id="correcao-repositorio"
          name="repositorioOriginalId"
          required
          className={CLASSE_CAMPO}
        >
          {repositorios.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nomeCompleto}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="correcao-numero" className="block text-sm font-medium text-text-primary">
          Número
        </label>
        <input
          id="correcao-numero"
          name="numeroOriginal"
          type="number"
          min={1}
          max={999999999}
          step={1}
          required
          className={CLASSE_CAMPO}
        />
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
        Registrar correção
      </Button>
    </form>
  )
}
