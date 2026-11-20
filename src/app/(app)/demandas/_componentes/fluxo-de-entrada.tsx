import Link from 'next/link'
import type { QuadroDeEntrada } from '@/modules/demandas/apresentacao'
import { cn } from '@/lib/utils'

// Borda de cima no tom de cada saída; as Recebidas usam o tema escuro, como a navegação.
const BORDA: Record<QuadroDeEntrada['chave'], string> = {
  recebidas: 'dark border-marca-midnight border-t-marca-flow bg-marca-midnight',
  orientadas: 'border-t-neutro',
  urgente: 'border-t-erro',
  lote: 'border-t-informacao',
  agentes: 'border-t-execucao',
  decisao: 'border-t-atencao',
}

function Quadro({ quadro, ativo }: { quadro: QuadroDeEntrada; ativo: boolean }) {
  const href = !ativo && quadro.filtro ? `/demandas?destino=${quadro.filtro}` : '/demandas'
  return (
    <Link
      href={href}
      aria-current={ativo ? 'true' : undefined}
      className={cn(
        'min-w-0 rounded-padrao border border-t-4 border-border bg-surface px-3.5 pb-3 pt-3.5 transition-shadow hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
        BORDA[quadro.chave],
        ativo && 'ring-2 ring-text-primary',
      )}
    >
      <span className="block text-[30px] font-[650] leading-none tracking-[-0.03em] text-text-primary">
        {quadro.n}
      </span>
      <span className="mt-1.5 block truncate text-[12.5px] font-[550] text-text-secondary">
        {quadro.rotulo}
      </span>
      <span className="mt-0.5 block text-[11.5px] text-text-tertiary">{quadro.meta}</span>
    </Link>
  )
}

export function FluxoDeEntrada({
  quadros,
  filtro,
}: {
  quadros: readonly QuadroDeEntrada[]
  filtro: string | null
}) {
  const [recebidas, ...saidas] = quadros
  return (
    <section
      aria-label="Fluxo de entrada de hoje"
      className="grid grid-cols-2 gap-2.5 md:grid-cols-[130px_22px_repeat(5,minmax(0,1fr))]"
    >
      {recebidas && <Quadro quadro={recebidas} ativo={false} />}
      <span
        aria-hidden="true"
        className="hidden place-items-center text-xl text-text-tertiary md:grid"
      >
        →
      </span>
      {saidas.map((q) => (
        <Quadro key={q.chave} quadro={q} ativo={q.filtro !== null && q.filtro === filtro} />
      ))}
    </section>
  )
}
