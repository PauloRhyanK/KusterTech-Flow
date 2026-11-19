import { buttonVariants } from '@/components/ui/button'
import type { AvisoDePublicacao } from '@/modules/fila-de-publicacao/apresentacao'
import { cn } from '@/lib/utils'

const TOM = {
  erro: { faixa: 'border-erro/30 bg-tonal-erro', marca: 'bg-erro' },
  atencao: { faixa: 'border-atencao/30 bg-tonal-atencao', marca: 'bg-atencao' },
} as const

// O que espera você na publicação: o aviso mais urgente e quantos mais há.
export function FaixaDeEspera({ avisos }: { avisos: readonly AvisoDePublicacao[] }) {
  const [primeiro] = avisos
  if (!primeiro) return null
  const tom = TOM[primeiro.tom]
  const outros = avisos.length - 1
  return (
    <section
      aria-label="Espera você"
      className={cn(
        'flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-padrao border px-4 py-3 sm:flex-nowrap',
        tom.faixa,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold text-action-foreground',
          tom.marca,
        )}
      >
        !
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-[650] leading-snug text-text-primary">{primeiro.titulo}</p>
        <p className="text-[13px] text-text-secondary">
          <span>{primeiro.contexto}</span>
          {outros > 0 && (
            <>
              <span aria-hidden="true"> · </span>
              <span className="font-[600] text-text-primary">{`e mais ${outros}`}</span>
            </>
          )}
        </p>
      </div>
      <a
        href={primeiro.href}
        {...(primeiro.externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className={cn(buttonVariants({ size: 'lg' }), 'px-3.5')}
      >
        Ver o que falhou
        {primeiro.externo && <span aria-hidden="true">↗</span>}
      </a>
    </section>
  )
}
