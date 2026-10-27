'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { registrarCorrecaoAction, type EstadoEntregas } from '@/app/(app)/projetos/_acoes/entregas'
import { Button } from '@/components/ui/button'
import type { IssueRelacionada } from '@/modules/entregas/queries'
import type { RotasDoProjeto } from '@/modules/projetos/model'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface CorrecoesDaIssueProps {
  projetoId: string
  issueId: string
  rotas: RotasDoProjeto
  corrige: readonly IssueRelacionada[]
  corrigidaPor: readonly IssueRelacionada[]
  repositorios: readonly { id: string; nomeCompleto: string }[]
  podeGerenciar: boolean
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

function Relacionadas({
  rotulo,
  issues,
  rotas,
}: {
  rotulo: string
  issues: readonly IssueRelacionada[]
  rotas: RotasDoProjeto
}) {
  if (issues.length === 0) {
    return null
  }
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium text-text-secondary">{rotulo}</h3>
      <ul className="space-y-1">
        {issues.map((i) => (
          <li key={i.id} className="text-sm">
            <Link href={rotas.issue(i.id)} className="text-text-link hover:underline">
              #{i.numero} {i.titulo}
            </Link>{' '}
            <span className="text-text-secondary">({i.repositorio})</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FormularioDeCorrecao({
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

export function CorrecoesDaIssue({
  projetoId,
  issueId,
  rotas,
  corrige,
  corrigidaPor,
  repositorios,
  podeGerenciar,
}: CorrecoesDaIssueProps) {
  return (
    <section className="space-y-3 rounded-padrao border border-border bg-surface p-4">
      <h2 className="text-[15px] font-[600] text-text-primary">Correções relacionadas</h2>
      {corrige.length === 0 && corrigidaPor.length === 0 ? (
        <p className="text-sm text-text-secondary">Nenhuma correção relacionada.</p>
      ) : (
        <>
          <Relacionadas rotulo="Corrige" issues={corrige} rotas={rotas} />
          <Relacionadas rotulo="Corrigida por" issues={corrigidaPor} rotas={rotas} />
        </>
      )}
      {podeGerenciar && repositorios.length > 0 && (
        <FormularioDeCorrecao projetoId={projetoId} issueId={issueId} repositorios={repositorios} />
      )}
    </section>
  )
}
