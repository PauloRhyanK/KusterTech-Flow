'use client'

import { useState } from 'react'
import {
  acoesDoPedido,
  etapasDoPedido,
  sha7,
  type LinhaDaFila,
  type PedidoDaLinha,
} from '@/modules/fila-de-publicacao/apresentacao'
import { CLASSE_DO_LINK } from '@/lib/ui/titulo-de-secao'
import { cn } from '@/lib/utils'
import {
  BotaoDeCancelarPedido,
  BotaoDeMudarModo,
  BotaoDePublicarAgora,
} from './botoes-da-publicacao'
import { TrilhaDoPedido } from './trilha-do-pedido'

const ESTADO_DO_PEDIDO = {
  na_fila: 'Na fila',
  verificando: 'Verificando',
  publicando: 'Publicando',
} as const

const ROTULO_DOS_CHECKS = {
  sucesso: 'checks verdes',
  falha: 'checks vermelhos',
  pendente: 'checks pendentes',
  sem_checks: 'sem CI',
} as const

export interface PedidoExpansivelProps {
  pedido: PedidoDaLinha
  linha: LinhaDaFila
  agora: Date
  podeGerenciar: boolean
  compacto?: boolean
  /** Pedido que já falhou: a trilha marca a primeira etapa não feita como falhou. */
  falha?: { motivo?: string | null; execucaoUrl?: string | null } | null
}

export function PedidoExpansivel({
  pedido,
  linha,
  agora,
  podeGerenciar,
  compacto,
  falha,
}: PedidoExpansivelProps) {
  const [aberto, setAberto] = useState(false)
  const titulo = pedido.descricao ?? sha7(pedido.commit)
  const modo =
    pedido.modo === 'imediato' ? 'Imediato' : `Lote ${linha.configuracao?.horaDoLote ?? ''}`.trim()
  const acoes = acoesDoPedido(pedido, {
    podeGerenciar,
    pausado: Boolean(linha.configuracao?.pausado),
  })
  const idDoPainel = `pedido-${pedido.id}`
  const execucaoUrl = falha?.execucaoUrl ?? null
  return (
    <div
      className={cn('rounded-md border border-border bg-surface', compacto ? 'text-xs' : 'text-sm')}
    >
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={idDoPainel}
        onClick={() => setAberto((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left"
      >
        <span aria-hidden="true" className="text-text-secondary">
          {aberto ? '▾' : '▸'}
        </span>
        <span className="min-w-0 flex-1 truncate font-[600] text-text-primary">{titulo}</span>
        <span className="inline-flex h-[22px] items-center whitespace-nowrap rounded-[5px] border border-border bg-tonal-neutro px-[9px] text-xs font-[550] text-neutro">
          {modo}
        </span>
        <span className="whitespace-nowrap text-xs text-text-secondary">
          {falha ? 'Falhou' : ESTADO_DO_PEDIDO[pedido.estado]}
        </span>
      </button>
      {aberto && (
        <div id={idDoPainel} className="space-y-3 border-t border-border px-3 py-3">
          <TrilhaDoPedido etapas={etapasDoPedido(pedido, agora, falha)} />
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
            <span className="font-mono">{sha7(pedido.commit)}</span>
            {pedido.checks && <span>{ROTULO_DOS_CHECKS[pedido.checks]}</span>}
            {execucaoUrl && (
              <a href={execucaoUrl} target="_blank" rel="noreferrer" className={CLASSE_DO_LINK}>
                Ver execução
              </a>
            )}
          </p>
          {acoes.length > 0 && (
            <div className="flex flex-wrap items-start gap-2">
              {acoes.map((a) =>
                a === 'publicar_agora' ? (
                  <BotaoDePublicarAgora key={a} repositorioId={linha.repositorioId} />
                ) : a === 'mudar_para_imediato' ? (
                  <BotaoDeMudarModo key={a} pedidoId={pedido.id} modo="imediato" />
                ) : a === 'mandar_para_lote' ? (
                  <BotaoDeMudarModo key={a} pedidoId={pedido.id} modo="lote" />
                ) : (
                  <BotaoDeCancelarPedido key={a} pedidoId={pedido.id} />
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
