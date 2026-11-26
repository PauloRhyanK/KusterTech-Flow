import Link from 'next/link'
import type { JuntadaEm } from '@/modules/demandas/apresentacao'
import { BotaoSeparar } from './evidencias-da-demanda'

function fraseDosRelatos(n: number): string | null {
  if (n === 0) return null
  return n === 1
    ? 'O relato desta demanda está lá, e quem relatou recebe o andamento de lá.'
    : `Os ${n} relatos desta demanda estão lá, e quem relatou recebe o andamento de lá.`
}

/** A demanda juntada pela triagem: o destino, o motivo e Separar, no lugar do conteúdo de trabalho. */
export function FaixaDaJuntada({
  demandaId,
  juntadaEm,
}: {
  demandaId: string
  juntadaEm: JuntadaEm
}) {
  const titulo = `faixa-da-juntada-${demandaId}`
  const relatos = fraseDosRelatos(juntadaEm.relatos)
  return (
    <section
      aria-labelledby={titulo}
      className="flex flex-wrap items-start gap-3.5 rounded-padrao border border-execucao/30 bg-tonal-execucao px-4 py-3.5"
    >
      <span
        aria-hidden="true"
        className="grid size-[26px] shrink-0 place-items-center rounded-full bg-execucao font-[700] text-action-foreground"
      >
        ↗
      </span>
      <div className="min-w-0 flex-1 basis-[240px]">
        <h2 id={titulo} className="mb-0.5 font-[650] text-text-primary">
          Juntada a{' '}
          <Link href={`/demandas/${juntadaEm.id}`} className="text-text-link hover:underline">
            &quot;{juntadaEm.titulo}&quot;
          </Link>
        </h2>
        <p className="text-[13px] text-text-secondary">
          A triagem viu o mesmo problema: {juntadaEm.motivo}.{relatos && ` ${relatos}`}
        </p>
      </div>
      {juntadaEm.podeSeparar && <BotaoSeparar demandaJuntadaId={demandaId} />}
    </section>
  )
}
