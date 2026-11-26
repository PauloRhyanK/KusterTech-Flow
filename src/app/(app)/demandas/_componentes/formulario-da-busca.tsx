'use client'

import { useActionState } from 'react'
import { pedirBuscaAction, type EstadoDoPedido } from '@/app/(app)/demandas/busca/actions'
import { Button } from '@/components/ui/button'
import type { TelaDeDemandas } from '@/modules/demandas/apresentacao'

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'
const CLASSE_ROTULO = 'mb-1 block text-[11.5px] text-text-tertiary'

const PERIODOS = [
  { valor: 'tudo', rotulo: 'Tudo' },
  { valor: '90d', rotulo: '90 dias' },
  { valor: '30d', rotulo: '30 dias' },
]

function Seletor({
  nome,
  rotulo,
  opcoes,
  todos = true,
}: {
  nome: string
  rotulo: string
  opcoes: readonly { valor: string; rotulo: string }[]
  todos?: boolean
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={`busca-${nome}`} className={CLASSE_ROTULO}>
        {rotulo}
      </label>
      <select
        id={`busca-${nome}`}
        name={nome}
        defaultValue={todos ? '' : opcoes[0]?.valor}
        className={`${CLASSE_CAMPO} h-9 py-0`}
      >
        {todos && <option value="">Todos</option>}
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </div>
  )
}

/** O pedido da busca: a pergunta em português e, se quiser, um recorte. */
export function FormularioDaBusca({
  opcoes,
  restantesHoje,
}: {
  opcoes: TelaDeDemandas['opcoes']
  restantesHoje: number
}) {
  const [estado, pedir, pedindo] = useActionState<EstadoDoPedido, FormData>(pedirBuscaAction, {
    erro: null,
  })
  const esgotado = restantesHoje <= 0
  return (
    <form action={pedir} className="space-y-3 rounded-padrao border border-border bg-surface p-4">
      <div>
        <label htmlFor="busca-pergunta" className="block text-sm font-medium text-text-primary">
          O que você procura?
        </label>
        <p className="mt-0.5 text-xs text-text-tertiary">
          Descreva com suas palavras. A IA lê as demandas e diz se alguma já trata disso.
        </p>
        <textarea
          id="busca-pergunta"
          name="pergunta"
          required
          minLength={3}
          maxLength={500}
          rows={3}
          className={`${CLASSE_CAMPO} mt-2 resize-y`}
        />
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Seletor nome="projeto" rotulo="Projeto" opcoes={opcoes.projetos} />
        <Seletor nome="cliente" rotulo="Cliente" opcoes={opcoes.clientes} />
        <Seletor nome="periodo" rotulo="Período" opcoes={PERIODOS} todos={false} />
      </div>
      {estado.erro && (
        <p role="alert" className="text-sm text-erro">
          {estado.erro}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={esgotado || pedindo}>
          Buscar com IA
        </Button>
        <span className="text-xs text-text-tertiary">
          {esgotado
            ? 'Limite de buscas de hoje atingido.'
            : `Restam ${restantesHoje} ${restantesHoje === 1 ? 'busca' : 'buscas'} hoje.`}
        </span>
      </div>
    </form>
  )
}
