import type { ReactNode } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional } from '@/lib/ui/lista-operacional'
import {
  apresentarEstadoDoItem,
  type FiltroDaFila,
  type FiltrosDaFila,
  hrefDaFila,
} from '@/modules/homologacao/model'
import type { FilaDeHomologacao as Fila } from '@/modules/homologacao/queries'
import { AvisoDeIntegracao } from './aviso-de-integracao'

export interface FilaDeHomologacaoProps {
  fila: Fila
  filtros: FiltrosDaFila
  base: string
  global: boolean
  escopado: boolean
  hrefConfigurarAmbientes: string | null
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

const ROTULOS_DOS_FILTROS: readonly [FiltroDaFila, string][] = [
  ['requer-minha-acao', 'Requer minha ação'],
  ['aguardando-outros', 'Aguardando outros'],
  ['aprovados', 'Aprovados'],
  ['todos', 'Todos'],
]

const VAZIO_DO_FILTRO: Record<FiltroDaFila, { titulo: string; descricao: string }> = {
  'requer-minha-acao': {
    titulo: 'Nada requer sua ação agora.',
    descricao: 'Aguardando outros e Aprovados mostram o restante.',
  },
  'aguardando-outros': {
    titulo: 'Nada aguardando outras pessoas.',
    descricao: 'Mude o filtro para ver o restante.',
  },
  aprovados: {
    titulo: 'Nenhuma issue aprovada ainda.',
    descricao: 'Mude o filtro para ver o restante.',
  },
  todos: {
    titulo: 'Nenhuma issue na fila.',
    descricao: 'Mude o cliente ou a milestone para ver o restante.',
  },
}

function SemItens({ fila, props }: { fila: Fila; props: FilaDeHomologacaoProps }): ReactNode {
  switch (fila.situacao) {
    case 'sem-ambiente-qa':
      return (
        <EstadoVazio
          tipo="nao-configurado"
          titulo="O ambiente QA ainda não está configurado neste projeto."
          descricao="As issues entram na fila quando a presença em QA é confirmada."
          acao={
            props.hrefConfigurarAmbientes ? (
              <Link
                href={props.hrefConfigurarAmbientes}
                className="text-sm text-text-link hover:underline"
              >
                Configurar ambientes
              </Link>
            ) : undefined
          }
        />
      )
    case 'sem-milestones-com-cliente':
      return (
        <EstadoVazio
          tipo="nao-configurado"
          titulo="Nenhuma milestone associada a clientes."
          descricao="Associe clientes às milestones em Entregas para iniciar a homologação."
        />
      )
    case 'sem-itens':
      return props.escopado ? (
        <EstadoVazio
          tipo="nenhum-registro"
          titulo="Nenhuma issue disponível para teste."
          descricao="As issues aparecem aqui quando forem disponibilizadas ao cliente."
        />
      ) : (
        <EstadoVazio
          tipo="sem-evidencia"
          titulo="Nenhuma issue com presença confirmada em QA."
          descricao="As issues entram na fila quando a presença na versão atual de QA é confirmada por evidência ou confirmação manual."
        />
      )
    case 'com-itens':
      return null
  }
}

function Filtros({ fila, filtros, base, global }: FilaDeHomologacaoProps) {
  return (
    <div className="space-y-4">
      <nav aria-label="Filtros da fila">
        <ul className="flex flex-wrap gap-2 text-sm">
          {ROTULOS_DOS_FILTROS.map(([valor, rotulo]) => {
            const ativo = filtros.filtro === valor
            return (
              <li key={valor}>
                <Link
                  href={hrefDaFila(base, { ...filtros, filtro: valor })}
                  aria-current={ativo ? 'page' : undefined}
                  className={
                    ativo
                      ? 'rounded-compacto border border-border bg-surface-subtle px-3 py-1.5 font-[600] text-text-primary'
                      : 'rounded-compacto border border-transparent px-3 py-1.5 text-text-secondary hover:text-text-primary'
                  }
                >
                  {rotulo} ({fila.contagens[valor]})
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <form method="get" action={base} className="flex flex-col gap-3 md:flex-row md:items-end">
        <input type="hidden" name="filtro" value={filtros.filtro} />
        {global && (
          <div className="space-y-1">
            <label htmlFor="fila-cliente" className="block text-sm font-medium text-text-primary">
              Cliente
            </label>
            <select
              id="fila-cliente"
              name="cliente"
              defaultValue={filtros.clienteId ?? ''}
              className={CLASSE_CAMPO}
            >
              <option value="">Todos os clientes</option>
              {fila.clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="fila-milestone" className="block text-sm font-medium text-text-primary">
            Milestone
          </label>
          <select
            id="fila-milestone"
            name="milestone"
            defaultValue={filtros.milestoneId ?? ''}
            className={CLASSE_CAMPO}
          >
            <option value="">Todas as milestones</option>
            {fila.milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.titulo}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Filtrar</Button>
      </form>
    </div>
  )
}

export function FilaDeHomologacao(props: FilaDeHomologacaoProps) {
  const { fila, filtros, global } = props
  const vazioSemItens = SemItens({ fila, props })
  const vazioDoFiltro = VAZIO_DO_FILTRO[filtros.filtro]

  return (
    <section aria-labelledby="fila-de-homologacao" className="space-y-4">
      <h2 id="fila-de-homologacao" className="text-lg font-semibold text-text-primary">
        Fila de homologação
      </h2>
      {fila.integracao && (
        <AvisoDeIntegracao
          situacao={fila.integracao}
          sincronizadoEm={fila.integracao.catalogoSincronizadoEm}
          hrefConfiguracao={null}
        />
      )}
      {vazioSemItens ?? (
        <>
          <Filtros {...props} />
          {fila.grupos.length === 0 && (
            <EstadoVazio
              tipo="nenhum-registro"
              titulo={vazioDoFiltro.titulo}
              descricao={vazioDoFiltro.descricao}
            />
          )}
          {fila.grupos.map((grupo) => (
            <div key={grupo.milestone.id} className="space-y-2">
              <h3 className="text-[15px] font-[600] text-text-primary">{grupo.milestone.titulo}</h3>
              <ListaOperacional
                rotulo={`Fila da milestone ${grupo.milestone.titulo}`}
                vazio={null}
                linhas={grupo.itens.map((item) => {
                  const estado = apresentarEstadoDoItem(item.estado)
                  return {
                    id: item.id,
                    nome: (
                      <span id={`item-${item.id}`} className="scroll-mt-24">
                        <Link href={item.href} className="hover:underline">
                          #{item.issueNumero} {item.issueTitulo}
                        </Link>
                      </span>
                    ),
                    contexto: global
                      ? `${item.clienteNome} · ${item.repositorio}`
                      : item.repositorio,
                    estado: <BadgeDeEstado tom={estado.tom}>{estado.texto}</BadgeDeEstado>,
                    indicador: (
                      <span className="text-text-secondary">
                        {item.versaoRotulo ? `Versão ${item.versaoRotulo}` : 'Sem versão'}
                      </span>
                    ),
                  }
                })}
              />
            </div>
          ))}
        </>
      )}
    </section>
  )
}
