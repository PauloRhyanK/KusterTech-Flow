'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { buttonVariants } from '@/components/ui/button'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { apresentarImplantacao, type OrigemEvidencia } from '@/modules/ambientes/model'
import type { ImplantacaoDaIssueNaTela, ImplantacaoNaTela } from '@/modules/ambientes/queries'
import { confirmarPresencaManualAction } from '../ambientes-actions'
import { LeituraDoRepositorio } from './ambientes-do-projeto'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface ImplantacaoDaIssueProps {
  projetoId: string
  issueId: string
  modo: 'global' | 'cliente'
  dados: ImplantacaoDaIssueNaTela
}

const ORIGEM: Record<Exclude<OrigemEvidencia, 'MANUAL'>, string> = {
  GITHUB_DEPLOYMENT: 'GitHub Deployments',
  ENDPOINT: 'Endpoint',
}

function origemDoDeploy(ambiente: ImplantacaoNaTela): string | null {
  if (ambiente.origem === null) {
    return null
  }
  if (ambiente.origem === 'MANUAL') {
    return `registro manual por ${ambiente.autorDoDeploy ?? 'autor removido'}`
  }
  return ORIGEM[ambiente.origem]
}

function LinhaDoAmbiente({
  projetoId,
  issueId,
  ambiente,
  podeConfirmar,
}: {
  projetoId: string
  issueId: string
  ambiente: ImplantacaoNaTela
  podeConfirmar: boolean
}) {
  const [estado, confirmar, confirmando] = useActionState(confirmarPresencaManualAction, {})
  const apresentacao = apresentarImplantacao(ambiente)
  const { versao, confirmadaPor } = ambiente
  const detalhes = [
    versao && ambiente.ocorridaEm
      ? `Versão ${versao.rotulo} · ${formatarDataHora(ambiente.ocorridaEm)}`
      : null,
    ambiente.commitCurto,
    origemDoDeploy(ambiente),
  ].filter((d) => d !== null)

  return (
    <li className="space-y-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <span className="w-12 text-sm font-semibold text-text-primary">{ambiente.tipo}</span>
        <BadgeDeEstado tom={apresentacao.tom}>{apresentacao.texto}</BadgeDeEstado>
      </div>
      {detalhes.length > 0 && (
        <p className="break-words text-sm text-text-primary">{detalhes.join(' · ')}</p>
      )}
      {ambiente.motivo !== '' && <p className="text-sm text-text-secondary">{ambiente.motivo}</p>}
      {confirmadaPor && (
        <p className="text-sm text-text-secondary">
          Confirmada manualmente por {confirmadaPor.nome} em {formatarDataHora(confirmadaPor.em)}.
        </p>
      )}
      {podeConfirmar && ambiente.estado === 'VERIFICACAO_NECESSARIA' && versao && (
        <BotaoDeConfirmacao
          rotulo="Confirmar presença manualmente"
          rotuloDeConfirmacao={`Confirmar presença em ${versao.rotulo} (${ambiente.tipo})`}
          action={confirmar}
          camposOcultos={{ projetoId, issueId, versaoId: versao.id, tipo: ambiente.tipo }}
          pendente={confirmando}
        />
      )}
      {podeConfirmar && <MensagensDeEstado estado={estado} />}
    </li>
  )
}

// Presença da issue em cada ambiente (seção "Versão e ambiente" da lateral).
export function ImplantacaoDaIssue({ projetoId, issueId, modo, dados }: ImplantacaoDaIssueProps) {
  if (dados.nenhumConfigurado) {
    return (
      <EstadoVazio
        tipo="nao-configurado"
        titulo="Ambientes não configurados."
        descricao="Configure DEV, QA e PROD para acompanhar a presença desta issue."
        acao={
          dados.podeConfirmar ? (
            <Link
              href={`/projetos/${projetoId}/configuracao#ambientes`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Configurar ambientes
            </Link>
          ) : undefined
        }
      />
    )
  }

  const avisos = dados.leituras.filter(
    (l) => l.estado === 'indisponivel' || l.estado === 'sem-dados-recentes',
  )

  return (
    <div className="space-y-3 rounded-padrao border border-border bg-surface p-4">
      {avisos.map((leitura) => (
        <LeituraDoRepositorio key={leitura.repositorio} leitura={leitura} />
      ))}
      <ul aria-label="Presença por ambiente" className="divide-y divide-border">
        {dados.ambientes.map((ambiente) => (
          <LinhaDoAmbiente
            key={ambiente.tipo}
            projetoId={projetoId}
            issueId={issueId}
            ambiente={ambiente}
            podeConfirmar={dados.podeConfirmar}
          />
        ))}
      </ul>
      {modo === 'global' && (
        <Link
          href={`/projetos/${projetoId}/versoes`}
          className="text-sm text-text-link hover:underline"
        >
          Ver versões do projeto
        </Link>
      )}
    </div>
  )
}
