'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { formatarIdade } from '@/modules/inicio/model'

export interface MensagemNaTela {
  seq: string
  id: string
  autor: 'paulo' | 'agente' | 'flow'
  texto: string
  respostaRapida: string | null
  respostasRapidas: string[]
  anexos: { id: string; nome: string }[]
  em: Date
}

export interface RespostaDoFlow {
  chave: string
  rotulo: string
}

/** Espera pelo agente que já merece o aviso "decidir sem ele". */
export const ESPERA_LONGA_MS = 60_000
/** Sem busca do atendente há mais que isso: a Fábrica não está ouvindo. */
export const ATENDENTE_PARADO_MS = 2 * 60_000

const AVATAR: Record<MensagemNaTela['autor'], { texto: string; classe: string }> = {
  agente: { texto: 'IA', classe: 'bg-execucao text-[11px]' },
  paulo: { texto: 'EU', classe: 'bg-marca-midnight text-[11px]' },
  flow: { texto: 'Flow', classe: 'bg-marca-flow text-[9.5px]' },
}

const BOTAO_RAPIDO =
  'rounded-full border bg-surface px-3 py-1 text-[13px] font-[600] text-text-primary transition-colors hover:bg-surface-subtle disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'

function tempoDeEspera(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `há ${s} s` : `há ${Math.floor(s / 60)} min`
}

function avisoDeEspera(atendenteBuscouEm: Date | null, agora: Date): string {
  if (atendenteBuscouEm === null) {
    return 'O atendente da Fábrica ainda não buscou conversas. Você pode decidir sem ele:'
  }
  if (agora.getTime() - atendenteBuscouEm.getTime() > ATENDENTE_PARADO_MS) {
    return `O atendente da Fábrica não busca conversas ${formatarIdade(atendenteBuscouEm, agora)}. Você pode decidir sem ele:`
  }
  return 'O agente está demorando. Você pode decidir sem ele:'
}

/**
 * As mensagens da conversa (sempre como texto, nunca HTML), as respostas rápidas e a espera pelo
 * agente. Resposta rápida do Flow vira `onRespostaRapida(chave)`; a sugerida pelo agente, que não
 * é do Flow, vira uma mensagem escrita (`onTextoRapido`).
 */
export function Conversa({
  mensagens,
  aguardaAgenteDesde,
  atendenteBuscouEm,
  agora,
  respostasDoFlow,
  onRespostaRapida,
  onTextoRapido,
  desabilitado = false,
}: {
  mensagens: readonly MensagemNaTela[]
  aguardaAgenteDesde: Date | null
  atendenteBuscouEm: Date | null
  agora: Date
  respostasDoFlow: readonly RespostaDoFlow[]
  onRespostaRapida: (chave: string) => void
  onTextoRapido: (texto: string) => void
  desabilitado?: boolean
}) {
  const fim = useRef<HTMLDivElement>(null)
  const ultima = mensagens.at(-1)?.id
  useEffect(() => {
    fim.current?.scrollIntoView?.({ block: 'nearest' })
  }, [ultima])

  const clicar = (rotulo: string) => {
    const doFlow = respostasDoFlow.find((r) => r.rotulo === rotulo)
    if (doFlow) onRespostaRapida(doFlow.chave)
    else onTextoRapido(rotulo)
  }
  const espera = aguardaAgenteDesde ? agora.getTime() - aguardaAgenteDesde.getTime() : null

  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        {mensagens.map((m) => {
          const doPaulo = m.autor === 'paulo'
          const avatar = AVATAR[m.autor]
          return (
            <li
              key={m.id}
              className={cn(
                'flex max-w-[92%] gap-2.5 md:max-w-[86%]',
                doPaulo && 'ml-auto flex-row-reverse',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full font-bold text-action-foreground',
                  avatar.classe,
                )}
              >
                {avatar.texto}
              </span>
              <div
                className={cn(
                  'min-w-0 rounded-padrao px-3.5 py-2.5 text-sm leading-relaxed',
                  doPaulo
                    ? 'bg-marca-midnight text-action-foreground'
                    : 'border border-border bg-surface text-text-primary',
                )}
              >
                <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                {m.anexos.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {m.anexos.map((a) => (
                      <li key={a.id}>
                        <a
                          href={`/decidir/anexos/${a.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-full items-center gap-2 text-[12.5px] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                        >
                          <span
                            aria-hidden="true"
                            className="h-5 w-7 shrink-0 rounded-[4px] border border-border-strong bg-surface-subtle"
                          />
                          <span className="break-all">{a.nome}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {!doPaulo && m.respostasRapidas.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {m.respostasRapidas.map((r, i) => (
                      <button
                        key={r}
                        type="button"
                        disabled={desabilitado}
                        onClick={() => clicar(r)}
                        className={cn(
                          BOTAO_RAPIDO,
                          i === 0 ? 'border-execucao text-execucao' : 'border-border-strong',
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {espera !== null && (
        <p role="status" className="text-right text-xs text-text-tertiary">
          {`Enviada, aguardando o agente · ${tempoDeEspera(espera)}`}
        </p>
      )}
      {espera !== null && espera >= ESPERA_LONGA_MS && respostasDoFlow.length > 0 && (
        <div
          role="group"
          aria-label="Decidir sem o agente"
          className="space-y-2.5 rounded-padrao border border-border bg-surface-subtle px-3.5 py-3 text-sm text-text-secondary"
        >
          <p>{avisoDeEspera(atendenteBuscouEm, agora)}</p>
          <div className="flex flex-wrap gap-2">
            {respostasDoFlow.map((r) => (
              <button
                key={r.chave}
                type="button"
                disabled={desabilitado}
                onClick={() => onRespostaRapida(r.chave)}
                className={cn(BOTAO_RAPIDO, 'border-border-strong')}
              >
                {r.rotulo}
              </button>
            ))}
          </div>
        </div>
      )}
      <div ref={fim} />
    </div>
  )
}
