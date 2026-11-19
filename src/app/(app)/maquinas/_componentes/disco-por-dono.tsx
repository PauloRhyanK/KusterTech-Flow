import { CLASSE_DO_CARTAO, TituloDeSecao } from '@/lib/ui/titulo-de-secao'
import type { DiscoPorDono } from '@/modules/oficina/contrato'
import { fatiasDoDisco, formatarBytes } from '@/modules/oficina/model'

export interface ParaOndeVaiODiscoProps {
  disco: DiscoPorDono | null
  totalBytes: number | null
  livreBytes: number | null
}

const COR_DA_FATIA: Record<string, string> = {
  docker: 'bg-action-primary',
  fabrica: 'bg-execucao',
  runners: 'bg-context-active',
  backups: 'bg-atencao',
  outros: 'bg-text-tertiary',
  livre: 'bg-surface-subtle border border-border',
}

// O que ocupa o disco, por dono: é a informação que diz o que limpar.
export function ParaOndeVaiODisco({ disco, totalBytes, livreBytes }: ParaOndeVaiODiscoProps) {
  const fatias = disco
    ? fatiasDoDisco(disco, totalBytes ?? 0, livreBytes ?? 0).filter(
        (f) => f.nome !== 'livre' || livreBytes !== null,
      )
    : []

  return (
    <section aria-labelledby="titulo-disco-por-dono">
      <TituloDeSecao id="titulo-disco-por-dono">Para onde vai o disco</TituloDeSecao>
      <div className={`${CLASSE_DO_CARTAO} p-4`}>
        {disco === null ? (
          <p className="text-[13px] text-text-tertiary">Sem dados</p>
        ) : (
          <>
            <div
              role="img"
              aria-label={fatias.map((f) => `${f.rotulo}: ${formatarBytes(f.bytes)}`).join('; ')}
              className="mb-3 mt-1 flex h-3.5 overflow-hidden rounded-full bg-surface-subtle"
            >
              {fatias
                .filter((f) => f.nome !== 'livre')
                .map((f) => (
                  <span
                    key={f.nome}
                    className={`block h-full ${COR_DA_FATIA[f.nome]}`}
                    style={{ width: `${f.pct}%` }}
                  />
                ))}
            </div>
            <ul>
              {fatias.map((f) => (
                <li key={f.nome} className="flex items-center gap-2 py-[5px] text-[13px]">
                  <i
                    aria-hidden="true"
                    className={`size-2.5 shrink-0 rounded-[3px] ${COR_DA_FATIA[f.nome]}`}
                  />
                  <span className="text-text-primary">{f.rotulo}</span>
                  <span className="ml-auto whitespace-nowrap font-mono text-[12.5px] text-text-primary">
                    {formatarBytes(f.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
