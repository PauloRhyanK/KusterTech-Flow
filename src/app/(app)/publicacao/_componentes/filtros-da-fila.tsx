import Link from 'next/link'
import type { FiltrosDaFila } from '@/modules/fila-de-publicacao/apresentacao'

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'
const CLASSE_ROTULO = 'block text-xs font-medium text-text-secondary'

export const ESTADOS_DA_FILA = [
  { valor: 'na_fila', rotulo: 'Na fila' },
  { valor: 'verificando', rotulo: 'Verificando' },
  { valor: 'publicando', rotulo: 'Publicando' },
] as const

export const MODOS_DA_FILA = [
  { valor: 'imediato', rotulo: 'Imediato' },
  { valor: 'lote', rotulo: 'Lote' },
] as const

interface FiltrosDaFilaFormProps {
  filtros: FiltrosDaFila
  projetos: { id: string; nome: string }[]
}

export function FiltrosDaFilaForm({ filtros, projetos }: FiltrosDaFilaFormProps) {
  const ativo = Boolean(filtros.projeto || filtros.estado || filtros.modo || filtros.busca)
  // um projeto da URL que não está na fila continua selecionado, para a lista vazia fazer sentido
  const desconhecido =
    filtros.projeto !== null && !projetos.some((p) => p.id === filtros.projeto)
      ? filtros.projeto
      : null
  return (
    <form
      method="get"
      action="/publicacao"
      role="search"
      aria-label="Filtrar a fila"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.4fr)_auto] lg:items-end"
    >
      <div className="space-y-1">
        <label htmlFor="filtro-projeto" className={CLASSE_ROTULO}>
          Projeto
        </label>
        <select
          id="filtro-projeto"
          name="projeto"
          defaultValue={filtros.projeto ?? ''}
          className={CLASSE_CAMPO}
        >
          <option value="">Todos</option>
          {desconhecido && <option value={desconhecido}>Projeto não encontrado</option>}
          {projetos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="filtro-estado" className={CLASSE_ROTULO}>
          Estado
        </label>
        <select
          id="filtro-estado"
          name="estado"
          defaultValue={filtros.estado ?? ''}
          className={CLASSE_CAMPO}
        >
          <option value="">Todos</option>
          {ESTADOS_DA_FILA.map((e) => (
            <option key={e.valor} value={e.valor}>
              {e.rotulo}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="filtro-modo" className={CLASSE_ROTULO}>
          Modo
        </label>
        <select
          id="filtro-modo"
          name="modo"
          defaultValue={filtros.modo ?? ''}
          className={CLASSE_CAMPO}
        >
          <option value="">Todos</option>
          {MODOS_DA_FILA.map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.rotulo}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="filtro-busca" className={CLASSE_ROTULO}>
          Buscar
        </label>
        <input
          id="filtro-busca"
          name="busca"
          type="search"
          maxLength={80}
          placeholder="Projeto, descrição ou commit"
          defaultValue={filtros.busca}
          className={CLASSE_CAMPO}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-compacto border border-border bg-surface px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          Filtrar
        </button>
        {ativo && (
          <Link
            href="/publicacao"
            className="text-sm text-text-secondary underline underline-offset-2 hover:text-text-primary"
          >
            Limpar
          </Link>
        )}
      </div>
    </form>
  )
}
