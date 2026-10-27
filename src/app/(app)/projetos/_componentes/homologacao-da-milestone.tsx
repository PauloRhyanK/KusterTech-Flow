import Link from 'next/link'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional } from '@/lib/ui/lista-operacional'
import { apresentarEstadoDoItem } from '@/modules/homologacao/model'
import type {
  ConsolidadoDaMilestone,
  HomologacaoDaMilestoneNoCliente,
  LinhaDaHomologacaoDaMilestone,
} from '@/modules/homologacao/queries'
import { EstadoSemAmbienteQa } from './fila-de-homologacao'

export type HomologacaoDaMilestoneProps = { hrefAmbientes: string | null } & (
  | { contexto: 'cliente'; cliente: { nome: string }; dados: HomologacaoDaMilestoneNoCliente }
  | { contexto: 'global'; consolidado: ConsolidadoDaMilestone }
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
  cliente,
  dados,
  hrefAmbientes,
}: {
  cliente: { nome: string }
  dados: HomologacaoDaMilestoneNoCliente
  hrefAmbientes: string | null
}) {
  if (dados.semAmbienteQa) {
    return <EstadoSemAmbienteQa hrefConfigurarAmbientes={hrefAmbientes} />
  }
  return (
    <div className="space-y-4">
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

function Global({ consolidado }: { consolidado: ConsolidadoDaMilestone }) {
  return (
    <ListaOperacional
      rotulo="Homologação por cliente"
      linhas={consolidado.clientes.map((c) => ({
        id: c.clienteId,
        nome: c.nome,
        estado: <BadgeDeEstado tom={c.resumo.tom}>{c.resumo.texto}</BadgeDeEstado>,
        acoes: (
          <Link href={c.href} className="text-sm text-text-link hover:underline">
            Abrir homologação de {c.nome}
          </Link>
        ),
      }))}
      vazio={
        <EstadoVazio
          tipo="nao-configurado"
          titulo="Esta milestone não está associada a nenhum cliente."
          descricao="Associe clientes à milestone para iniciar a homologação."
        />
      }
    />
  )
}

export function HomologacaoDaMilestone(props: HomologacaoDaMilestoneProps) {
  return props.contexto === 'cliente' ? (
    <NoCliente cliente={props.cliente} dados={props.dados} hrefAmbientes={props.hrefAmbientes} />
  ) : (
    <Global consolidado={props.consolidado} />
  )
}
