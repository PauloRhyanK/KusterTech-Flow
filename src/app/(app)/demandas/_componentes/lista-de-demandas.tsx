import Link from 'next/link'
import type {
  GrupoDeDemandas,
  LinhaDeDemanda,
  QuadroAteOAr,
  TomDaDemanda,
} from '@/modules/demandas/apresentacao'
import type { GrupoAteOAr } from '@/modules/demandas/partes'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { CLASSE_DO_CARTAO } from '@/lib/ui/titulo-de-secao'
import { cn } from '@/lib/utils'
import { ChipsDasPartes } from './chips-das-partes'
import { TrilhoAteOAr } from './trilho-ate-o-ar'

export const TOM_DO_ESTADO: Record<TomDaDemanda, string> = {
  erro: 'text-erro',
  atencao: 'text-atencao',
  informacao: 'text-informacao',
  execucao: 'text-execucao',
  sucesso: 'text-sucesso',
  neutro: 'text-neutro',
}

// A borda de cima e o número no tom do grupo; "A caminho" deixa o número na cor do texto.
const TOM_DO_QUADRO: Record<GrupoAteOAr, { borda: string; numero: string }> = {
  no_ar: { borda: 'border-t-sucesso', numero: 'text-sucesso' },
  a_caminho: { borda: 'border-t-execucao', numero: 'text-text-primary' },
  nao_chegou: { borda: 'border-t-erro', numero: 'text-erro' },
  espera_voce: { borda: 'border-t-atencao', numero: 'text-atencao' },
}

/** Os quatro números do topo; cada um leva ao seu grupo. */
export function QuadrosAteOAr({ quadros }: { quadros: readonly QuadroAteOAr[] }) {
  return (
    <section
      aria-label="Demandas até o ar"
      className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3"
    >
      {quadros.map((q) => (
        <a
          key={q.chave}
          href={`#grupo-${q.chave}`}
          className={cn(
            'min-w-0 rounded-padrao border border-t-4 border-border bg-surface p-3.5 hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring md:p-4',
            TOM_DO_QUADRO[q.chave].borda,
          )}
        >
          <span
            className={cn(
              'block text-[34px] font-[650] leading-none tracking-[-0.03em]',
              TOM_DO_QUADRO[q.chave].numero,
            )}
          >
            {q.numero}
          </span>
          <span className="mt-1.5 block truncate text-[13px] font-[600] text-text-primary">
            {q.rotulo}
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] text-text-tertiary">{q.meta}</span>
        </a>
      ))}
    </section>
  )
}

function Linha({ linha }: { linha: LinhaDeDemanda }) {
  return (
    <li>
      <Link
        href={linha.href}
        className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-3 hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring md:flex-nowrap"
      >
        <span className="min-w-0 flex-1 basis-full md:basis-auto">
          <span className="block truncate text-sm font-[550] text-text-primary">
            {linha.titulo}
          </span>
          <span className="mt-0.5 block truncate text-xs text-text-tertiary">{linha.projeto}</span>
        </span>
        <ChipsDasPartes
          partes={linha.partes}
          className="basis-full md:w-[150px] md:basis-auto md:shrink-0"
        />
        <TrilhoAteOAr pontos={linha.trilho} />
        <span
          className={cn(
            'min-w-0 flex-1 text-[12.5px] font-[600] md:w-[160px] md:flex-none md:truncate md:text-right',
            TOM_DO_ESTADO[linha.estado.tom],
          )}
        >
          {linha.estado.texto}
        </span>
        <span className="shrink-0 whitespace-nowrap text-right text-xs text-text-tertiary md:w-[50px]">
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
        titulo={filtrada ? 'Nenhuma demanda neste filtro' : 'Nenhuma demanda nos últimos 30 dias'}
        descricao={
          filtrada ? 'Volte para todas as demandas.' : 'As novas aparecem aqui assim que chegam.'
        }
      />
    )
  }
  return (
    <div className="space-y-6">
      {comLinhas.map((g) => (
        <section key={g.chave} aria-labelledby={`grupo-${g.chave}`} className="scroll-mt-4">
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
