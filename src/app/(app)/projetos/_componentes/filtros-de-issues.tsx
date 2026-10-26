import { Button } from '@/components/ui/button'
import type { FiltrosDeIssues as Filtros } from '@/modules/github/queries'

export interface FiltrosDeIssuesProps {
  filtros: Filtros
  repositorios: readonly { id: string; nomeCompleto: string }[]
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

export function FiltrosDeIssues({ filtros, repositorios }: FiltrosDeIssuesProps) {
  return (
    <form method="get" className="flex flex-col gap-3 md:flex-row md:items-end">
      <div className="space-y-1">
        <label htmlFor="filtro-estado" className="block text-sm font-medium text-text-primary">
          Situação
        </label>
        <select
          id="filtro-estado"
          name="estado"
          defaultValue={filtros.estado}
          className={CLASSE_CAMPO}
        >
          <option value="abertas">Abertas</option>
          <option value="fechadas">Fechadas</option>
          <option value="todas">Todas</option>
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="filtro-repositorio" className="block text-sm font-medium text-text-primary">
          Repositório
        </label>
        <select
          id="filtro-repositorio"
          name="repositorio"
          defaultValue={filtros.repositorioId ?? ''}
          className={CLASSE_CAMPO}
        >
          <option value="">Todos</option>
          {repositorios.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.nomeCompleto}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 space-y-1">
        <label htmlFor="filtro-busca" className="block text-sm font-medium text-text-primary">
          Buscar
        </label>
        <input
          id="filtro-busca"
          name="busca"
          type="search"
          maxLength={120}
          defaultValue={filtros.busca}
          placeholder="Título ou #número"
          className={CLASSE_CAMPO}
        />
      </div>
      <Button type="submit">Filtrar</Button>
    </form>
  )
}
