import { Button } from '@/components/ui/button'
import type { FiltrosDaFila as Filtros } from '@/modules/desenvolvimento/queries'

export interface FiltrosDaFilaProps {
  filtros: Filtros
  projetos: readonly { id: string; nome: string }[]
}

const SITUACOES: readonly { valor: Filtros['situacao']; rotulo: string }[] = [
  { valor: 'abertos', rotulo: 'Em aberto' },
  { valor: 'intervencao', rotulo: 'Requer intervenção' },
  { valor: 'encerrados', rotulo: 'Encerrados' },
  { valor: 'todos', rotulo: 'Todos' },
]

const ORIGENS: readonly { valor: Filtros['origem']; rotulo: string }[] = [
  { valor: 'todas', rotulo: 'Todas' },
  { valor: 'github', rotulo: 'GitHub' },
  { valor: 'warren', rotulo: 'Warren' },
]

const CLASSE_CAMPO =
  'h-8 w-full max-w-full rounded-compacto border border-border bg-surface px-2 sm:w-auto sm:max-w-[16rem] text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

export function FiltrosDaFila({ filtros, projetos }: FiltrosDaFilaProps) {
  return (
    <form
      method="GET"
      action="/desenvolvimento"
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="space-y-1">
        <label htmlFor="filtro-projeto" className="block text-xs font-medium text-text-secondary">
          Projeto
        </label>
        <select
          id="filtro-projeto"
          name="projeto"
          defaultValue={filtros.projetoId ?? ''}
          className={CLASSE_CAMPO}
        >
          <option value="">Todos</option>
          {projetos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="filtro-situacao" className="block text-xs font-medium text-text-secondary">
          Situação
        </label>
        <select
          id="filtro-situacao"
          name="situacao"
          defaultValue={filtros.situacao}
          className={CLASSE_CAMPO}
        >
          {SITUACOES.map((s) => (
            <option key={s.valor} value={s.valor}>
              {s.rotulo}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="filtro-origem" className="block text-xs font-medium text-text-secondary">
          Origem
        </label>
        <select
          id="filtro-origem"
          name="origem"
          defaultValue={filtros.origem}
          className={CLASSE_CAMPO}
        >
          {ORIGENS.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary">
        Filtrar
      </Button>
    </form>
  )
}
