'use client'

import { useActionState, useState } from 'react'
import { definirDemandasDoProjetoAction } from '@/app/(app)/projetos/[p]/(detalhe)/configuracao/demandas-actions'
import { Button } from '@/components/ui/button'
import { ROTULO_DO_NIVEL } from '@/modules/demandas/apresentacao'
import { NIVEIS } from '@/modules/demandas/contrato'
import type { DemandasDoProjeto } from '@/modules/demandas/queries'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface DemandasNoProjetoProps extends DemandasDoProjeto {
  projetoId: string
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'
const CLASSE_ROTULO = 'block text-sm font-medium text-text-primary'

export function DemandasNoProjeto({
  projetoId,
  modeloId,
  nivelPadrao,
  modelos,
}: DemandasNoProjetoProps) {
  const [estado, salvar, salvando] = useActionState(definirDemandasDoProjetoAction, {})
  const [escolhido, setEscolhido] = useState(modeloId)
  const etapas = modelos.find((m) => m.id === escolhido)?.etapas ?? []

  return (
    <form
      action={salvar}
      className="max-w-md space-y-4 rounded-padrao border border-border bg-surface p-6"
    >
      <MensagensDeEstado estado={estado} />
      <input type="hidden" name="projetoId" value={projetoId} />

      <div className="space-y-1">
        <label htmlFor="demandas-modelo" className={CLASSE_ROTULO}>
          Modelo de etapas
        </label>
        <select
          id="demandas-modelo"
          name="modeloId"
          value={escolhido}
          onChange={(e) => setEscolhido(e.target.value)}
          aria-describedby="demandas-modelo-etapas"
          className={CLASSE_CAMPO}
        >
          {modelos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
        <p id="demandas-modelo-etapas" className="text-xs text-text-secondary">
          {etapas.map((e) => e.rotulo).join(' › ')}
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="demandas-nivel" className={CLASSE_ROTULO}>
          Nível padrão das demandas
        </label>
        <select
          id="demandas-nivel"
          name="nivelPadrao"
          defaultValue={nivelPadrao}
          className={CLASSE_CAMPO}
        >
          {NIVEIS.map((n) => (
            <option key={n} value={n}>
              {ROTULO_DO_NIVEL[n]}
            </option>
          ))}
        </select>
        <p className="text-xs text-text-secondary">
          As demandas que já existem seguem com as etapas que tinham.
        </p>
      </div>

      <Button type="submit" aria-busy={salvando} disabled={salvando}>
        Salvar
      </Button>
    </form>
  )
}
