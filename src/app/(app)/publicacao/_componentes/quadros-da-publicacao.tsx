import type { ReactNode } from 'react'
import type { ResumoDaPublicacao } from '@/modules/fila-de-publicacao/apresentacao'
import { cn } from '@/lib/utils'

const ROTULO = 'text-[11.5px] font-[600] uppercase tracking-[0.07em] text-text-secondary'
const NUMERO = 'mt-1.5 text-[32px] font-[650] leading-[1.1] tracking-[-0.03em] text-text-primary'
const NOTA = 'mt-1 text-[13px] text-text-secondary'

function Quadro({
  rotulo,
  children,
  nota,
  className,
}: {
  rotulo: ReactNode
  children: ReactNode
  nota: string
  className?: string
}) {
  return (
    <div className={cn('min-w-0 rounded-padrao border border-border bg-surface p-4', className)}>
      <p className={ROTULO}>{rotulo}</p>
      {children}
      <p className={NOTA}>{nota}</p>
    </div>
  )
}

export function QuadrosDaPublicacao({ resumo }: { resumo: ResumoDaPublicacao }) {
  const { subindo, naFila, lote, ultimoLote } = resumo
  return (
    <section
      aria-label="Resumo da publicação"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.25fr_1fr_1fr_1fr]"
    >
      {/* O quadro do que sobe usa o tema escuro, como a navegação: fundo meia-noite da marca. */}
      <Quadro
        className="dark border-marca-midnight bg-marca-midnight"
        rotulo={
          <>
            {!subindo.vazio && (
              <span
                aria-hidden="true"
                className="mr-1.5 inline-block size-2 rounded-full bg-context-active motion-safe:animate-pulse"
              />
            )}
            Subindo agora
          </>
        }
        nota={subindo.m}
      >
        <p className="mt-1.5 text-[20px] font-[650] leading-[1.25] tracking-[-0.01em] text-text-primary">
          {subindo.n}
        </p>
      </Quadro>
      <Quadro rotulo="Na fila" nota={naFila.m}>
        <p className={NUMERO}>{naFila.n}</p>
      </Quadro>
      <Quadro rotulo="Lote desta noite" nota={lote.m}>
        <p className={NUMERO}>{lote.n}</p>
      </Quadro>
      <Quadro rotulo="Último lote" nota={ultimoLote.m}>
        <p data-testid="ultimo-lote-n" className={NUMERO}>
          {ultimoLote.n}
          {ultimoLote.de && ' '}
          {ultimoLote.de && (
            <span className="text-[15px] font-medium tracking-normal text-text-secondary">
              {ultimoLote.de}
            </span>
          )}
        </p>
      </Quadro>
    </section>
  )
}
