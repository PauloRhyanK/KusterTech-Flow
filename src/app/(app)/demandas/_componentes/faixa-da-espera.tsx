'use client'

import { useActionState, useState } from 'react'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import type { AcaoDaFaixa, FaixaDaEspera as Faixa } from '@/modules/demandas/apresentacao'
import { cn } from '@/lib/utils'
import {
  aprovarDesenhoAction,
  concluirEtapaAction,
  decidirDestinoAction,
  pedirAjusteAction,
  retomarDemandaAction,
  type EstadoDaDecisao,
} from '../[id]/actions'

const LIMITE_DO_AJUSTE = 500
const LIMITE_DA_RESPOSTA = 2000

const DESTINOS = [
  { valor: 'urgente', rotulo: 'Urgente' },
  { valor: 'lote_da_noite', rotulo: 'Lote da noite' },
  { valor: 'fila_de_agentes', rotulo: 'Fila de agentes' },
  { valor: 'orientada', rotulo: 'Orientada' },
] as const

// Um só estado para todas as decisões: o erro aparece num lugar só, acima da faixa.
async function enviarDecisao(estado: EstadoDaDecisao, form: FormData): Promise<EstadoDaDecisao> {
  switch (form.get('acao') as AcaoDaFaixa | null) {
    case 'aprovar':
      return aprovarDesenhoAction(estado, form)
    case 'ajuste':
      return pedirAjusteAction(estado, form)
    case 'destino':
      return decidirDestinoAction(estado, form)
    case 'retomar':
      return retomarDemandaAction(estado, form)
    case 'concluir':
      return concluirEtapaAction(estado, form)
    default:
      return { erro: 'Ação inválida.' }
  }
}

export function useDecisao() {
  return useActionState(enviarDecisao, {})
}

interface Contexto {
  demandaId: string
  /** A versão do desenho que a pessoa está vendo: vai junto para o service recusar a velha. */
  versao: number
  etapaAtual: string
}

function Campos({ ctx, acao }: { ctx: Contexto; acao: AcaoDaFaixa }) {
  return (
    <>
      <input type="hidden" name="acao" value={acao} />
      <input type="hidden" name="demandaId" value={ctx.demandaId} />
      {(acao === 'aprovar' || acao === 'ajuste') && (
        <input type="hidden" name="versao" value={String(ctx.versao)} />
      )}
      {acao === 'concluir' && <input type="hidden" name="chave" value={ctx.etapaAtual} />}
    </>
  )
}

/** Os botões das decisões; "Pedir ajuste" abre um campo de texto com "Enviar ajuste". */
export function BotoesDaDecisao({
  ctx,
  acoes,
  enviar,
  pendente,
  className,
  responder = false,
}: {
  ctx: Contexto
  acoes: readonly AcaoDaFaixa[]
  enviar: (form: FormData) => void
  pendente: boolean
  className?: string
  /** Mostra o campo de resposta no "Tentar de novo" (só a pergunta do orquestrador o lê). */
  responder?: boolean
}) {
  const [ajustando, setAjustando] = useState(false)
  const [texto, setTexto] = useState('')
  const [resposta, setResposta] = useState('')
  const comAjuste = acoes.includes('ajuste')
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {comAjuste && !ajustando && (
          <Button type="button" variant="outline" size="lg" onClick={() => setAjustando(true)}>
            Pedir ajuste
          </Button>
        )}
        {acoes.includes('aprovar') && (
          <form action={enviar}>
            <Campos ctx={ctx} acao="aprovar" />
            <Button type="submit" size="lg" disabled={pendente} aria-busy={pendente}>
              Aprovar
            </Button>
          </form>
        )}
        {acoes.includes('destino') &&
          DESTINOS.map((d) => (
            <form key={d.valor} action={enviar}>
              <Campos ctx={ctx} acao="destino" />
              <input type="hidden" name="destino" value={d.valor} />
              <Button type="submit" variant="outline" size="lg" disabled={pendente}>
                {d.rotulo}
              </Button>
            </form>
          ))}
        {acoes.includes('retomar') && !responder && (
          <form action={enviar}>
            <Campos ctx={ctx} acao="retomar" />
            <Button type="submit" size="lg" disabled={pendente} aria-busy={pendente}>
              Tentar de novo
            </Button>
          </form>
        )}
        {acoes.includes('concluir') && (
          <form action={enviar}>
            <Campos ctx={ctx} acao="concluir" />
            <Button type="submit" size="lg" disabled={pendente} aria-busy={pendente}>
              Concluir etapa
            </Button>
          </form>
        )}
      </div>
      {acoes.includes('retomar') && responder && (
        <form action={enviar} className="flex flex-col gap-2 sm:w-96">
          <Campos ctx={ctx} acao="retomar" />
          <label
            htmlFor="resposta-da-retomada"
            className="text-[12.5px] font-[600] text-text-secondary"
          >
            Resposta ou orientação (opcional)
          </label>
          <textarea
            id="resposta-da-retomada"
            name="resposta"
            maxLength={LIMITE_DA_RESPOSTA}
            rows={3}
            value={resposta}
            onChange={(e) => setResposta(e.target.value)}
            className="w-full rounded-compacto border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          />
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-text-tertiary">{`${resposta.length}/${LIMITE_DA_RESPOSTA}`}</span>
            <Button type="submit" size="lg" disabled={pendente} aria-busy={pendente}>
              Tentar de novo
            </Button>
          </div>
        </form>
      )}
      {comAjuste && ajustando && (
        <form action={enviar} className="flex flex-col gap-2">
          <Campos ctx={ctx} acao="ajuste" />
          <label htmlFor="texto-do-ajuste" className="text-[12.5px] font-[600] text-text-secondary">
            O que ajustar
          </label>
          <textarea
            id="texto-do-ajuste"
            name="texto"
            maxLength={LIMITE_DO_AJUSTE}
            rows={3}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="w-full rounded-compacto border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          />
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-text-tertiary">{`${texto.length}/${LIMITE_DO_AJUSTE}`}</span>
            <Button type="button" variant="ghost" onClick={() => setAjustando(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={pendente || texto.trim().length === 0}
              aria-busy={pendente}
            >
              Enviar ajuste
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

// O que a demanda espera do Paulo, com as ações; erro do service aparece acima.
export function FaixaDaEspera({
  demandaId,
  versao,
  etapaAtual,
  podeAgir,
  faixa,
}: Contexto & { podeAgir: boolean; faixa: Faixa }) {
  const [estado, enviar, pendente] = useDecisao()
  const parada = faixa.acoes.includes('retomar')
  return (
    <div className="space-y-2">
      <MensagensDeEstado estado={{ erro: estado.erro }} />
      <section
        aria-label="Espera você"
        className={cn(
          'flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-padrao border px-4 py-3.5',
          parada ? 'border-erro/30 bg-tonal-erro' : 'border-atencao/30 bg-tonal-atencao',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'grid size-[30px] shrink-0 place-items-center rounded-full text-sm font-bold text-action-foreground',
            parada ? 'bg-erro' : 'bg-atencao',
          )}
        >
          {parada ? '!' : '?'}
        </span>
        <div className="min-w-48 flex-1">
          <p className="text-base font-[650] leading-snug text-text-primary">{faixa.titulo}</p>
          {faixa.contexto && (
            <p className="break-words text-[12.5px] text-text-secondary">{faixa.contexto}</p>
          )}
          {faixa.prUrl && (
            <a
              href={faixa.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12.5px] font-[600] text-text-link underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Abrir PR
            </a>
          )}
        </div>
        {podeAgir && faixa.acoes.length > 0 && (
          <BotoesDaDecisao
            ctx={{ demandaId, versao, etapaAtual }}
            acoes={faixa.acoes}
            enviar={enviar}
            pendente={pendente}
            className="w-full sm:w-auto"
            responder={faixa.responder === true}
          />
        )}
      </section>
    </div>
  )
}

// Na tela cheia: só "Aprovar" e "Pedir ajuste", flutuando sobre o desenho.
export function DecisaoNaTelaCheia({ demandaId, versao }: { demandaId: string; versao: number }) {
  const [estado, enviar, pendente] = useDecisao()
  return (
    <div className="w-[min(420px,calc(100vw-2rem))] space-y-2 rounded-padrao border border-border bg-surface p-3 shadow-lg">
      <MensagensDeEstado estado={{ erro: estado.erro }} />
      <BotoesDaDecisao
        ctx={{ demandaId, versao, etapaAtual: '' }}
        acoes={['ajuste', 'aprovar']}
        enviar={enviar}
        pendente={pendente}
      />
    </div>
  )
}
