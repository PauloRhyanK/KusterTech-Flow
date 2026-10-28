import { Button } from '@/components/ui/button'
import { rotuloDoTipo, type TipoRecurso } from '@/modules/infra/model'
import type { FiltrosDoInventario as Filtros } from '@/modules/infra/queries'

export interface FiltrosDoInventarioProps {
  filtros: Filtros
  projetos: readonly { id: string; nome: string }[]
}

const TIPOS: readonly TipoRecurso[] = ['SERVIDOR', 'CONTAINER', 'BANCO', 'STORAGE', 'OUTRO']
const SITUACOES: readonly { valor: Filtros['situacao']; rotulo: string }[] = [
  { valor: 'todas', rotulo: 'Todas' },
  { valor: 'com-alerta', rotulo: 'Com alerta' },
  { valor: 'sem-dados', rotulo: 'Sem dados' },
  { valor: 'arquivados', rotulo: 'Arquivados' },
]

const CLASSE_CAMPO =
  'h-8 rounded-compacto border border-border bg-surface px-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

export function FiltrosDoInventario({ filtros, projetos }: FiltrosDoInventarioProps) {
  return (
    <form
      method="GET"
      action="/infraestrutura"
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="space-y-1">
        <label htmlFor="filtro-tipo" className="block text-xs font-medium text-text-secondary">
          Tipo
        </label>
        <select
          id="filtro-tipo"
          name="tipo"
          defaultValue={filtros.tipo ?? ''}
          className={CLASSE_CAMPO}
        >
          <option value="">Todos</option>
          {TIPOS.map((t) => (
            <option key={t} value={t}>
              {rotuloDoTipo(t)}
            </option>
          ))}
        </select>
      </div>
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
      <Button type="submit" variant="secondary">
        Filtrar
      </Button>
    </form>
  )
}
