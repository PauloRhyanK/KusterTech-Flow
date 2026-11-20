import type { QuadroDeImpacto } from '@/modules/demandas/apresentacao'
import { CLASSE_DO_CARTAO } from '@/lib/ui/titulo-de-secao'
import { cn } from '@/lib/utils'

// O que a triagem achou: quatro quadros e, quando há, o que pode quebrar e as pílulas de atenção.
export function QuadrosDeImpacto({
  quadros,
  podeQuebrar,
  pilulas,
}: {
  quadros: readonly QuadroDeImpacto[]
  podeQuebrar: readonly string[]
  pilulas: readonly string[]
}) {
  if (quadros.length === 0) return null
  return (
    <section aria-label="Impacto" className="space-y-2.5">
      <dl className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {quadros.map((q) => (
          <div key={q.rotulo} className={cn(CLASSE_DO_CARTAO, 'rounded-compacto px-3 py-2.5')}>
            <dt className="mb-0.5 text-[11.5px] text-text-tertiary">{q.rotulo}</dt>
            <dd className="text-sm font-[650] text-text-primary">{q.valor}</dd>
          </div>
        ))}
      </dl>
      {(podeQuebrar.length > 0 || pilulas.length > 0) && (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2 text-[13px]">
          {podeQuebrar.length > 0 && (
            <div className="min-w-0 flex-1">
              <p className="font-[600] text-text-secondary">Pode quebrar</p>
              <ul className="list-disc pl-5 text-text-primary">
                {podeQuebrar.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          {pilulas.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {pilulas.map((p) => (
                <li
                  key={p}
                  className="rounded-full border border-atencao/30 bg-tonal-atencao px-2.5 py-0.5 text-xs font-[600] text-atencao"
                >
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
