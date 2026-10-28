'use client'

import { useActionState } from 'react'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import { apresentarSeveridade, type SeveridadeAlerta } from '@/modules/infra/model'
import { registrarAlertaAction } from '../actions'

export interface FormularioAlertaProps {
  recursos: readonly { id: string; nome: string }[]
  projetos: readonly { id: string; nome: string }[]
}

const SEVERIDADES: readonly SeveridadeAlerta[] = ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA']
const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

function Campo({
  id,
  rotulo,
  children,
}: {
  id: string
  rotulo: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-text-primary">
        {rotulo}
      </label>
      {children}
    </div>
  )
}

export function FormularioAlerta({ recursos, projetos }: FormularioAlertaProps) {
  const [estado, registrar, pendente] = useActionState(registrarAlertaAction, {})

  return (
    <form action={registrar} className="max-w-xl space-y-4">
      <MensagensDeEstado estado={estado} />
      <Campo id="alerta-titulo" rotulo="Título">
        <input
          id="alerta-titulo"
          name="titulo"
          type="text"
          required
          maxLength={200}
          className={CLASSE_CAMPO}
        />
      </Campo>
      <Campo id="alerta-severidade" rotulo="Severidade">
        <select
          id="alerta-severidade"
          name="severidade"
          defaultValue="MEDIA"
          className={CLASSE_CAMPO}
        >
          {SEVERIDADES.map((s) => (
            <option key={s} value={s}>
              {apresentarSeveridade(s).texto}
            </option>
          ))}
        </select>
      </Campo>
      <Campo id="alerta-recurso" rotulo="Recurso">
        <select id="alerta-recurso" name="recursoId" defaultValue="" className={CLASSE_CAMPO}>
          <option value="">Nenhum</option>
          {recursos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome}
            </option>
          ))}
        </select>
      </Campo>
      <Campo id="alerta-projeto" rotulo="Projeto">
        <select id="alerta-projeto" name="projetoId" defaultValue="" className={CLASSE_CAMPO}>
          <option value="">Nenhum</option>
          {projetos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </Campo>
      <Campo id="alerta-detalhe" rotulo="Detalhe">
        <textarea
          id="alerta-detalhe"
          name="detalhe"
          rows={3}
          maxLength={2000}
          className={CLASSE_CAMPO}
        />
      </Campo>
      <Button
        type="submit"
        aria-busy={pendente}
        onClick={(e) => {
          if (pendente) {
            e.preventDefault()
          }
        }}
      >
        Registrar alerta
      </Button>
    </form>
  )
}
