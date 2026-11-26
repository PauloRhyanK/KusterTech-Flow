import Link from 'next/link'
import type { TabelaDeDemandas as Tabela } from '@/modules/demandas/apresentacao'
import {
  CHAVES_DA_TABELA,
  type FiltrosDaTabela,
  type OrdemDaTabela,
} from '@/modules/demandas/model'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { CLASSE_DO_CARTAO } from '@/lib/ui/titulo-de-secao'
import { cn } from '@/lib/utils'
import { ChipsDasPartes } from './chips-das-partes'
import { Linha, TOM_DO_ESTADO } from './lista-de-demandas'
import { TrilhoAteOAr } from './trilho-ate-o-ar'

// O sentido em que cada coluna começa: texto de A a Z, estado do que pede você primeiro, datas recentes primeiro.
const SENTIDO_NATURAL: Record<OrdemDaTabela, 'asc' | 'desc'> = {
  demanda: 'asc',
  estado: 'asc',
  criada: 'desc',
  atualizada: 'desc',
}

const PARAMETRO: Record<(typeof CHAVES_DA_TABELA)[number], keyof FiltrosDaTabela> = {
  cliente: 'cliente',
  projeto: 'projeto',
  repositorio: 'repositorio',
  tipo: 'tipo',
  estado: 'estado',
  periodo: 'periodo',
  q: 'texto',
  ordem: 'ordem',
  sentido: 'sentido',
}

/** O link do cabeçalho: mantém os filtros; a coluna ativa inverte o sentido, outra começa no natural. */
export function hrefDaOrdem(filtros: FiltrosDaTabela, ordem: OrdemDaTabela): string {
  const sentido =
    filtros.ordem === ordem ? (filtros.sentido === 'asc' ? 'desc' : 'asc') : SENTIDO_NATURAL[ordem]
  const valores: FiltrosDaTabela = { ...filtros, ordem, sentido }
  const busca = new URLSearchParams()
  for (const chave of CHAVES_DA_TABELA) {
    const v = valores[PARAMETRO[chave]]
    if (v !== null && !(chave === 'periodo' && v === '30d')) busca.set(chave, v)
  }
  if (filtros.destino) busca.set('destino', filtros.destino)
  return `/demandas?${busca.toString()}`
}

function Cabecalho({
  rotulo,
  ordem,
  filtros,
  className,
}: {
  rotulo: string
  ordem?: OrdemDaTabela
  filtros: FiltrosDaTabela
  className?: string
}) {
  const ativa = ordem !== undefined && filtros.ordem === ordem
  return (
    <th
      scope="col"
      aria-sort={ativa ? (filtros.sentido === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn(
        'whitespace-nowrap px-3 py-2 text-left text-[11.5px] font-[600] text-text-tertiary first:pl-4 last:pr-4',
        className,
      )}
    >
      {ordem ? (
        <Link
          href={hrefDaOrdem(filtros, ordem)}
          className={cn('hover:text-text-primary', ativa && 'text-text-primary')}
        >
          {rotulo}
          {ativa && <span aria-hidden="true">{filtros.sentido === 'asc' ? ' ↑' : ' ↓'}</span>}
        </Link>
      ) : (
        rotulo
      )}
    </th>
  )
}

/** A tabela das demandas filtradas; no celular, a lista empilhada de sempre. */
export function TabelaDeDemandas({
  tabela,
  filtros,
}: {
  tabela: Tabela
  filtros: FiltrosDaTabela
}) {
  const n = tabela.linhas.length
  if (n === 0) {
    return (
      <EstadoVazio
        tipo="nenhum-registro"
        titulo="Nenhuma demanda neste filtro"
        descricao="Mude os filtros ou amplie o período."
        acao={
          <Link href="/demandas" className="text-sm text-text-link hover:underline">
            Limpar
          </Link>
        }
      />
    )
  }
  return (
    <section aria-label="Demandas filtradas" className="space-y-2.5">
      <p className="text-[12.5px] text-text-tertiary">
        {n} {n === 1 ? 'demanda' : 'demandas'}
        {tabela.truncada && (
          <span className="ml-2 text-atencao">
            Mostrando só as 200 primeiras nesta ordem. Refine os filtros.
          </span>
        )}
      </p>
      <div className={cn(CLASSE_DO_CARTAO, 'hidden overflow-hidden md:block')}>
        <table className="w-full table-fixed text-sm">
          <thead className="border-b border-border">
            <tr>
              <Cabecalho rotulo="Demanda" ordem="demanda" filtros={filtros} className="w-auto" />
              <Cabecalho rotulo="Cliente" filtros={filtros} className="w-[130px]" />
              <Cabecalho rotulo="Repositório" filtros={filtros} className="w-[130px]" />
              <Cabecalho rotulo="Partes" filtros={filtros} className="w-[150px]" />
              <Cabecalho rotulo="Trilho" filtros={filtros} className="w-[174px]" />
              <Cabecalho rotulo="Estado" ordem="estado" filtros={filtros} className="w-[170px]" />
              <Cabecalho
                rotulo="Atualizada"
                ordem="atualizada"
                filtros={filtros}
                className="w-[96px] text-right"
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tabela.linhas.map((l) => (
              <tr key={l.id} className="relative hover:bg-surface-subtle">
                <td className="min-w-0 py-2.5 pl-4 pr-3">
                  <Link
                    href={l.href}
                    className="block truncate font-[550] text-text-primary after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-focus-ring"
                  >
                    {l.titulo}
                  </Link>
                  <span className="mt-0.5 block truncate text-xs text-text-tertiary">
                    {l.projeto}
                  </span>
                </td>
                <td className="truncate px-3 text-[12.5px] text-text-secondary">{l.cliente}</td>
                <td className="truncate px-3 text-[12.5px] text-text-secondary">{l.repositorio}</td>
                <td className="px-3">
                  <ChipsDasPartes partes={l.partes} />
                </td>
                <td className="px-3">
                  <TrilhoAteOAr pontos={l.trilho} />
                </td>
                <td
                  className={cn(
                    'truncate px-3 text-[12.5px] font-[600]',
                    TOM_DO_ESTADO[l.estado.tom],
                  )}
                >
                  {l.estado.texto}
                </td>
                <td className="whitespace-nowrap py-2.5 pl-3 pr-4 text-right text-xs text-text-tertiary">
                  {l.idade}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={cn(CLASSE_DO_CARTAO, 'divide-y divide-border overflow-hidden md:hidden')}>
        {tabela.linhas.map((l) => (
          <Linha key={l.id} linha={l} />
        ))}
      </ul>
    </section>
  )
}
