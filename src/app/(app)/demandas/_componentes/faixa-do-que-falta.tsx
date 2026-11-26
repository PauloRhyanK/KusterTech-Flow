'use client'

import { useId, useState, useTransition } from 'react'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import type { FaixaDoQueFalta as Falta } from '@/modules/demandas/apresentacao'
import { conferirNoArAction, type EstadoDaDecisao } from '../[id]/actions'

/** A faixa "Falta": a parte mais atrasada em destaque e, quando cabe, a ação "Conferi no ar". */
export function FaixaDoQueFalta({ demandaId, falta }: { demandaId: string; falta: Falta }) {
  const id = useId()
  const [estado, setEstado] = useState<EstadoDaDecisao>({})
  const [enviando, iniciar] = useTransition()
  const conferir = falta.conferir

  return (
    <section
      aria-labelledby={id}
      className="flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-padrao border border-erro/30 bg-tonal-erro px-4 py-3.5"
    >
      <span
        aria-hidden="true"
        className="grid size-[30px] shrink-0 place-items-center rounded-full bg-erro text-sm font-[700] text-action-foreground"
      >
        !
      </span>
      <div className="min-w-0 flex-1 basis-[240px]">
        <h2 id={id} className="text-base font-[650] leading-snug text-text-primary">
          {falta.titulo}
        </h2>
        <span className="block text-[12.5px] text-text-secondary">{falta.contexto}</span>
      </div>
      {conferir && (
        <Button
          type="button"
          disabled={enviando}
          onClick={() =>
            iniciar(async () => {
              setEstado(await conferirNoArAction(demandaId, conferir))
            })
          }
        >
          Conferi no ar
        </Button>
      )}
      <div className={estado.erro || estado.sucesso ? 'basis-full' : 'sr-only'}>
        <MensagensDeEstado estado={estado} />
      </div>
    </section>
  )
}
