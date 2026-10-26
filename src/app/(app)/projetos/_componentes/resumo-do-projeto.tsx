import Link from 'next/link'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { cn } from '@/lib/utils'
import type { EstadoIntegracao } from '@/modules/github/model'
import { calcularChecklist, type ContagensDoProjeto, type Contexto } from '@/modules/projetos/model'
import type { ProjetoResumo } from '@/modules/projetos/service'
import { ChecklistDeConfiguracao } from './checklist-de-configuracao'

export interface ResumoDoProjetoProps {
  projeto: ProjetoResumo
  contagens: ContagensDoProjeto
  estadoGitHub?: EstadoIntegracao
  contexto: Contexto
  podeGerenciar: boolean
  cliente?: { id: string; nome: string }
  className?: string
}

export function ResumoDoProjeto({
  projeto,
  contagens,
  estadoGitHub = 'nao-configurada',
  contexto,
  podeGerenciar,
  cliente,
  className,
}: ResumoDoProjetoProps) {
  const nomeDoCliente =
    cliente?.nome ??
    (contexto.tipo === 'cliente'
      ? (projeto.clientes.find((c) => c.id === contexto.clienteId)?.nome ?? '')
      : '')

  return (
    <div className={cn('space-y-8', className)}>
      {/* 1. Próximas ações */}
      <section className="space-y-3">
        <h2 className="text-[18px] font-[600] leading-[1.3] text-text-primary">Próximas ações</h2>
        {contexto.tipo === 'global' ? (
          <ChecklistDeConfiguracao
            itens={calcularChecklist(
              contagens,
              podeGerenciar ? `/projetos/${projeto.id}/configuracao` : null,
              estadoGitHub,
            )}
          />
        ) : (
          <EstadoVazio
            tipo="nao-configurado"
            titulo="Nenhuma ação pendente para este cliente."
            descricao="Ações de homologação chegam no Incremento 5a."
          />
        )}
      </section>

      {/* 2. Entregas */}
      <section className="space-y-3">
        <h2 className="text-[18px] font-[600] leading-[1.3] text-text-primary">Entregas</h2>
        <EstadoVazio
          tipo="nao-configurado"
          titulo="Nenhuma entrega registrada."
          descricao="Milestones e entregas chegam no Incremento 3."
        />
      </section>

      {/* 3. Indicadores */}
      <section className="space-y-3">
        <h2 className="text-[18px] font-[600] leading-[1.3] text-text-primary">Indicadores</h2>
        <div className="rounded-lg border border-border bg-surface p-4">
          <BadgeDeEstado tom="neutro">Sem dados</BadgeDeEstado>
        </div>
      </section>

      {/* 4. Clientes */}
      <section className="space-y-3">
        <h2 className="text-[18px] font-[600] leading-[1.3] text-text-primary">Clientes</h2>
        {contexto.tipo === 'global' ? (
          projeto.clientes.length > 0 ? (
            <ul role="list" aria-label="Clientes associados" className="space-y-2">
              {projeto.clientes.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface p-3"
                >
                  <Link
                    href={`/clientes/${c.id}/projetos/${projeto.id}`}
                    className="text-sm font-medium text-text-link hover:underline"
                  >
                    {c.nome}
                  </Link>
                  {c.arquivadoEm && <BadgeDeEstado tom="neutro">Arquivado</BadgeDeEstado>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-sm text-text-secondary">Nenhum cliente associado.</p>
            </div>
          )
        ) : (
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-sm text-text-secondary">
              Você está vendo este projeto no contexto de {nomeDoCliente}.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
