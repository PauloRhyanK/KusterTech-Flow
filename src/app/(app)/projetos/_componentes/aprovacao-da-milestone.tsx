'use client'

import { useActionState } from 'react'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import type { AprovacaoDaMilestone } from '@/modules/homologacao/queries'
import { aprovarMilestoneAction } from '../acoes-de-aprovacao'
import { AvisoDeIntegracao } from './aviso-de-integracao'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface AprovacaoDaMilestoneProps {
  projetoId: string
  clienteId: string
  clienteNome: string
  milestoneId: string
  milestoneTitulo: string
  aprovacao: AprovacaoDaMilestone
}

const TEXTO_DESATUALIZADO =
  'Os dados do GitHub podem estar desatualizados; a aprovação fica disponível depois da próxima sincronização.'

// Painel do contexto do cliente (D63): confere o que a aprovação cobre e só oferece o botão
// quando a regra pura libera e os dados do GitHub estão atuais (D22, A11).
export function AprovacaoDaMilestone(props: AprovacaoDaMilestoneProps) {
  const { aprovacao } = props
  const [estado, enviar, pendente] = useActionState(aprovarMilestoneAction, {})

  const desatualizado =
    aprovacao.situacao.estadoDoProjeto === 'indisponivel' ||
    aprovacao.situacao.estadoDoProjeto === 'sem-dados-recentes'
  const versoes =
    aprovacao.versoes.map((v) => `${v.rotulo} (${v.repositorio})`).join(', ') || 'nenhuma'

  return (
    <section
      aria-labelledby="aprovacao-da-milestone"
      className="space-y-3 rounded-padrao border border-border bg-surface p-4"
    >
      <h2 id="aprovacao-da-milestone" className="text-base font-[600] text-text-primary">
        Aprovação da milestone
      </h2>
      <div className="grid gap-1 text-sm text-text-secondary">
        <p>Cliente: {props.clienteNome}</p>
        <p>Milestone: {props.milestoneTitulo}</p>
        <p>Versões avaliadas: {versoes}</p>
        <p>
          Issues do escopo fechadas: {aprovacao.issuesFechadas} de {aprovacao.issuesNoEscopo}
        </p>
        <p>Correções bloqueadoras: {aprovacao.bloqueadoras}</p>
      </div>

      <MensagensDeEstado estado={estado} />

      {aprovacao.estado === 'APROVADA' ? (
        <div className="flex flex-wrap items-center gap-3">
          <BadgeDeEstado tom="sucesso">Milestone aprovada</BadgeDeEstado>
          {aprovacao.aprovadaPor && aprovacao.aprovadaEm && (
            <p className="text-sm text-text-secondary">
              Aprovada por {aprovacao.aprovadaPor} em {formatarDataHora(aprovacao.aprovadaEm)}
            </p>
          )}
        </div>
      ) : desatualizado ? (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">{TEXTO_DESATUALIZADO}</p>
          <AvisoDeIntegracao
            situacao={aprovacao.situacao}
            sincronizadoEm={null}
            hrefConfiguracao={null}
          />
        </div>
      ) : !aprovacao.avaliacao.pode ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-text-secondary">
          {aprovacao.avaliacao.motivos.map((motivo) => (
            <li key={motivo}>{motivo}</li>
          ))}
        </ul>
      ) : (
        aprovacao.podeAprovar && (
          <BotaoDeConfirmacao
            rotulo="Aprovar milestone"
            rotuloDeConfirmacao={`Confirmar aprovação para ${props.clienteNome}`}
            action={enviar}
            pendente={pendente}
            classeDoBotao="h-auto max-w-full whitespace-normal py-2 text-left"
            camposOcultos={{
              projetoId: props.projetoId,
              clienteId: props.clienteId,
              milestoneId: props.milestoneId,
              versoesEsperadas: aprovacao.versoesEsperadas,
            }}
          />
        )
      )}
    </section>
  )
}
