import Link from 'next/link'
import type { ItemNaTela, LinhaDaBusca } from '@/modules/demandas/busca/queries'
import { formatarIdade } from '@/modules/inicio/model'
import { CLASSE_DO_CARTAO } from '@/lib/ui/titulo-de-secao'
import { cn } from '@/lib/utils'

const PARADA_APOS_MS = 2 * 60_000

const RELEVANCIA: Record<ItemNaTela['relevancia'], { rotulo: string; classe: string }> = {
  alta: { rotulo: 'Alta', classe: 'text-sucesso' },
  media: { rotulo: 'Média', classe: 'text-atencao' },
  baixa: { rotulo: 'Baixa', classe: 'text-text-tertiary' },
}

const ESTADO: Record<LinhaDaBusca['estado'], { rotulo: string; classe: string }> = {
  pendente: { rotulo: 'Procurando', classe: 'text-execucao' },
  em_curso: { rotulo: 'Procurando', classe: 'text-execucao' },
  concluida: { rotulo: 'Concluída', classe: 'text-sucesso' },
  falhou: { rotulo: 'Falhou', classe: 'text-erro' },
}

/** "US$ 0,0123" abaixo de 10 centavos; "US$ 0,50" acima. */
export function formatarCusto(usd: number): string {
  const casas = usd > 0 && usd < 0.1 ? 4 : 2
  return `US$ ${usd.toFixed(casas).replace('.', ',')}`
}

const andando = (b: LinhaDaBusca) => b.estado === 'pendente' || b.estado === 'em_curso'

/** A busca aberta: procurando, a resposta com as demandas, ou a falha. */
export function ResultadoDaBusca({ busca, agora }: { busca: LinhaDaBusca; agora: Date }) {
  return (
    <section aria-label="Resultado da busca" className={cn(CLASSE_DO_CARTAO, 'space-y-3 p-4')}>
      <p className="text-[12.5px] text-text-tertiary">“{busca.pergunta}”</p>
      {andando(busca) ? (
        <p role="status" className="text-sm font-[550] text-execucao">
          {busca.estado === 'pendente' &&
          agora.getTime() - busca.criadaEm.getTime() > PARADA_APOS_MS
            ? 'A Fábrica ainda não pegou esta busca.'
            : 'Procurando nas demandas…'}
        </p>
      ) : busca.estado === 'falhou' ? (
        <p role="alert" className="text-sm text-erro">
          A busca falhou: {busca.falha}
        </p>
      ) : (
        <>
          {busca.resumo && <p className="text-sm text-text-primary">{busca.resumo}</p>}
          {busca.itens.length === 0 ? (
            <p className="text-sm text-text-secondary">Nenhuma demanda trata disso.</p>
          ) : (
            <ul className="divide-y divide-border rounded-compacto border border-border">
              {busca.itens.map((i) => (
                <li
                  key={i.demandaId}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5"
                >
                  <Link href={i.href} className="font-[550] text-text-link hover:underline">
                    {i.titulo}
                  </Link>
                  <span className={cn('text-xs font-[600]', RELEVANCIA[i.relevancia].classe)}>
                    {RELEVANCIA[i.relevancia].rotulo}
                  </span>
                  <span className="basis-full text-[13px] text-text-secondary">{i.motivo}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

/** As últimas buscas e o gasto do mês. */
export function HistoricoDaBusca({
  historico,
  mes,
  agora,
}: {
  historico: readonly LinhaDaBusca[]
  mes: { buscas: number; custoUsd: number }
  agora: Date
}) {
  return (
    <section aria-labelledby="historico-da-busca" className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="historico-da-busca" className="text-[15px] font-[650] text-text-primary">
          Buscas anteriores
        </h2>
        <span className="text-[12.5px] text-text-tertiary">
          Este mês: {mes.buscas} {mes.buscas === 1 ? 'busca' : 'buscas'} ·{' '}
          {formatarCusto(mes.custoUsd)}
        </span>
      </div>
      {historico.length === 0 ? (
        <p className="text-sm text-text-tertiary">Nenhuma busca ainda.</p>
      ) : (
        <ul className={cn(CLASSE_DO_CARTAO, 'divide-y divide-border overflow-hidden')}>
          {historico.map((b) => (
            <li key={b.id} className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 px-4 py-2.5">
              <Link
                href={`/demandas/busca?id=${b.id}`}
                className="min-w-0 flex-1 basis-full truncate text-sm font-[550] text-text-primary hover:underline md:basis-auto"
              >
                {b.pergunta}
              </Link>
              <span className={cn('text-xs font-[600]', ESTADO[b.estado].classe)}>
                {ESTADO[b.estado].rotulo}
              </span>
              <span className="text-xs text-text-tertiary">
                {b.estado === 'concluida'
                  ? `${b.itens.length} ${b.itens.length === 1 ? 'demanda' : 'demandas'}`
                  : '—'}
              </span>
              <span className="text-xs text-text-tertiary">
                {b.custoUsd === null ? '—' : formatarCusto(b.custoUsd)}
              </span>
              <span className="text-xs text-text-tertiary">{formatarIdade(b.criadaEm, agora)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
