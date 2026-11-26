'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  corpoParaLeitura,
  imagensCitadas,
  opcoesDaMensagem,
  rotulosDasOpcoes,
} from '@/modules/decidir/leitura'
import { formatarIdade } from '@/modules/inicio/model'
import { MensagemFormatada } from './mensagem-formatada'
import { MiniaturaDoAnexo } from './visor-ampliado'

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
 * As mensagens da conversa, as respostas rápidas e a espera pelo agente. A mensagem do agente e a
 * do Flow são markdown formatado (HTML cru nunca é interpretado); a do Paulo é texto puro.
 * Resposta rápida do Flow vira `onRespostaRapida(chave)`; a sugerida pelo agente, que não é do
 * Flow, vira uma mensagem escrita (`onTextoRapido`). Numa decisão da Fábrica, as opções da última
 * mensagem viram botões (`onOpcao`).
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
  decisaoDaFabrica = false,
  onOpcao,
}: {
  mensagens: readonly MensagemNaTela[]
  aguardaAgenteDesde: Date | null
  atendenteBuscouEm: Date | null
  agora: Date
  respostasDoFlow: readonly RespostaDoFlow[]
  onRespostaRapida: (chave: string) => void
  onTextoRapido: (texto: string) => void
  desabilitado?: boolean
  decisaoDaFabrica?: boolean
  onOpcao?: (rotulo: string) => void
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
        {mensagens.map((m, indice) => {
          const doPaulo = m.autor === 'paulo'
          const avatar = AVATAR[m.autor]
          const texto =
            decisaoDaFabrica && !doPaulo ? corpoParaLeitura(m.texto) || m.texto : m.texto
          // A imagem que o texto cita aparece no lugar da citação; as outras, depois do texto.
          const citadas = doPaulo ? [] : imagensCitadas(texto)
          const soltos = m.anexos.filter((a) => !citadas.includes(a.nome))
          // As opções só viram botão na última mensagem, e quando o agente não mandou as dele.
          const opcoes =
            decisaoDaFabrica &&
            onOpcao &&
            !doPaulo &&
            indice === mensagens.length - 1 &&
            m.respostasRapidas.every((r) => respostasDoFlow.some((f) => f.rotulo === r))
              ? rotulosDasOpcoes(opcoesDaMensagem(m.texto))
              : []
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
                {doPaulo ? (
                  <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                ) : (
                  <MensagemFormatada
                    texto={texto}
                    linksInternos={m.autor === 'flow'}
                    anexos={m.anexos}
                  />
                )}
                {soltos.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {soltos.map((a) => (
                      <li key={a.id}>
                        <MiniaturaDoAnexo id={a.id} nome={a.nome} />
                      </li>
                    ))}
                  </ul>
                )}
                {opcoes.length > 0 && (
                  <div
                    role="group"
                    aria-label="Responder com uma opção"
                    className="mt-3 flex flex-wrap gap-2"
                  >
                    {opcoes.map((rotulo, i) => (
                      <button
                        key={rotulo}
                        type="button"
                        disabled={desabilitado}
                        onClick={() => onOpcao?.(rotulo)}
                        className={cn(
                          BOTAO_RAPIDO,
                          i === 0 ? 'border-execucao text-execucao' : 'border-border-strong',
                        )}
                      >
                        {rotulo}
                      </button>
                    ))}
                  </div>
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
