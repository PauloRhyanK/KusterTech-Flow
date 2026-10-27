import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional } from '@/lib/ui/lista-operacional'
import type { PendenciaDeHomologacao } from '@/modules/homologacao/queries'

export interface PendenciasDeHomologacaoProps {
  pendencias: readonly PendenciaDeHomologacao[]
  // O que a linha mostra ao lado da milestone: o projeto (lista do cliente), o cliente (lista do
  // projeto) ou nada (lista que já está dentro de um só projeto e de um só cliente).
  contexto: 'projeto' | 'cliente' | null
  vazio: { titulo: string; descricao: string }
}

export function PendenciasDeHomologacao({
  pendencias,
  contexto,
  vazio,
}: PendenciasDeHomologacaoProps) {
  return (
    <ListaOperacional
      rotulo="Homologações pendentes"
      linhas={pendencias.map((p) => ({
        id: `${p.clienteId}-${p.milestoneId}`,
        nome: p.milestoneTitulo,
        href: p.href,
        contexto:
          contexto === 'projeto'
            ? p.projetoNome
            : contexto === 'cliente'
              ? p.clienteNome
              : undefined,
        estado: <BadgeDeEstado tom={p.resumo.tom}>{p.resumo.texto}</BadgeDeEstado>,
      }))}
      vazio={
        <EstadoVazio tipo="nenhum-registro" titulo={vazio.titulo} descricao={vazio.descricao} />
      }
    />
  )
}
