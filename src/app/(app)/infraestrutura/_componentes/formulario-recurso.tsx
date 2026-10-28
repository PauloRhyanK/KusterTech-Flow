'use client'

import { useActionState, useState } from 'react'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import { rotuloDoTipo, type TipoRecurso } from '@/modules/infra/model'

export interface EstadoFormularioRecurso {
  erro?: string
  sucesso?: string
}

export interface ValoresDoRecurso {
  id: string
  tipo: TipoRecurso
  nome: string
  identificadorExterno: string | null
  descricao: string | null
  urlBeszel: string | null
  urlGlitchTip: string | null
  urlHostDocker: string | null
  hospedadoEmId: string | null
}

export interface FormularioRecursoProps {
  action: (estado: EstadoFormularioRecurso, form: FormData) => Promise<EstadoFormularioRecurso>
  hospedeiros: readonly { id: string; nome: string }[]
  rotuloDoBotao: 'Cadastrar recurso' | 'Salvar alterações'
  // Presente só na edição: o tipo não muda depois do cadastro.
  recurso?: ValoresDoRecurso
}

const TIPOS: readonly TipoRecurso[] = ['SERVIDOR', 'CONTAINER', 'BANCO', 'STORAGE', 'OUTRO']
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

export function FormularioRecurso({
  action,
  hospedeiros,
  rotuloDoBotao,
  recurso,
}: FormularioRecursoProps) {
  const [estado, formAction, pendente] = useActionState(action, {})
  const [tipoEscolhido, setTipoEscolhido] = useState<TipoRecurso>('SERVIDOR')
  const tipo = recurso?.tipo ?? tipoEscolhido

  return (
    <div className="rounded-padrao border border-border bg-surface p-6">
      <form action={formAction} className="max-w-xl space-y-4">
        <MensagensDeEstado estado={estado} />

        {recurso ? (
          <input type="hidden" name="recursoId" value={recurso.id} />
        ) : (
          <Campo id="tipo" rotulo="Tipo">
            <select
              id="tipo"
              name="tipo"
              value={tipoEscolhido}
              onChange={(e) => setTipoEscolhido(e.target.value as TipoRecurso)}
              className={CLASSE_CAMPO}
            >
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {rotuloDoTipo(t)}
                </option>
              ))}
            </select>
          </Campo>
        )}

        <Campo id="nome" rotulo="Nome">
          <input
            id="nome"
            name="nome"
            type="text"
            required
            maxLength={120}
            defaultValue={recurso?.nome ?? ''}
            className={CLASSE_CAMPO}
          />
        </Campo>

        <Campo
          id="identificadorExterno"
          rotulo="Identificador externo"
          ajuda="Opcional. Por exemplo, o id do container ou o hostname."
        >
          <input
            id="identificadorExterno"
            name="identificadorExterno"
            type="text"
            maxLength={200}
            aria-describedby="ajuda-identificadorExterno"
            defaultValue={recurso?.identificadorExterno ?? ''}
            className={CLASSE_CAMPO}
          />
        </Campo>

        <Campo id="descricao" rotulo="Descrição" ajuda="Opcional. Até 2000 caracteres.">
          <textarea
            id="descricao"
            name="descricao"
            rows={3}
            maxLength={2000}
            aria-describedby="ajuda-descricao"
            defaultValue={recurso?.descricao ?? ''}
            className={CLASSE_CAMPO}
          />
        </Campo>

        {tipo !== 'SERVIDOR' && (
          <Campo id="hospedadoEmId" rotulo="Hospedado em">
            <select
              id="hospedadoEmId"
              name="hospedadoEmId"
              defaultValue={recurso?.hospedadoEmId ?? ''}
              className={CLASSE_CAMPO}
            >
              <option value="">Nenhum</option>
              {hospedeiros.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.nome}
                </option>
              ))}
            </select>
          </Campo>
        )}

        <Campo id="urlBeszel" rotulo="Endereço do Beszel">
          <input
            id="urlBeszel"
            name="urlBeszel"
            type="url"
            maxLength={500}
            defaultValue={recurso?.urlBeszel ?? ''}
            className={CLASSE_CAMPO}
          />
        </Campo>
        <Campo id="urlGlitchTip" rotulo="Endereço do GlitchTip">
          <input
            id="urlGlitchTip"
            name="urlGlitchTip"
            type="url"
            maxLength={500}
            defaultValue={recurso?.urlGlitchTip ?? ''}
            className={CLASSE_CAMPO}
          />
        </Campo>
        <Campo id="urlHostDocker" rotulo="Endereço do host Docker">
          <input
            id="urlHostDocker"
            name="urlHostDocker"
            type="url"
            maxLength={500}
            defaultValue={recurso?.urlHostDocker ?? ''}
            className={CLASSE_CAMPO}
          />
        </Campo>

        <div className="pt-2">
          <Button
            type="submit"
            aria-busy={pendente}
            onClick={(e) => {
              if (pendente) {
                e.preventDefault()
              }
            }}
          >
            {rotuloDoBotao}
          </Button>
        </div>
      </form>
    </div>
  )
}
