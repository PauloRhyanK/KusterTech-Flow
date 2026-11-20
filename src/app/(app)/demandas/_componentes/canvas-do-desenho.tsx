import Link from 'next/link'
import type { DesenhoNaPagina } from '@/modules/demandas/apresentacao'
import { cn } from '@/lib/utils'

export function urlDoArquivo(demandaId: string, arquivoId: string): string {
  return `/demandas/${demandaId}/arquivos/${arquivoId}`
}

/**
 * O desenho em HTML é conteúdo de fora: só num iframe `sandbox=""` (sem scripts, origem opaca),
 * carregado da rota do Flow que responde com `Content-Security-Policy: sandbox`. Nunca `srcdoc`.
 */
export function QuadroDoDesenho({
  demandaId,
  desenho,
  className,
}: {
  demandaId: string
  desenho: DesenhoNaPagina
  className?: string
}) {
  const src = urlDoArquivo(demandaId, desenho.arquivoId)
  const titulo = `Desenho · ${desenho.nome}`
  if (desenho.ehHtml) {
    return (
      <iframe
        sandbox=""
        referrerPolicy="no-referrer"
        src={src}
        title={titulo}
        className={cn('block w-full border-0 bg-surface', className)}
      />
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido pela rota com sessão
    <img
      src={src}
      alt={titulo}
      referrerPolicy="no-referrer"
      className={cn('block w-full bg-surface object-contain object-top', className)}
    />
  )
}

export function CanvasDoDesenho({
  demandaId,
  desenho,
  artefatoUrl,
  comBarra = true,
}: {
  demandaId: string
  desenho: DesenhoNaPagina
  /** Já validado (https://claude.ai/…) em `linkDoArtefato`. */
  artefatoUrl: string | null
  comBarra?: boolean
}) {
  return (
    <div className="overflow-hidden rounded-padrao border border-border-strong bg-surface">
      {comBarra && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-subtle px-3 py-2 text-[12.5px] text-text-secondary">
          <span aria-hidden="true" className="flex gap-2">
            <i className="size-2.5 rounded-full bg-border-strong" />
            <i className="size-2.5 rounded-full bg-border-strong" />
            <i className="size-2.5 rounded-full bg-border-strong" />
          </span>
          <span className="ml-2 min-w-0 truncate">{`Desenho · ${desenho.nome}`}</span>
          <span className="ml-auto flex items-center gap-4">
            {artefatoUrl && (
              <a
                href={artefatoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-link hover:underline"
              >
                Ver o artefato do Claude <span aria-hidden="true">↗</span>
              </a>
            )}
            <Link href={`/demandas/${demandaId}/desenho`} className="hover:underline">
              Abrir em tela cheia <span aria-hidden="true">⤢</span>
            </Link>
          </span>
        </div>
      )}
      <QuadroDoDesenho demandaId={demandaId} desenho={desenho} className="h-[480px] md:h-[640px]" />
    </div>
  )
}
