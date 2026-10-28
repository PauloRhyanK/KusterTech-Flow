import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional } from '@/lib/ui/lista-operacional'
import { apresentarEstadoDoItem } from '@/modules/homologacao/model'
import type {
  AprovacaoDaMilestone as DadosDaAprovacao,
  ConsolidacaoDaMilestone,
  HomologacaoDaMilestoneNoCliente,
  LinhaDaHomologacaoDaMilestone,
} from '@/modules/homologacao/queries'
import { AprovacaoDaMilestone } from './aprovacao-da-milestone'
import { ConsolidacaoPorCliente } from './consolidacao-por-cliente'
import { EstadoSemAmbienteQa } from './fila-de-homologacao'

export type HomologacaoDaMilestoneProps = { hrefAmbientes: string | null } & (
  | {
      contexto: 'cliente'
      projetoId: string
      cliente: { id: string; nome: string }
      milestone: { id: string; titulo: string }
      dados: HomologacaoDaMilestoneNoCliente
      aprovacao: DadosDaAprovacao
    }
  | { contexto: 'global'; consolidacao: ConsolidacaoDaMilestone }
)

function estadoDaLinha(linha: LinhaDaHomologacaoDaMilestone) {
  if (linha.estado) {
    const { texto, tom } = apresentarEstadoDoItem(linha.estado)
    return <BadgeDeEstado tom={tom}>{texto}</BadgeDeEstado>
  }
  if (linha.oculta) {
    return <BadgeDeEstado tom="neutro">Aguardando disponibilização</BadgeDeEstado>
  }
  if (linha.presenca === 'VERIFICACAO_NECESSARIA') {
    return <BadgeDeEstado tom="atencao">Verificação necessária</BadgeDeEstado>
  }
  return <BadgeDeEstado tom="neutro">Ainda não está em QA</BadgeDeEstado>
}

function NoCliente({
  projetoId,
  cliente,
  milestone,
  dados,
  aprovacao,
  hrefAmbientes,
}: {
  projetoId: string
  cliente: { id: string; nome: string }
  milestone: { id: string; titulo: string }
  dados: HomologacaoDaMilestoneNoCliente
  aprovacao: DadosDaAprovacao
  hrefAmbientes: string | null
}) {
  const painel = (
    <AprovacaoDaMilestone
      projetoId={projetoId}
      clienteId={cliente.id}
      clienteNome={cliente.nome}
      milestoneId={milestone.id}
      milestoneTitulo={milestone.titulo}
      aprovacao={aprovacao}
    />
  )
  // Uma aprovação já feita continua visível mesmo que o ambiente QA seja removido depois.
  if (dados.semAmbienteQa) {
    return (
      <div className="space-y-4">
        {aprovacao.estado === 'APROVADA' && painel}
        <EstadoSemAmbienteQa hrefConfigurarAmbientes={hrefAmbientes} />
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {painel}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-text-secondary">
          Versões em QA:{' '}
          {dados.versoes
            .map((v) =>
              v.rotulo ? `${v.repositorio} ${v.rotulo}` : `${v.repositorio} sem evidência`,
            )
            .join(' · ') || 'nenhuma'}
        </p>
        <BadgeDeEstado tom={dados.resumo.tom}>{dados.resumo.texto}</BadgeDeEstado>
      </div>
      <ListaOperacional
        rotulo={`Homologação de ${cliente.nome} na milestone`}
        linhas={dados.linhas.map((linha) => ({
          id: linha.issueId,
          nome: `#${linha.numero} ${linha.titulo}`,
          href: linha.href ?? undefined,
          contexto: linha.repositorio,
          estado: estadoDaLinha(linha),
        }))}
        vazio={
          <EstadoVazio
            tipo="nenhum-registro"
            titulo="Nenhuma issue no escopo desta milestone."
            descricao="As issues aparecem aqui quando forem adicionadas à milestone."
          />
        }
      />
    </div>
  )
}

export function HomologacaoDaMilestone(props: HomologacaoDaMilestoneProps) {
  return props.contexto === 'cliente' ? (
    <NoCliente
      projetoId={props.projetoId}
      cliente={props.cliente}
      milestone={props.milestone}
      dados={props.dados}
      aprovacao={props.aprovacao}
      hrefAmbientes={props.hrefAmbientes}
    />
  ) : (
    <ConsolidacaoPorCliente consolidacao={props.consolidacao} />
  )
}
