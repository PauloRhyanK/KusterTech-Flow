'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { registrarVerificacaoAction } from '../[p]/(abas)/publicacoes/actions'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface FormularioDeVerificacaoProps {
  projetoId: string
  versaoId: string
  podeAutorizar: boolean
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

// Verificação manual em produção (decisão 10): só para versão com evidência de deploy em PROD.
export function FormularioDeVerificacao({
  projetoId,
  versaoId,
  podeAutorizar,
}: FormularioDeVerificacaoProps) {
  const [estado, enviar, pendente] = useActionState(registrarVerificacaoAction, {})

  if (!podeAutorizar) {
    return null
  }
  const campoId = `verificacao-${versaoId}`

  return (
    <form action={enviar} aria-busy={pendente} className="space-y-2">
      <MensagensDeEstado estado={estado} />
      <input type="hidden" name="projetoId" value={projetoId} />
      <input type="hidden" name="versaoId" value={versaoId} />
      <label htmlFor={campoId} className="text-sm text-text-primary">
        O que foi verificado em produção
      </label>
      <textarea
        id={campoId}
        name="observacao"
        rows={2}
        maxLength={500}
        required
        className={CLASSE_CAMPO}
      />
      <Button type="submit" variant="outline" aria-busy={pendente}>
        Registrar verificação
      </Button>
    </form>
  )
}
