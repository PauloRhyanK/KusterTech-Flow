import Link from 'next/link'
import { diaEMes, type DesenhoNaPagina } from '@/modules/demandas/apresentacao'
import { cn } from '@/lib/utils'
import { QuadroDoDesenho, urlDoArquivo } from './canvas-do-desenho'

const CLASSE_DO_TITULO = 'mb-2 text-xs font-[600] uppercase tracking-[0.07em] text-text-secondary'
const CLASSE_DO_LINK =
  'text-xs font-normal normal-case tracking-normal text-text-link hover:underline'
const CLASSE_DA_MOLDURA = 'overflow-hidden rounded-padrao border border-border-strong bg-surface'

function Capturas({
  demandaId,
  capturas,
  capturasApagadasEm,
}: {
  demandaId: string
  capturas: readonly { id: string; tela: 'desktop' | 'celular' }[]
  capturasApagadasEm: Date | null
}) {
  if (capturas.length === 0) {
    return (
      <p className="p-4 text-sm text-text-secondary">
        {capturasApagadasEm
          ? `Capturas apagadas em ${diaEMes(capturasApagadasEm)} (guardadas por 90 dias)`
          : 'Nenhuma captura recebida.'}
      </p>
    )
  }
  const desktop = capturas.find((c) => c.tela === 'desktop')
  const celular = capturas.find((c) => c.tela === 'celular')
  return (
    <div className="flex items-start gap-3 p-3">
      {desktop && (
        <a
          href={urlDoArquivo(demandaId, desktop.id)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Abrir a captura no desktop em tamanho real"
          className="min-w-0 flex-1"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido pela rota com sessão */}
          <img
            src={urlDoArquivo(demandaId, desktop.id)}
            alt="Captura no desktop"
            className="w-full rounded-compacto border border-border"
          />
        </a>
      )}
      {celular && (
        <a
          href={urlDoArquivo(demandaId, celular.id)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Abrir a captura no celular em tamanho real"
          className="w-[90px] shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido pela rota com sessão */}
          <img
            src={urlDoArquivo(demandaId, celular.id)}
            alt="Captura no celular"
            className="w-full rounded-compacto border border-border"
          />
        </a>
      )}
    </div>
  )
}

// A demanda entregue: o desenho aprovado ao lado do que foi ao ar no desktop e no celular.
export function EntregaLadoALado({
  demandaId,
  desenho,
  temTela,
  capturas,
  capturasApagadasEm,
}: {
  demandaId: string
  desenho: DesenhoNaPagina | null
  temTela: boolean
  capturas: readonly { id: string; tela: 'desktop' | 'celular' }[]
  capturasApagadasEm: Date | null
}) {
  const comDesenho = temTela && desenho !== null
  return (
    <div className={cn('grid gap-4', comDesenho && 'md:grid-cols-2')}>
      {comDesenho && (
        <section aria-labelledby="entrega-desenho">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 id="entrega-desenho" className={`${CLASSE_DO_TITULO} mb-0`}>
              Desenho aprovado
            </h2>
            <Link href={`/demandas/${demandaId}/desenho`} className={CLASSE_DO_LINK}>
              Abrir em tela cheia <span aria-hidden="true">⤢</span>
            </Link>
          </div>
          <div className={CLASSE_DA_MOLDURA}>
            <QuadroDoDesenho demandaId={demandaId} desenho={desenho} className="h-[300px]" />
          </div>
        </section>
      )}
      <section aria-labelledby="entrega-capturas">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 id="entrega-capturas" className={`${CLASSE_DO_TITULO} mb-0`}>
            Entregue · desktop e celular
          </h2>
          {capturas.length > 0 && (
            <span className="text-xs text-text-secondary">clique para abrir em tamanho real</span>
          )}
        </div>
        <div className={CLASSE_DA_MOLDURA}>
          <Capturas
            demandaId={demandaId}
            capturas={capturas}
            capturasApagadasEm={capturasApagadasEm}
          />
        </div>
      </section>
    </div>
  )
}
