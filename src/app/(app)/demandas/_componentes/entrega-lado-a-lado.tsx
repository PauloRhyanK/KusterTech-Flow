import { diaEMes, type DesenhoNaPagina } from '@/modules/demandas/apresentacao'
import { cn } from '@/lib/utils'
import { QuadroDoDesenho, urlDoArquivo } from './canvas-do-desenho'

const CLASSE_DO_TITULO = 'mb-2 text-xs font-[600] uppercase tracking-[0.07em] text-text-secondary'
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
        // eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido pela rota com sessão
        <img
          src={urlDoArquivo(demandaId, desktop.id)}
          alt="Captura no desktop"
          className="min-w-0 flex-1 rounded-compacto border border-border"
        />
      )}
      {celular && (
        // eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido pela rota com sessão
        <img
          src={urlDoArquivo(demandaId, celular.id)}
          alt="Captura no celular"
          className="w-[90px] shrink-0 rounded-compacto border border-border"
        />
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
          <h2 id="entrega-desenho" className={CLASSE_DO_TITULO}>
            Desenho aprovado
          </h2>
          <div className={CLASSE_DA_MOLDURA}>
            <QuadroDoDesenho demandaId={demandaId} desenho={desenho} className="h-[300px]" />
          </div>
        </section>
      )}
      <section aria-labelledby="entrega-capturas">
        <h2 id="entrega-capturas" className={CLASSE_DO_TITULO}>
          Entregue · desktop e celular
        </h2>
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
