import { BarraDeProgresso } from '@/lib/ui/barra-de-progresso'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional, type LinhaOperacional } from '@/lib/ui/lista-operacional'
import { formatarData } from '@/lib/data'
import type { MilestoneNaLista } from '@/modules/entregas/queries'
import type { RotasDoProjeto } from '@/modules/projetos/model'

export interface ListaDeMilestonesProps {
  rotas: RotasDoProjeto
  milestones: readonly MilestoneNaLista[]
  rotulo?: string
  vazio?: { titulo: string; descricao: string }
}

const VAZIO_PADRAO = {
  titulo: 'Nenhuma milestone criada.',
  descricao: 'Crie uma milestone para organizar as issues deste projeto.',
}

export function ListaDeMilestones({
  rotas,
  milestones,
  rotulo = 'Milestones',
  vazio = VAZIO_PADRAO,
}: ListaDeMilestonesProps) {
  const linhas: LinhaOperacional[] = milestones.map((m) => {
    const prazo = m.prazo ? `Prazo ${formatarData(m.prazo)}` : 'Sem prazo'
    const clientes =
      m.clientes.length > 0 ? m.clientes.map((c) => c.nome).join(', ') : 'Nenhum cliente'
    return {
      id: m.id,
      href: rotas.milestone(m.id),
      nome: m.titulo,
      contexto: `${prazo} · ${clientes}`,
      indicador: (
        <div className="space-y-0.5">
          <BarraDeProgresso progresso={m.progresso} />
          <p className="text-xs text-text-secondary">Homologação: ambientes não configurados</p>
        </div>
      ),
      estado: m.arquivadaEm ? <BadgeDeEstado tom="neutro">Arquivada</BadgeDeEstado> : undefined,
    }
  })

  return (
    <ListaOperacional
      rotulo={rotulo}
      linhas={linhas}
      vazio={
        <EstadoVazio tipo="nenhum-registro" titulo={vazio.titulo} descricao={vazio.descricao} />
      }
    />
  )
}
