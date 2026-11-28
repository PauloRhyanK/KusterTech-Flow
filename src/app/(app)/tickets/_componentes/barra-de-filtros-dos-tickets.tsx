import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { FiltrosDosTickets } from '@/modules/tickets/model'

const CLASSE_DO_CAMPO =
  'h-8 w-full min-w-0 rounded-compacto border border-border bg-surface px-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

type Opcao = { valor: string; rotulo: string }

const CANAIS: Opcao[] = [
  { valor: 'sistema', rotulo: 'App' },
  { valor: 'whatsapp', rotulo: 'WhatsApp' },
]
const RESULTADOS: Opcao[] = [
  { valor: 'virou_demanda', rotulo: 'Virou demanda' },
  { valor: 'orientado', rotulo: 'Orientado na hora' },
  { valor: 'sem_demanda', rotulo: 'Sem demanda' },
]
const PERIODOS: Opcao[] = [
  { valor: '7', rotulo: '7 dias' },
  { valor: '30', rotulo: '30 dias' },
  { valor: '90', rotulo: '90 dias' },
  { valor: 'tudo', rotulo: 'Tudo' },
]
const AGRUPAMENTOS: Opcao[] = [
  { valor: 'dia', rotulo: 'Dia' },
  { valor: 'app', rotulo: 'App' },
  { valor: 'autor', rotulo: 'Quem enviou' },
  { valor: 'demanda', rotulo: 'Demanda' },
]

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
  opcoes: readonly Opcao[]
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

/** Os filtros dos tickets: um formulário GET, sem JavaScript; a URL guarda tudo. */
export function BarraDeFiltrosDosTickets({
  filtros,
  opcoes,
}: {
  filtros: FiltrosDosTickets
  opcoes: { apps: { id: string; nome: string }[]; autores: { id: string; nome: string }[] }
}) {
  const ativa =
    !!(filtros.app || filtros.canal || filtros.autor || filtros.resultado || filtros.q) ||
    filtros.periodo !== '7' ||
    filtros.agrupar !== 'dia' ||
    !!filtros.demanda
  return (
    <form
      method="get"
      action="/tickets"
      role="search"
      aria-label="Filtros dos tickets"
      className="grid grid-cols-2 items-end gap-2.5 md:grid-cols-3 xl:grid-cols-[repeat(6,minmax(0,1fr))_minmax(0,1.6fr)_auto]"
    >
      <Seletor
        nome="app"
        rotulo="App"
        valor={filtros.app}
        opcoes={opcoes.apps.map((a) => ({ valor: a.id, rotulo: a.nome }))}
      />
      <Seletor
        nome="canal"
        rotulo="Canal"
        valor={filtros.canal?.toLowerCase() ?? null}
        opcoes={CANAIS}
      />
      <Seletor
        nome="autor"
        rotulo="Quem enviou"
        valor={filtros.autor}
        opcoes={opcoes.autores.map((a) => ({ valor: a.id, rotulo: a.nome }))}
      />
      <Seletor nome="resultado" rotulo="Resultado" valor={filtros.resultado} opcoes={RESULTADOS} />
      <Seletor
        nome="periodo"
        rotulo="Período"
        valor={filtros.periodo}
        opcoes={PERIODOS}
        todos={false}
      />
      <Seletor
        nome="agrupar"
        rotulo="Agrupar por"
        valor={filtros.agrupar}
        opcoes={AGRUPAMENTOS}
        todos={false}
      />
      {filtros.demanda && <input type="hidden" name="demanda" value={filtros.demanda} />}
      <div className="col-span-2 min-w-0 md:col-span-3 xl:col-span-1">
        <label htmlFor="filtro-q" className="mb-1 block text-[11.5px] text-text-tertiary">
          Buscar no texto
        </label>
        <input
          id="filtro-q"
          name="q"
          type="search"
          defaultValue={filtros.q ?? ''}
          maxLength={120}
          className={CLASSE_DO_CAMPO}
        />
      </div>
      <div className="col-span-2 flex items-center gap-3 md:col-span-3 xl:col-span-1">
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {ativa && (
          <Link href="/tickets" className="text-sm text-text-link hover:underline">
            Limpar filtros
          </Link>
        )}
      </div>
    </form>
  )
}
