import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional } from '@/lib/ui/lista-operacional'
import { apresentarEstadoDoItem } from '@/modules/homologacao/model'
import type {
  CorrecaoNaTela,
  HomologacaoDaIssue,
  HomologacaoDaIssueDoCliente,
  SituacaoDoReteste,
} from '@/modules/homologacao/queries'
import { AcoesDeHomologacao } from './acoes-de-homologacao'
import { ConfirmacaoDeReteste } from './confirmacao-de-reteste'
import { RodadasDaTimeline } from './rodadas-da-timeline'
import { BlocoDaCorrecao } from './situacao-da-correcao'

export interface HomologacaoDaIssueNoClienteProps {
  dados: HomologacaoDaIssue
  projetoId: string
  issue: { id: string; numero: number; repositorio: string }
  hrefDaMilestone: (milestoneId: string) => string
  hrefDeRetorno?: string | null
  correcoes?: {
    lista: readonly CorrecaoNaTela[]
    podeTriar: boolean
    integracaoConfigurada: boolean
  }
  // Só o admin recebe; o motivo e as versões da confirmação manual do reteste (5b.4).
  reteste?: SituacaoDoReteste
}

function VoltarParaAFila({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-block text-sm text-text-link hover:underline">
      Voltar à fila
    </Link>
  )
}

function Faixa({ dados }: { dados: HomologacaoDaIssue }) {
  const itens: [string, string][] = [
    ['Cliente', dados.cliente.nome],
    ['Milestone', dados.milestone?.titulo ?? '—'],
    ['Versão em QA', dados.versaoCorrente?.rotulo ?? '—'],
  ]
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
      {itens.map(([rotulo, valor]) => (
        <div key={rotulo}>
          <dt className="text-text-secondary">{rotulo}</dt>
          <dd className="font-[600] text-text-primary">{valor}</dd>
        </div>
      ))}
    </dl>
  )
}

function Conteudo({
  dados,
  projetoId,
  issue,
  hrefDaMilestone,
  hrefDeRetorno,
  correcoes,
  reteste,
}: HomologacaoDaIssueNoClienteProps) {
  switch (dados.situacao) {
    case 'sem-ambiente-qa':
      return (
        <EstadoVazio
          tipo="nao-configurado"
          titulo="O ambiente QA ainda não está configurado neste projeto."
          descricao="A homologação começa depois que o ambiente QA receber a primeira evidência de deploy."
        />
      )
    case 'fora-de-milestone':
      return (
        <EstadoVazio
          tipo="nenhum-registro"
          titulo="Esta issue não está em nenhuma milestone deste cliente."
          descricao="A homologação acontece por milestone."
        />
      )
    case 'escolher-milestone':
      return (
        <div className="space-y-2">
          <p className="text-sm text-text-primary">Escolha a milestone para homologar:</p>
          <ul className="space-y-1 text-sm">
            {dados.milestones.map((m) => (
              <li key={m.id}>
                <Link href={hrefDaMilestone(m.id)} className="text-text-link hover:underline">
                  {m.titulo}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )
    case 'fora-da-fila':
      return (
        <EstadoVazio
          tipo="sem-evidencia"
          titulo="Esta issue ainda não está na fila de homologação."
          descricao="Ela entra quando a presença na versão atual de QA for confirmada por evidência ou confirmação manual."
        />
      )
    case 'aguardando-disponibilizacao-oculta':
      return (
        <EstadoVazio
          tipo="nenhum-registro"
          titulo="Esta issue ainda não foi disponibilizada para teste."
          descricao="Ela aparece aqui quando for disponibilizada ao cliente."
        />
      )
    case 'com-item': {
      const { item, milestone } = dados
      if (!item || !milestone) {
        return null
      }
      const estado = apresentarEstadoDoItem(item.estado)
      const eventos = dados.eventos.map((evento) => {
        const correcao = correcoes?.lista.find((c) => c.eventoId === evento.id)
        return correcao
          ? {
              ...evento,
              anexo: (
                <BlocoDaCorrecao
                  correcao={correcao}
                  podeTriar={correcoes?.podeTriar ?? false}
                  integracaoConfigurada={correcoes?.integracaoConfigurada ?? false}
                  projetoId={projetoId}
                  clienteId={dados.cliente.id}
                  issueId={issue.id}
                  milestoneId={milestone.id}
                  issueNumero={issue.numero}
                  issueTitulo={correcao.issueOriginal.titulo}
                />
              ),
            }
          : evento
      })
      return (
        <div className="space-y-4">
          <BadgeDeEstado tom={estado.tom}>{estado.texto}</BadgeDeEstado>
          <RodadasDaTimeline
            rotulo="Histórico de homologação"
            eventos={eventos}
            versaoAtualId={item.versaoAvaliada?.id ?? null}
            vazio="Nenhum evento registrado."
          />
          {reteste?.disponivel && (
            <ConfirmacaoDeReteste
              projetoId={projetoId}
              clienteId={dados.cliente.id}
              itemId={item.id}
              ofertar={item.estado === 'CORRECAO_SOLICITADA'}
              motivo={reteste.motivo}
              versoesEmQa={reteste.versoesEmQa}
            />
          )}
          {dados.acoes.length > 0 && (
            <AcoesDeHomologacao
              projetoId={projetoId}
              clienteId={dados.cliente.id}
              clienteNome={dados.cliente.nome}
              milestoneId={milestone.id}
              milestoneTitulo={milestone.titulo}
              issueId={issue.id}
              issueNumero={issue.numero}
              repositorio={issue.repositorio}
              itemId={item.id}
              ultimoEventoId={item.ultimoEventoId}
              versao={dados.versaoCorrente}
              acoes={dados.acoes.map((a) => a.acao)}
              recusa={dados.recusa}
              podeEscolherVisibilidade={dados.podeEscolherVisibilidade}
              hrefDeRetorno={hrefDeRetorno}
            />
          )}
        </div>
      )
    }
  }
}

// Contexto de cliente (D63): aqui, e só aqui, ficam os formulários de homologação.
export function HomologacaoDaIssueNoCliente(props: HomologacaoDaIssueNoClienteProps) {
  return (
    <section
      aria-labelledby="homologacao-da-issue"
      className="space-y-4 rounded-padrao border border-border bg-surface p-6"
    >
      <h2 id="homologacao-da-issue" className="text-[15px] font-[600] text-text-primary">
        Homologação de {props.dados.cliente.nome}
      </h2>
      {props.hrefDeRetorno && <VoltarParaAFila href={props.hrefDeRetorno} />}
      <Faixa dados={props.dados} />
      <Conteudo {...props} />
    </section>
  )
}

// Visão global (D65): só direciona para o contexto do cliente, sem formulário.
export function HomologacaoDaIssuePorCliente({
  linhas,
}: {
  linhas: readonly HomologacaoDaIssueDoCliente[]
}) {
  return (
    <section aria-labelledby="homologacao-por-cliente" className="space-y-4">
      <h2 id="homologacao-por-cliente" className="text-[15px] font-[600] text-text-primary">
        Homologação por cliente
      </h2>
      <ListaOperacional
        rotulo="Homologação por cliente"
        linhas={linhas.map((l) => {
          const estado = l.estado ? apresentarEstadoDoItem(l.estado) : null
          return {
            id: `${l.clienteId}-${l.milestoneId}`,
            nome: `${l.clienteNome} · ${l.milestoneTitulo}`,
            estado: estado ? (
              <BadgeDeEstado tom={estado.tom}>{estado.texto}</BadgeDeEstado>
            ) : (
              <BadgeDeEstado tom="neutro">Fora da fila</BadgeDeEstado>
            ),
            acoes: (
              <Link href={l.href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Abrir no contexto de {l.clienteNome}
              </Link>
            ),
          }
        })}
        vazio={
          <EstadoVazio
            tipo="nenhum-registro"
            titulo="Nenhum cliente homologa esta issue ainda."
            descricao="A homologação começa quando a issue está numa milestone associada a um cliente."
          />
        }
      />
    </section>
  )
}
