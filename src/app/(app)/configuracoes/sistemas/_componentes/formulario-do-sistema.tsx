'use client'

import { useActionState, useState } from 'react'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import type { ProjetoParaSistema } from '@/modules/relatos/queries'

export interface EstadoDoFormulario {
  erro?: string
  sucesso?: string
}

export interface ValoresDoSistema {
  id: string
  nome: string
  url: string
  projetoId: string
  repositorioId: string
}

export interface FormularioDoSistemaProps {
  action: (estado: EstadoDoFormulario, form: FormData) => Promise<EstadoDoFormulario>
  projetos: readonly ProjetoParaSistema[]
  /** Presente só na edição. */
  sistema?: ValoresDoSistema
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

function Campo({
  id,
  rotulo,
  ajuda,
  children,
}: {
  id: string
  rotulo: string
  ajuda?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-text-primary">
        {rotulo}
      </label>
      {children}
      {ajuda && (
        <p id={`ajuda-${id}`} className="text-xs text-text-secondary">
          {ajuda}
        </p>
      )}
    </div>
  )
}

export function FormularioDoSistema({ action, projetos, sistema }: FormularioDoSistemaProps) {
  const [estado, formAction, pendente] = useActionState(action, {})
  const [projetoId, setProjetoId] = useState(sistema?.projetoId ?? projetos[0]?.id ?? '')
  const repositorios = projetos.find((p) => p.id === projetoId)?.repositorios ?? []

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <MensagensDeEstado estado={estado} />
      {sistema && <input type="hidden" name="sistemaId" value={sistema.id} />}

      <Campo id="nome" rotulo="Nome">
        <input
          id="nome"
          name="nome"
          type="text"
          required
          maxLength={60}
          defaultValue={sistema?.nome ?? ''}
          className={CLASSE_CAMPO}
        />
      </Campo>

      <Campo
        id="url"
        rotulo="Endereço"
        ajuda="Endereço da API do sistema, com o prefixo da versão (ex.: /v1)."
      >
        <input
          id="url"
          name="url"
          type="url"
          required
          placeholder="https://sistema.exemplo.com/v1"
          aria-describedby="ajuda-url"
          defaultValue={sistema?.url ?? ''}
          className={CLASSE_CAMPO}
        />
      </Campo>

      <Campo id="projetoId" rotulo="Projeto">
        <select
          id="projetoId"
          name="projetoId"
          required
          value={projetoId}
          onChange={(e) => setProjetoId(e.target.value)}
          className={CLASSE_CAMPO}
        >
          {projetos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </Campo>

      {repositorios.length > 1 && (
        <Campo id="repositorioId" rotulo="Repositório das demandas">
          <select
            id="repositorioId"
            name="repositorioId"
            required
            defaultValue={sistema?.projetoId === projetoId ? sistema.repositorioId : ''}
            className={CLASSE_CAMPO}
          >
            <option value="">Escolha…</option>
            {repositorios.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
        </Campo>
      )}

      <Campo
        id="token"
        rotulo="Token"
        ajuda={sistema ? 'Deixe em branco para manter o token atual.' : undefined}
      >
        <input
          id="token"
          name="token"
          type="password"
          autoComplete="off"
          required={!sistema}
          aria-describedby={sistema ? 'ajuda-token' : undefined}
          className={CLASSE_CAMPO}
        />
      </Campo>

      <Button type="submit" aria-busy={pendente} disabled={pendente}>
        Salvar
      </Button>
    </form>
  )
}
