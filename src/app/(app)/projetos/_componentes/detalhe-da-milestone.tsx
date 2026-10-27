'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import {
  associarClienteAMilestoneAction,
  removerClienteDaMilestoneAction,
  type EstadoEntregas,
} from '@/app/(app)/projetos/_acoes/entregas'
import { Button } from '@/components/ui/button'
import { formatarData } from '@/lib/data'
import { BarraDeProgresso } from '@/lib/ui/barra-de-progresso'
import type { MilestoneDetalhada } from '@/modules/entregas/queries'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface DetalheDaMilestoneProps {
  milestone: MilestoneDetalhada
  podeGerenciar: boolean
  hrefConfiguracao: string | null
  cliente: { nome: string } | null
}

export function DetalheDaMilestone({
  milestone,
  podeGerenciar,
  hrefConfiguracao,
  cliente,
}: DetalheDaMilestoneProps) {
  const [estado, formAction, pendente] = useActionState<EstadoEntregas, FormData>(
    associarClienteAMilestoneAction,
    {},
  )
  const projetoId = milestone.projetoId

  return (
    <div className="space-y-6">
      <section aria-labelledby="resumo-da-milestone" className="space-y-3">
        <h2 id="resumo-da-milestone" className="text-lg font-semibold text-text-primary">
          Resumo
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="text-sm font-medium text-text-primary">Prazo</dt>
            <dd className="text-sm text-text-secondary">
              {milestone.prazo ? formatarData(milestone.prazo) : 'Sem prazo'}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-sm font-medium text-text-primary">Progresso de desenvolvimento</dt>
            <dd className="space-y-1">
              <BarraDeProgresso progresso={milestone.progresso} />
              <p className="text-xs text-text-secondary">
                Conta issues fechadas no GitHub; não indica disponibilidade em QA nem aprovação.
              </p>
            </dd>
          </div>
        </dl>
        {milestone.foraDaContagem > 0 && (
          <p className="text-sm text-text-secondary">
            {milestone.foraDaContagem === 1
              ? '1 issue de repositório desvinculado não entra na contagem.'
              : `${milestone.foraDaContagem} issues de repositórios desvinculados não entram na contagem.`}
          </p>
        )}
      </section>

      {cliente ? (
        <p className="text-sm text-text-secondary">
          Você está vendo esta milestone no contexto de {cliente.nome}.
        </p>
      ) : (
        <section aria-labelledby="clientes-da-milestone" className="space-y-3">
          <h2 id="clientes-da-milestone" className="text-lg font-semibold text-text-primary">
            Clientes
          </h2>
          {podeGerenciar && <MensagensDeEstado estado={estado} />}
          {milestone.clientes.length === 0 ? (
            <p className="text-sm text-text-secondary">
              Nenhum cliente associado a esta milestone.
            </p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {milestone.clientes.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm text-text-primary"
                >
                  <span>{c.nome}</span>
                  {podeGerenciar && (
                    <BotaoDeConfirmacao
                      rotulo="Remover cliente"
                      rotuloDeConfirmacao="Confirmar remoção"
                      action={removerClienteDaMilestoneAction}
                      camposOcultos={{ projetoId, milestoneId: milestone.id, clienteId: c.id }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {podeGerenciar &&
            (milestone.clientesDisponiveis.length > 0 ? (
              <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <input type="hidden" name="projetoId" value={projetoId} />
                <input type="hidden" name="milestoneId" value={milestone.id} />
                <div className="flex-1 space-y-1">
                  <label
                    htmlFor="milestone-cliente"
                    className="block text-sm font-medium text-text-primary"
                  >
                    Cliente
                  </label>
                  <select
                    id="milestone-cliente"
                    name="clienteId"
                    required
                    defaultValue=""
                    className="w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    <option value="" disabled>
                      Selecione um cliente
                    </option>
                    {milestone.clientesDisponiveis.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="submit"
                  aria-busy={pendente}
                  onClick={(e) => {
                    if (pendente) {
                      e.preventDefault()
                    }
                  }}
                >
                  Associar
                </Button>
              </form>
            ) : milestone.clientes.length === 0 ? (
              <p className="text-sm text-text-secondary">
                Associe clientes ao projeto na Configuração para relacioná-los a esta milestone.
                {hrefConfiguracao && (
                  <>
                    {' '}
                    <Link href={hrefConfiguracao} className="text-text-link hover:underline">
                      Abrir Configuração
                    </Link>
                  </>
                )}
              </p>
            ) : null)}
        </section>
      )}
    </div>
  )
}
