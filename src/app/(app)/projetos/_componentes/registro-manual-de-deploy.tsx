'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import type { TipoAmbiente } from '@/modules/ambientes/model'
import { registrarDeployManualAction } from '../ambientes-actions'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface RegistroManualDeDeployProps {
  projetoId: string
  ambientes: readonly TipoAmbiente[]
  repositorios: readonly { id: string; nomeCompleto: string }[]
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

export function RegistroManualDeDeploy({
  projetoId,
  ambientes,
  repositorios,
}: RegistroManualDeDeployProps) {
  const [estado, registrar, registrando] = useActionState(registrarDeployManualAction, {})

  return (
    <form action={registrar} className="max-w-md space-y-4">
      <MensagensDeEstado estado={estado} />
      <input type="hidden" name="projetoId" value={projetoId} />
      <div className="space-y-1">
        <label htmlFor="deploy-ambiente" className="block text-sm font-medium text-text-primary">
          Ambiente
        </label>
        <select id="deploy-ambiente" name="tipo" className={CLASSE_CAMPO}>
          {ambientes.map((tipo) => (
            <option key={tipo} value={tipo}>
              {tipo}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="deploy-repositorio" className="block text-sm font-medium text-text-primary">
          Repositório
        </label>
        <select id="deploy-repositorio" name="repositorioId" className={CLASSE_CAMPO}>
          {repositorios.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.nomeCompleto}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="deploy-commit" className="block text-sm font-medium text-text-primary">
          Commit (SHA completo)
        </label>
        <input
          id="deploy-commit"
          name="commitSha"
          type="text"
          required
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          className={`${CLASSE_CAMPO} font-mono`}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="deploy-rotulo" className="block text-sm font-medium text-text-primary">
          Rótulo da versão (opcional)
        </label>
        <input
          id="deploy-rotulo"
          name="rotulo"
          type="text"
          maxLength={60}
          className={CLASSE_CAMPO}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="deploy-ocorrido" className="block text-sm font-medium text-text-primary">
          Ocorrido em
        </label>
        <input
          id="deploy-ocorrido"
          name="ocorridaEm"
          type="datetime-local"
          className={CLASSE_CAMPO}
        />
      </div>
      <p className="text-sm text-text-secondary">
        O registro fica marcado como manual, com seu nome e a data. Use quando o pipeline não envia
        evidência.
      </p>
      <Button
        type="submit"
        aria-busy={registrando}
        onClick={(e) => {
          if (registrando) {
            e.preventDefault()
          }
        }}
      >
        Registrar deploy manual
      </Button>
    </form>
  )
}
