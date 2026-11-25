import type { CartaoDaParte, PassoDaParte } from '@/modules/demandas/apresentacao'
import type { PontoAteOAr } from '@/modules/demandas/partes'
import { CLASSE_DO_CARTAO } from '@/lib/ui/titulo-de-secao'
import { cn } from '@/lib/utils'
import { TOM_DA_PARTE } from './chips-das-partes'

const CLASSE_DO_PASSO: Record<PontoAteOAr, string> = {
  vazio: 'bg-border-strong',
  cheio: 'bg-marca-flow',
  andando: 'bg-execucao',
  verde: 'bg-sucesso',
  vermelho: 'bg-erro',
}

function Passo({ passo }: { passo: PassoDaParte }) {
  return (
    <li className="flex items-center gap-2.5 border-t border-border py-2 text-[13px] first:border-t-0">
      <span
        data-ponto={passo.ponto}
        aria-hidden="true"
        className={cn('size-2.5 shrink-0 rounded-full', CLASSE_DO_PASSO[passo.ponto])}
      />
      <span className="min-w-0 text-text-primary">
        {passo.rotulo}
        {passo.links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 text-text-link hover:underline"
          >
            {l.texto}
          </a>
        ))}
      </span>
      <span className="ml-auto shrink-0 text-xs text-text-tertiary">{passo.detalhe ?? '—'}</span>
    </li>
  )
}

/** "Ordem de publicação: …" e um cartão por parte, lado a lado, na ordem de publicação. */
export function PartesDaDemanda({
  ordem,
  partes,
}: {
  ordem: string | null
  partes: readonly CartaoDaParte[]
}) {
  if (partes.length === 0 && ordem === null) return null
  return (
    <section aria-label="Partes da demanda" className="space-y-3">
      {ordem && <p className="text-xs text-text-tertiary">{ordem}</p>}
      <div className="grid gap-3.5 md:grid-cols-2">
        {partes.map((p) => (
          <article key={p.chave} className={cn(CLASSE_DO_CARTAO, 'p-4')}>
            <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
              <h3 className="text-[15px] font-[650] text-text-primary">{p.titulo}</h3>
              <span className="whitespace-nowrap rounded-[6px] bg-surface-subtle px-2 py-0.5 text-xs text-text-secondary">
                {p.repositorio}
              </span>
              <span
                className={cn(
                  'ml-auto whitespace-nowrap rounded-[6px] border px-[7px] py-0.5 text-[11.5px]',
                  TOM_DA_PARTE[p.estado.tom],
                )}
              >
                {p.estado.texto}
              </span>
            </div>
            <ol>
              {p.passos.map((passo) => (
                <Passo key={passo.rotulo} passo={passo} />
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  )
}
