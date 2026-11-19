import { CLASSE_DO_CARTAO, TituloDeSecao } from '@/app/(app)/_inicio/titulo-de-secao'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import {
  apresentarContainer,
  formatarBytes,
  idadeCurta,
  ordenarContainers,
  type Container,
} from '@/modules/oficina/model'
import { CABECALHO, CABECALHO_NUMERICO, CELULA, CELULA_NUMERICA } from './tabela-da-maquina'

export interface ContainersDaMaquinaProps {
  containers: Container[] | null
  agora: Date
}

const VISIVEIS = 6

function Linha({ c, agora }: { c: Container; agora: Date }) {
  const estado = apresentarContainer(c)
  const idade = idadeCurta(new Date(c.desde), agora)
  return (
    <tr>
      <td className={`${CELULA} font-mono text-[12.5px] [overflow-wrap:anywhere]`}>{c.nome}</td>
      <td className={CELULA}>
        <BadgeDeEstado tom={estado.tom} className="whitespace-nowrap">
          {estado.texto}
        </BadgeDeEstado>
      </td>
      <td className={CELULA_NUMERICA}>
        {c.memoriaBytes === null ? '—' : formatarBytes(c.memoriaBytes)}
      </td>
      <td className={`${CELULA_NUMERICA} hidden sm:table-cell`}>
        {c.cpuPct === null ? '—' : `${Math.round(c.cpuPct)}%`}
      </td>
      <td className={`${CELULA} hidden whitespace-nowrap text-right sm:table-cell`}>
        {c.estado === 'rodando' ? idade : `parado há ${idade}`}
      </td>
    </tr>
  )
}

function Cabecalho() {
  return (
    <thead>
      <tr>
        <th className={CABECALHO}>Nome</th>
        <th className={CABECALHO}>Estado</th>
        <th className={CABECALHO_NUMERICO}>Memória</th>
        <th className={`${CABECALHO_NUMERICO} hidden sm:table-cell`}>CPU</th>
        <th className={`${CABECALHO_NUMERICO} hidden sm:table-cell`}>No ar há</th>
      </tr>
    </thead>
  )
}

// Os que pararam com erro no topo; depois os que mais consomem memória.
export function ContainersDaMaquina({ containers, agora }: ContainersDaMaquinaProps) {
  const ordenados = containers ? ordenarContainers(containers) : []
  const noAr = ordenados.filter((c) => c.estado === 'rodando').length
  const parados = ordenados.length - noAr
  const resto = ordenados.slice(VISIVEIS)

  return (
    <section aria-labelledby="titulo-containers">
      <TituloDeSecao
        id="titulo-containers"
        complemento={
          containers && containers.length > 0 ? (
            <small className="text-[12.5px] text-text-tertiary">
              {noAr} no ar · {parados} {parados === 1 ? 'parado' : 'parados'}
            </small>
          ) : undefined
        }
      >
        Containers
      </TituloDeSecao>
      <div className={CLASSE_DO_CARTAO}>
        {containers === null ? (
          <p className="p-4 text-[13px] text-text-tertiary">Sem dados</p>
        ) : ordenados.length === 0 ? (
          <p className="p-4 text-[13px] text-text-secondary">Nenhum contêiner informado.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <Cabecalho />
                <tbody>
                  {ordenados.slice(0, VISIVEIS).map((c) => (
                    <Linha key={c.nome} c={c} agora={agora} />
                  ))}
                </tbody>
              </table>
            </div>
            {resto.length > 0 && (
              <details className="group border-t border-border">
                <summary className="cursor-pointer list-none px-4 py-2.5 text-[12.5px] text-text-secondary">
                  mais {resto.length} {resto.length === 1 ? 'container' : 'containers'}
                  <span className="group-open:hidden">
                    {' · '}
                    <span className="font-[550] text-text-link">mostrar todos</span>
                  </span>
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse" aria-label="Demais containers">
                    <tbody>
                      {resto.map((c) => (
                        <Linha key={c.nome} c={c} agora={agora} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  )
}
