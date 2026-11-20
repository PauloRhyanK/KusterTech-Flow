import Link from 'next/link'
import type { GrupoDeDemandas, LinhaDeDemanda, TomDaDemanda } from '@/modules/demandas/apresentacao'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { CLASSE_DO_CARTAO } from '@/lib/ui/titulo-de-secao'
import { cn } from '@/lib/utils'
import { IconeDoTipo } from './icone-do-tipo'
import { TrilhoDeEtapas } from './trilho-de-etapas'

const TOM_DO_ESTADO: Record<TomDaDemanda, string> = {
  erro: 'text-erro',
  atencao: 'text-atencao',
  informacao: 'text-informacao',
  execucao: 'text-execucao',
  neutro: 'text-neutro',
}

function Linha({ linha }: { linha: LinhaDeDemanda }) {
  return (
    <li>
      <Link
        href={linha.href}
        className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-[11px] hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring md:flex-nowrap"
      >
        <IconeDoTipo icone={linha.icone} />
        <span className="min-w-0 flex-1 basis-[60%] truncate text-sm font-[550] text-text-primary md:basis-auto">
          {linha.titulo}
        </span>
        <span className="whitespace-nowrap rounded-[6px] bg-surface-subtle px-2 py-0.5 text-xs text-text-secondary">
          {linha.projeto}
        </span>
        <TrilhoDeEtapas pontos={linha.trilho} />
        <span
          className={cn(
            'shrink-0 whitespace-nowrap text-[12.5px] font-[550] md:w-[150px] md:text-right',
            TOM_DO_ESTADO[linha.estado.tom],
          )}
        >
          {linha.estado.texto}
        </span>
        <span className="ml-auto shrink-0 whitespace-nowrap text-right text-xs text-text-tertiary md:ml-0 md:w-[92px]">
          {linha.idade}
        </span>
      </Link>
    </li>
  )
}

export function ListaDeDemandas({
  grupos,
  filtrada = false,
}: {
  grupos: readonly GrupoDeDemandas[]
  filtrada?: boolean
}) {
  const comLinhas = grupos.filter((g) => g.linhas.length > 0)
  if (comLinhas.length === 0) {
    return (
      <EstadoVazio
        tipo="nenhum-registro"
        titulo={filtrada ? 'Nenhuma demanda aberta neste filtro' : 'Nenhuma demanda aberta'}
        descricao={
          filtrada
            ? 'Toque no quadro de novo para ver todas.'
            : 'As novas aparecem aqui assim que chegam.'
        }
      />
    )
  }
  return (
    <div className="space-y-5">
      {comLinhas.map((g) => (
        <section key={g.chave} aria-labelledby={`grupo-${g.chave}`}>
          <div className="mb-2.5 flex items-baseline gap-2.5">
            <h2 id={`grupo-${g.chave}`} className="text-[15px] font-[650] text-text-primary">
              {g.titulo}
            </h2>
            <span className="text-[12.5px] text-text-tertiary">{g.contagem}</span>
          </div>
          <ul className={cn(CLASSE_DO_CARTAO, 'divide-y divide-border overflow-hidden')}>
            {g.linhas.map((l) => (
              <Linha key={l.id} linha={l} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
