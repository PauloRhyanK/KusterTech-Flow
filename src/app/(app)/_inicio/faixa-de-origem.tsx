import { ROTULO_DA_ORIGEM, type Origem } from '@/modules/atividade/model'

export const COR_DA_ORIGEM: Record<Origem, string> = {
  sessao: 'bg-informacao',
  fabrica: 'bg-execucao',
  outro: 'bg-border-strong',
}

const ORDEM: Origem[] = ['sessao', 'fabrica', 'outro']

// Um segmento por origem, com largura proporcional ao número de PRs; segmentos zerados somem.
export function FaixaDeOrigem({ porOrigem }: { porOrigem: Record<Origem, number> }) {
  const rotulo = ORDEM.map((o) => `${ROTULO_DA_ORIGEM[o]} ${porOrigem[o]}`).join(', ')
  return (
    <div
      role="img"
      aria-label={rotulo}
      className="flex h-2 gap-[3px] overflow-hidden rounded-full bg-surface-subtle"
    >
      {ORDEM.filter((o) => porOrigem[o] > 0).map((o) => (
        <span
          key={o}
          className={`${COR_DA_ORIGEM[o]} block`}
          style={{ flexGrow: porOrigem[o], flexBasis: 0 }}
        />
      ))}
    </div>
  )
}

export function LegendaDaOrigem() {
  return (
    <ul
      aria-label="Legenda da origem"
      className="mt-1.5 flex gap-3 text-[11.5px] text-text-tertiary"
    >
      {(Object.keys(ROTULO_DA_ORIGEM) as Origem[]).map((o) => (
        <li key={o} className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className={`${COR_DA_ORIGEM[o]} inline-block size-2 rounded-sm`}
          />
          {ROTULO_DA_ORIGEM[o]}
        </li>
      ))}
    </ul>
  )
}
