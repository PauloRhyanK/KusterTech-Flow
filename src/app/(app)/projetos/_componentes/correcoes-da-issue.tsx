import Link from 'next/link'
import type { IssueRelacionada } from '@/modules/entregas/queries'
import type { RotasDoProjeto } from '@/modules/projetos/model'
import { FormularioDeCorrecao } from './formularios-da-issue'

export interface CorrecoesDaIssueProps {
  projetoId: string
  issueId: string
  rotas: RotasDoProjeto
  corrige: readonly IssueRelacionada[]
  corrigidaPor: readonly IssueRelacionada[]
  repositorios: readonly { id: string; nomeCompleto: string }[]
  podeGerenciar: boolean
}

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
