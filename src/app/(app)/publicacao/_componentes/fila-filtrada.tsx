import { FilaPorProjeto, type FilaPorProjetoProps } from './fila-por-projeto'

interface FilaFiltradaProps extends FilaPorProjetoProps {
  filtrando: boolean
}

// Com filtro ativo mostra a contagem; sem resultado, só o texto dos filtros (nunca o vazio da fila).
export function FilaFiltrada({ filtrando, linhas, ...resto }: FilaFiltradaProps) {
  const total = linhas.reduce((n, l) => n + (l.publicando ? 1 : 0) + l.aguardando.length, 0)
  const semResultado = filtrando && linhas.length === 0
  return (
    <>
      {filtrando && (
        <p role="status" className="text-sm text-text-secondary">
          {semResultado
            ? 'Nenhum pedido com esses filtros'
            : `${total} ${total === 1 ? 'pedido' : 'pedidos'}`}
        </p>
      )}
      {!semResultado && <FilaPorProjeto linhas={linhas} {...resto} />}
    </>
  )
}
