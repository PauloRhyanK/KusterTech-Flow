import type { ChipDaParte, TomDaParte } from '@/modules/demandas/apresentacao'
import { cn } from '@/lib/utils'

export const TOM_DA_PARTE: Record<TomDaParte, string> = {
  ok: 'border-sucesso/30 bg-tonal-sucesso text-sucesso',
  andando: 'border-execucao/30 bg-tonal-execucao text-execucao',
  nao: 'border-erro/30 bg-tonal-erro text-erro',
  neutro: 'border-border bg-surface-subtle text-text-secondary',
}

/** Um chip por parte, "<chave> · <estado curto>", no tom do estado. */
export function ChipsDasPartes({
  partes,
  className,
}: {
  partes: readonly ChipDaParte[]
  className?: string
}) {
  return (
    <ul aria-label="Partes" className={cn('flex flex-wrap gap-1', className)}>
      {partes.map((p) => (
        <li
          key={p.chave}
          className={cn(
            'whitespace-nowrap rounded-[6px] border px-[7px] py-0.5 text-[11.5px]',
            TOM_DA_PARTE[p.tom],
          )}
        >
          {p.chave} · {p.texto}
        </li>
      ))}
    </ul>
  )
}
