import { horaLocal, type ItemDoLote } from '@/modules/fila-de-publicacao/apresentacao'
import { CLASSE_DO_CARTAO, TituloDeSecao } from '@/lib/ui/titulo-de-secao'

export interface UltimoLoteProps {
  quando: string | null
  itens: readonly ItemDoLote[]
  rodape: string | null
}

export function UltimoLote({ quando, itens, rodape }: UltimoLoteProps) {
  return (
    <section aria-labelledby="titulo-ultimo-lote" className="min-w-0">
      <TituloDeSecao id="titulo-ultimo-lote">
        {quando ? `Último lote · ${quando}` : 'Último lote'}
      </TituloDeSecao>
      <div className={CLASSE_DO_CARTAO}>
        {itens.length === 0 ? (
          <p className="px-4 py-3 text-sm text-text-secondary">Nenhum lote ainda.</p>
        ) : (
          <ul aria-label="Itens do último lote" className="divide-y divide-border">
            {itens.map((item) => (
              <li key={item.id} className="flex items-center gap-2.5 px-4 py-[11px] text-[13px]">
                <span className="w-11 shrink-0 text-xs tabular-nums text-text-secondary">
                  {horaLocal(item.concluidoEm ?? item.loteEm)}
                </span>
                <span
                  title={item.titulo}
                  className={
                    item.estado === 'falhou'
                      ? 'min-w-0 flex-1 truncate font-[550] text-erro'
                      : 'min-w-0 flex-1 truncate font-[550] text-text-primary'
                  }
                >
                  {item.titulo}
                  {item.estado === 'falhou' && <span className="sr-only"> (falhou)</span>}
                </span>
                <span className="shrink-0 whitespace-nowrap rounded-[6px] bg-tonal-neutro px-2 py-0.5 text-xs text-neutro">
                  {item.projeto}
                </span>
              </li>
            ))}
          </ul>
        )}
        {rodape && (
          <p className="border-t border-border px-4 py-[11px] text-[13px] text-text-secondary">
            {rodape}
          </p>
        )}
      </div>
    </section>
  )
}
