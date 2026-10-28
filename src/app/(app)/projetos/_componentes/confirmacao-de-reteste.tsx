'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { formatarDataHora } from '@/lib/data'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import type { MotivoSemReteste } from '@/modules/homologacao/model'
import { confirmarRetesteAction } from '../acoes-de-triagem'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface ConfirmacaoDeRetesteProps {
  projetoId: string
  clienteId: string
  itemId: string
  motivo: MotivoSemReteste
  versoesEmQa: readonly { id: string; rotulo: string; implantadaEm: Date }[]
  // Falso depois da confirmação: o bloco some, mas a região de status continua montada para
  // anunciar o resultado da ação que acabou de acontecer.
  ofertar?: boolean
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

const TEXTO_DO_MOTIVO: Record<MotivoSemReteste, string> = {
  'item-fora-de-correcao': 'Este item não está com correção solicitada.',
  'triagem-pendente': 'Faça a triagem da correção antes de pedir reteste.',
  'sem-correcao-com-tarefa':
    'Nenhuma correção com tarefa no GitHub. Se a correção já está em QA, confirme o reteste manualmente.',
  'correcao-nao-fechada': 'A correção ainda está aberta no GitHub.',
  'sem-presenca-em-qa':
    'A correção foi fechada, mas ainda não há evidência dela em uma nova versão em QA.',
}

// Só o admin chega aqui (D27): explica por que o reteste não foi detectado e deixa confirmá-lo à mão.
export function ConfirmacaoDeReteste(props: ConfirmacaoDeRetesteProps) {
  const [estado, enviar, pendente] = useActionState(confirmarRetesteAction, {})
  const podeConfirmar = props.motivo !== 'triagem-pendente'

  if (props.ofertar === false) {
    return (
      <form action={enviar} aria-busy={pendente}>
        <MensagensDeEstado estado={estado} />
      </form>
    )
  }

  return (
    <section
      aria-labelledby={`reteste-${props.itemId}`}
      className="space-y-3 rounded-padrao border border-border bg-surface-subtle p-4"
    >
      <h3 id={`reteste-${props.itemId}`} className="text-sm font-[600] text-text-primary">
        Reteste
      </h3>
      <p className="text-sm text-text-secondary">{TEXTO_DO_MOTIVO[props.motivo]}</p>
      <form action={enviar} aria-busy={pendente} className="space-y-3">
        <MensagensDeEstado estado={estado} />
        {podeConfirmar &&
          (props.versoesEmQa.length === 0 ? (
            <EstadoVazio
              tipo="sem-evidencia"
              titulo="Nenhuma versão deste repositório tem evidência em QA."
              descricao="Registre a evidência de deploy em QA antes de confirmar o reteste."
            />
          ) : (
            <>
              <input type="hidden" name="projetoId" value={props.projetoId} />
              <input type="hidden" name="clienteId" value={props.clienteId} />
              <input type="hidden" name="itemId" value={props.itemId} />
              <p className="text-sm font-[600] text-text-primary">Confirmar reteste manualmente</p>
              <div className="space-y-1">
                <label
                  htmlFor={`reteste-versao-${props.itemId}`}
                  className="block text-sm font-medium"
                >
                  Versão em QA
                </label>
                <select
                  id={`reteste-versao-${props.itemId}`}
                  name="versaoId"
                  required
                  className={CLASSE_CAMPO}
                >
                  {props.versoesEmQa.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.rotulo} · {formatarDataHora(v.implantadaEm)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label
                  htmlFor={`reteste-justificativa-${props.itemId}`}
                  className="block text-sm font-medium"
                >
                  Justificativa
                </label>
                <textarea
                  id={`reteste-justificativa-${props.itemId}`}
                  name="justificativa"
                  required
                  rows={3}
                  maxLength={1000}
                  className={CLASSE_CAMPO}
                />
              </div>
              <Button
                type="submit"
                aria-busy={pendente}
                onClick={(e) => {
                  if (pendente) e.preventDefault()
                }}
              >
                Confirmar reteste
              </Button>
            </>
          ))}
      </form>
    </section>
  )
}
