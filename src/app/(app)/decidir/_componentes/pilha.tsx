'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ItemDaPilha } from '@/modules/decidir/model'
import { iconeDoTipo } from '@/modules/demandas/apresentacao'
import { IconeDoTipo } from '../../demandas/_componentes/icone-do-tipo'

/** "3 de 7 · faltam 5": quantos ainda esperam, contando o atual. */
export function textoDaPosicao(posicao: number, total: number): string {
  return `${posicao} de ${total} · faltam ${total - posicao + 1}`
}

/** A demanda mostra o próprio tipo; a issue da Fábrica não tem tipo de demanda. */
export function iconeDoItem(item: ItemDaPilha) {
  return iconeDoTipo(item.ref.tipo === 'demanda' ? item.ref.tipoDeDemanda : null)
}

export function Guardados({
  guardados,
  onTrazerDeVolta,
  pendente = false,
}: {
  guardados: readonly ItemDaPilha[]
  onTrazerDeVolta: (chave: string) => void
  pendente?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  if (guardados.length === 0) return null
  return (
    <div className="mt-4 space-y-2">
      <button
        type="button"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
        className="text-[12.5px] font-[600] text-text-secondary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {`Guardados (${guardados.length})`}
      </button>
      {aberto && (
        <ul className="space-y-1.5">
          {guardados.map((g) => (
            <li
              key={g.chave}
              className="flex items-center gap-2 rounded-padrao border border-border bg-surface px-3 py-2 text-[12.5px] text-text-secondary"
            >
              <span className="min-w-0 flex-1 break-words">{g.titulo}</span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={pendente}
                onClick={() => onTrazerDeVolta(g.chave)}
              >
                Trazer de volta
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** A coluna da pilha (só a partir de 768 px; no celular vira a `FaixaDoCelular`). */
export function Pilha({
  itens,
  atual,
  guardados,
  onEscolher,
  onTrazerDeVolta,
  pendente = false,
}: {
  itens: readonly ItemDaPilha[]
  atual: number
  guardados: readonly ItemDaPilha[]
  onEscolher: (indice: number) => void
  onTrazerDeVolta: (chave: string) => void
  pendente?: boolean
}) {
  const total = itens.length
  const texto = textoDaPosicao(atual + 1, total)
  const percentual = total === 0 ? 0 : Math.round((atual / total) * 100)
  return (
    <nav aria-label="Pilha do Decidir" className="hidden w-[220px] shrink-0 md:block">
      <div
        role="progressbar"
        aria-label={texto}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={atual}
        className="mb-3.5 mt-1 h-1.5 overflow-hidden rounded-full bg-border"
      >
        <div className="h-full bg-marca-flow" style={{ width: `${percentual}%` }} />
      </div>
      <ol className="space-y-1.5">
        {itens.map((item, i) => (
          <li key={item.chave}>
            <button
              type="button"
              aria-current={i === atual ? 'true' : undefined}
              onClick={() => onEscolher(i)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-padrao border bg-surface px-3 py-2.5 text-left text-[13px] font-[600] leading-snug text-text-primary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                i === atual ? 'border-2 border-text-primary' : 'border-border',
                i < atual && 'opacity-55',
              )}
            >
              <IconeDoTipo icone={iconeDoItem(item)} />
              <span className="line-clamp-2 min-w-0 break-words">{item.titulo}</span>
            </button>
          </li>
        ))}
      </ol>
      <Guardados guardados={guardados} onTrazerDeVolta={onTrazerDeVolta} pendente={pendente} />
    </nav>
  )
}

/** No celular: "‹ 3 de 7 ›" e o título do item, no topo. */
export function FaixaDoCelular({
  posicao,
  total,
  titulo,
  onAnterior,
  onProximo,
}: {
  posicao: number
  total: number
  titulo: string
  onAnterior: () => void
  onProximo: () => void
}) {
  const seta =
    'grid size-9 shrink-0 place-items-center rounded-compacto border border-border bg-surface text-lg text-text-primary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
  return (
    <div className="flex items-center gap-2 rounded-padrao border border-border bg-surface px-2 py-2 md:hidden">
      <button
        type="button"
        aria-label="Item anterior"
        disabled={posicao <= 1}
        onClick={onAnterior}
        className={seta}
      >
        ‹
      </button>
      <span className="shrink-0 text-[13px] font-[650] text-text-primary">{`${posicao} de ${total}`}</span>
      <button
        type="button"
        aria-label="Próximo item"
        disabled={posicao >= total}
        onClick={onProximo}
        className={seta}
      >
        ›
      </button>
      <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">{titulo}</span>
    </div>
  )
}
