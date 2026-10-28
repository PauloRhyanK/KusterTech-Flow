import { ListaDeEventos, type EventoDaTimeline } from '@/lib/ui/timeline'
import { agruparRodadas } from '@/modules/homologacao/model'

export interface RodadasDaTimelineProps {
  eventos: readonly EventoDaTimeline[]
  // Versão avaliada do item: a rodada dela abre; as anteriores ficam recolhidas (D44).
  versaoAtualId: string | null
  rotulo: string
  vazio: string
}

function contagem(n: number): string {
  return `${n} ${n === 1 ? 'evento' : 'eventos'}`
}

const CLASSE_DO_RESUMO = 'cursor-pointer px-4 py-3 text-sm font-[600] text-text-primary'

// Uma só timeline, agrupada na apresentação pela versão dos eventos. Nada é apagado: a nova
// versão abre uma rodada e as anteriores continuam acessíveis.
export function RodadasDaTimeline({
  eventos,
  versaoAtualId,
  rotulo,
  vazio,
}: RodadasDaTimelineProps) {
  if (eventos.length === 0) {
    return (
      <section aria-label={rotulo}>
        <p className="text-sm text-text-secondary">{vazio}</p>
      </section>
    )
  }

  const rotulos = new Map<string, string>()
  for (const e of eventos) {
    if (e.versao) rotulos.set(e.versao.id, e.versao.rotulo)
  }
  const rodadas = agruparRodadas(
    eventos.map((e) => ({ ...e, versaoId: e.versao?.id ?? null, criadoEm: e.quando })),
    versaoAtualId,
  )
  const atual = rodadas.find((r) => r.atual)
  const anteriores = rodadas.filter((r) => !r.atual).reverse()
  const nomeDa = (versaoId: string | null) =>
    versaoId === null ? null : (rotulos.get(versaoId) ?? null)

  return (
    <section aria-label={rotulo} className="space-y-3">
      {atual && (
        <details
          open
          data-rodada-atual="true"
          className="rounded-padrao border border-l-2 border-border border-l-context-active bg-surface"
        >
          <summary className={CLASSE_DO_RESUMO}>
            {nomeDa(atual.versaoId)
              ? `Versão atual em QA: ${nomeDa(atual.versaoId)}`
              : `Sem versão identificada · ${contagem(atual.eventos.length)}`}
          </summary>
          <div className="px-4 pb-4">
            <ListaDeEventos eventos={atual.eventos} />
          </div>
        </details>
      )}
      {anteriores.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-[600] text-text-secondary">Rodadas anteriores</h3>
          {anteriores.map((r) => (
            <details
              key={r.versaoId ?? 'sem-versao'}
              className="rounded-padrao border border-border bg-surface"
            >
              <summary className={CLASSE_DO_RESUMO}>
                {nomeDa(r.versaoId)
                  ? `Versão ${nomeDa(r.versaoId)} · ${contagem(r.eventos.length)}`
                  : `Sem versão identificada · ${contagem(r.eventos.length)}`}
              </summary>
              <div className="px-4 pb-4">
                <ListaDeEventos eventos={r.eventos} />
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  )
}
