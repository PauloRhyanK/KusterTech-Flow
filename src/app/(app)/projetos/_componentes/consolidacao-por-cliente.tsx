import Link from 'next/link'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { apresentarEstadoDoItem } from '@/modules/homologacao/model'
import type { ConsolidacaoDaMilestone } from '@/modules/homologacao/queries'

export interface ConsolidacaoPorClienteProps {
  consolidacao: ConsolidacaoDaMilestone
}

// Visão global (D42, D62): contagens por cliente e expansão dos itens; a aprovação só existe no
// contexto do cliente (D63), por isso aqui há apenas o link para lá.
export function ConsolidacaoPorCliente({ consolidacao }: ConsolidacaoPorClienteProps) {
  if (consolidacao.clientes.length === 0) {
    return (
      <EstadoVazio
        tipo="nenhum-registro"
        titulo="Nenhum cliente associado a esta milestone."
        descricao="Associe clientes na milestone para acompanhar a homologação de cada um."
      />
    )
  }
  return (
    <section aria-labelledby="homologacao-por-cliente" className="space-y-3">
      <h2 id="homologacao-por-cliente" className="text-base font-[600] text-text-primary">
        Homologação por cliente
      </h2>
      <p className="text-sm text-text-secondary">{consolidacao.resumo}</p>
      <ul className="divide-y divide-border rounded-padrao border border-border bg-surface">
        {consolidacao.clientes.map((c) => (
          <li key={c.clienteId} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-[600] text-text-primary">{c.nome}</span>
              {c.estado === 'APROVADA' ? (
                <BadgeDeEstado tom="sucesso">Milestone aprovada</BadgeDeEstado>
              ) : (
                <BadgeDeEstado tom="informacao">Em andamento</BadgeDeEstado>
              )}
              {c.estado === 'APROVADA' && c.aprovadaEm && (
                <span className="text-sm text-text-secondary">
                  em {formatarDataHora(c.aprovadaEm)}
                </span>
              )}
            </div>
            <p className="text-sm text-text-secondary">{c.situacoes}</p>
            <details>
              <summary className="cursor-pointer text-sm text-text-link hover:underline">
                Ver itens de {c.nome}
              </summary>
              {c.itens.length === 0 ? (
                <p className="mt-2 text-sm text-text-secondary">
                  Nenhum item em homologação ainda.
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {c.itens.map((i) => {
                    const { texto, tom } = apresentarEstadoDoItem(i.estado)
                    return (
                      <li key={i.issueId} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-text-primary">
                          #{i.numero} {i.titulo}
                        </span>
                        <BadgeDeEstado tom={tom}>{texto}</BadgeDeEstado>
                        {i.versao && <span className="text-text-secondary">{i.versao}</span>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </details>
            <Link href={c.href} className="inline-block text-sm text-text-link hover:underline">
              Abrir homologação de {c.nome}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
