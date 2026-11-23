'use client'

// Plano da entrega: uma coluna por fase, um cartão por parte (raia), um quadradinho por critério de aceite.
import type { FaseDoPlano, Parte, SituacaoDaParte } from '@/modules/fabrica/escritorio/model'
import { cn } from '@/lib/utils'
import { Boneco } from './pixel'

export const ROTULO_DA_SITUACAO: Record<SituacaoDaParte, string> = {
  fila: 'Na fila',
  execucao: 'Em execução',
  revisao: 'Em revisão',
  entregue: 'Entregue ✓',
}

const TOM_DA_SITUACAO: Record<SituacaoDaParte, string> = {
  fila: 'bg-tonal-neutro',
  execucao: 'bg-tonal-informacao',
  revisao: 'bg-tonal-execucao',
  entregue: 'bg-tonal-sucesso',
}

const COR_DA_MARCA = {
  cinza: 'var(--pixel-metal)',
  verde: 'var(--pixel-folha)',
  vermelho: 'var(--pixel-papel-conserto)',
}

export function totaisDoPlano(fases: FaseDoPlano[]) {
  const partes = fases.flatMap((f) => f.partes)
  const criterios = partes.flatMap((p) => p.criterios)
  return {
    entregues: partes.filter((p) => p.situacao === 'entregue').length,
    partes: partes.length,
    cumpridos: criterios.filter((c) => c.marca === 'verde').length,
    criterios: criterios.length,
  }
}

export function textoDosTotais(fases: FaseDoPlano[]): string {
  const t = totaisDoPlano(fases)
  return `${t.entregues} de ${t.partes} partes entregues · ${t.cumpridos} de ${t.criterios} critérios`
}

function Cartao({
  parte,
  selecionada,
  realcada,
  onSelecionar,
  onRealcar,
}: {
  parte: Parte
  selecionada: boolean
  realcada: boolean
  onSelecionar: () => void
  onRealcar: (realcar: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={onSelecionar}
      onMouseEnter={() => onRealcar(true)}
      onMouseLeave={() => onRealcar(false)}
      data-realce={realcada ? 'true' : undefined}
      aria-pressed={selecionada}
      aria-label={`${parte.raia}: ${ROTULO_DA_SITUACAO[parte.situacao]}`}
      className={cn(
        'mt-2.5 block w-full rounded-padrao border border-border bg-surface p-2.5 text-left',
        selecionada && 'ring-2 ring-focus-ring',
        realcada && 'bg-tonal-informacao',
      )}
      style={{ borderLeft: `5px solid var(--pixel-raia-${parte.cor % 8})` }}
    >
      <span className="flex items-center gap-2">
        {parte.agenteRunId && <Boneco papel={parte.papel} variacao={0} escala={2} />}
        <b className="min-w-0 flex-1 truncate text-xs text-text-primary">{parte.raia}</b>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-bold',
            TOM_DA_SITUACAO[parte.situacao],
          )}
        >
          {ROTULO_DA_SITUACAO[parte.situacao]}
        </span>
      </span>
      <span className="mt-1 mb-2 block text-[11px] leading-snug text-text-secondary">
        {parte.tarefa ?? parte.raia}
      </span>
      <ul className="flex flex-wrap gap-[3px]" aria-label="critérios de aceite">
        {parte.criterios.map((c, i) => (
          <li
            key={i}
            data-marca={c.marca}
            title={c.texto}
            className="inline-block size-3 rounded-[3px]"
            style={{ background: COR_DA_MARCA[c.marca] }}
          />
        ))}
      </ul>
    </button>
  )
}

export interface PlanoDaEntregaProps {
  fases: FaseDoPlano[]
  selecionada: string | null
  onSelecionar: (raia: string) => void
  /** raia do cartão realçado pelo mouse (no plano ou no personagem) */
  realcada?: string | null
  onRealcar?: (raia: string | null) => void
}

export function PlanoDaEntrega({
  fases,
  selecionada,
  onSelecionar,
  realcada = null,
  onRealcar = () => {},
}: PlanoDaEntregaProps) {
  return (
    <section aria-label="Plano da entrega">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-text-primary">Plano da entrega</h3>
        <span className="text-xs text-text-secondary">{textoDosTotais(fases)}</span>
      </div>
      <div
        className="grid gap-3.5"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, fases.length)}, minmax(0, 1fr))` }}
      >
        {fases.map((f, i) => {
          const entregues = f.partes.filter((p) => p.situacao === 'entregue').length
          return (
            <div
              key={f.id}
              className={cn(
                'rounded-padrao border border-border bg-surface p-3',
                f.situacao === 'atual' && 'ring-2 ring-focus-ring',
                f.situacao === 'feita' && 'bg-tonal-sucesso',
              )}
            >
              <h4 className="flex items-center justify-between text-xs font-semibold tracking-wide text-text-primary uppercase">
                {i + 1} · {f.id}
                <small className="text-[10px] font-semibold tracking-normal text-text-secondary normal-case">
                  {entregues}/{f.partes.length}
                </small>
              </h4>
              {f.partes.map((p) => (
                <Cartao
                  key={p.raia}
                  parte={p}
                  selecionada={selecionada === p.raia}
                  realcada={realcada === p.raia}
                  onSelecionar={() => onSelecionar(p.raia)}
                  onRealcar={(r) => onRealcar(r ? p.raia : null)}
                />
              ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}
