import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ROTULO_DO_DESTINO, type TelaDeDemandas } from '@/modules/demandas/apresentacao'
import { ROTULO_DO_TIPO } from '@/modules/decidir/model'
import type {
  EstadoDaTabela,
  FiltrosDaTabela,
  OrdemDaTabela,
  PeriodoDaTabela,
} from '@/modules/demandas/model'

const ROTULO_DO_ESTADO: Record<EstadoDaTabela, string> = {
  espera_voce: 'Espera você',
  nao_chegou: 'Não chegou ao ar',
  a_caminho: 'A caminho',
  no_ar: 'No ar',
  encerrada: 'Encerrada',
}

const ROTULO_DO_PERIODO: Record<PeriodoDaTabela, string> = {
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  tudo: 'Todo o histórico',
}

export const ROTULO_DA_ORDEM: Record<OrdemDaTabela, string> = {
  atualizada: 'Atualizada',
  criada: 'Criada',
  demanda: 'Demanda',
  estado: 'Estado',
}

const CLASSE_DO_CAMPO =
  'h-8 w-full min-w-0 rounded-compacto border border-border bg-surface px-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

const opcoesDe = <T extends string>(rotulos: Record<T, string>) =>
  (Object.keys(rotulos) as T[]).map((valor) => ({ valor, rotulo: rotulos[valor] }))

function Seletor({
  nome,
  rotulo,
  valor,
  opcoes,
  todos = true,
}: {
  nome: string
  rotulo: string
  valor: string | null
  opcoes: readonly { valor: string; rotulo: string }[]
  todos?: boolean
}) {
  const id = `filtro-${nome}`
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[11.5px] text-text-tertiary">
        {rotulo}
      </label>
      <select id={id} name={nome} defaultValue={valor ?? ''} className={CLASSE_DO_CAMPO}>
        {todos && <option value="">Todos</option>}
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Os filtros da tabela: um formulário GET, sem JavaScript; a URL guarda tudo. */
export function BarraDeFiltros({
  filtros,
  opcoes,
  ativa,
}: {
  filtros: FiltrosDaTabela
  opcoes: TelaDeDemandas['opcoes']
  ativa: boolean
}) {
  return (
    <form
      method="get"
      action="/demandas"
      aria-label="Filtros das demandas"
      className="grid grid-cols-2 items-end gap-2.5 md:grid-cols-4 xl:grid-cols-[repeat(8,minmax(0,1fr))_minmax(0,1.6fr)_auto]"
    >
      <Seletor nome="cliente" rotulo="Cliente" valor={filtros.cliente} opcoes={opcoes.clientes} />
      <Seletor nome="projeto" rotulo="Projeto" valor={filtros.projeto} opcoes={opcoes.projetos} />
      <Seletor
        nome="repositorio"
        rotulo="Repositório"
        valor={filtros.repositorio}
        opcoes={opcoes.repositorios}
      />
      <Seletor nome="tipo" rotulo="Tipo" valor={filtros.tipo} opcoes={opcoesDe(ROTULO_DO_TIPO)} />
      <Seletor
        nome="estado"
        rotulo="Estado"
        valor={filtros.estado}
        opcoes={opcoesDe(ROTULO_DO_ESTADO)}
      />
      <Seletor
        nome="destino"
        rotulo="Destino"
        valor={filtros.destino}
        opcoes={opcoesDe(ROTULO_DO_DESTINO)}
      />
      <Seletor
        nome="periodo"
        rotulo="Período"
        valor={filtros.periodo}
        opcoes={opcoesDe(ROTULO_DO_PERIODO)}
        todos={false}
      />
      <Seletor
        nome="ordem"
        rotulo="Ordenar por"
        valor={filtros.ordem}
        opcoes={opcoesDe(ROTULO_DA_ORDEM)}
        todos={false}
      />
      <input type="hidden" name="sentido" value={filtros.sentido} />
      <div className="col-span-2 min-w-0 md:col-span-3 xl:col-span-1">
        <label htmlFor="filtro-q" className="mb-1 block text-[11.5px] text-text-tertiary">
          Buscar no título
        </label>
        <input
          id="filtro-q"
          name="q"
          type="search"
          defaultValue={filtros.texto ?? ''}
          maxLength={120}
          className={CLASSE_DO_CAMPO}
        />
      </div>
      <div className="col-span-2 flex items-center gap-3 md:col-span-1">
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {ativa && (
          <Link href="/demandas" className="text-sm text-text-link hover:underline">
            Limpar
          </Link>
        )}
      </div>
    </form>
  )
}
