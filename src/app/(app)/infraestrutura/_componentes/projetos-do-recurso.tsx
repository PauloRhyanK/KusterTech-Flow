'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { associarProjetoAoRecursoAction, desassociarProjetoDoRecursoAction } from '../actions'

export interface ProjetosDoRecursoProps {
  recursoId: string
  recursoArquivado: boolean
  projetos: readonly { id: string; nome: string; arquivado: boolean }[]
  disponiveis: readonly { id: string; nome: string }[]
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

export function ProjetosDoRecurso({
  recursoId,
  recursoArquivado,
  projetos,
  disponiveis,
}: ProjetosDoRecursoProps) {
  const [estadoAssociar, associar, pendenteAssociar] = useActionState(
    associarProjetoAoRecursoAction,
    {},
  )
  const [estadoDesassociar, desassociar, pendenteDesassociar] = useActionState(
    desassociarProjetoDoRecursoAction,
    {},
  )

  return (
    <section className="space-y-3 rounded-padrao border border-border bg-surface p-4">
      <h2 className="text-[15px] font-[600] text-text-primary">Projetos associados</h2>
      <MensagensDeEstado estado={{ ...estadoDesassociar, ...estadoAssociar }} />
      {projetos.length === 0 ? (
        <p className="text-sm text-text-secondary">Nenhum projeto associado.</p>
      ) : (
        <ul aria-label="Projetos associados" className="divide-y divide-border">
          {projetos.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex items-center gap-1.5 text-sm">
                <Link href={`/projetos/${p.id}`} className="text-text-link hover:underline">
                  {p.nome}
                </Link>
                {p.arquivado && <BadgeDeEstado tom="neutro">Arquivado</BadgeDeEstado>}
              </span>
              <BotaoDeConfirmacao
                rotulo="Desassociar"
                rotuloDeConfirmacao="Confirmar desassociação"
                action={desassociar}
                pendente={pendenteDesassociar}
                camposOcultos={{ recursoId, projetoId: p.id }}
              />
            </li>
          ))}
        </ul>
      )}
      {recursoArquivado ? (
        <p className="text-sm text-text-secondary">Recurso arquivado não recebe novos projetos.</p>
      ) : (
        disponiveis.length > 0 && (
          <form action={associar} className="space-y-2">
            <input type="hidden" name="recursoId" value={recursoId} />
            <div className="space-y-1">
              <label
                htmlFor="projetoId-associar"
                className="block text-sm font-medium text-text-primary"
              >
                Projeto
              </label>
              <select id="projetoId-associar" name="projetoId" required className={CLASSE_CAMPO}>
                {disponiveis.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="submit"
              variant="outline"
              aria-busy={pendenteAssociar}
              onClick={(e) => {
                if (pendenteAssociar) {
                  e.preventDefault()
                }
              }}
            >
              Associar
            </Button>
          </form>
        )
      )}
    </section>
  )
}
