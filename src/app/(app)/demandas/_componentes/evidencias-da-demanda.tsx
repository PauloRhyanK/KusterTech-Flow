'use client'

import Link from 'next/link'
import { useId, useState, useTransition } from 'react'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import { formatarData, formatarDataHora } from '@/lib/data'
import { CLASSE_DO_CARTAO } from '@/lib/ui/titulo-de-secao'
import { cn } from '@/lib/utils'
import type { Evidencias, GrupoDeEvidencia, ItemDeEvidencia } from '@/modules/demandas/apresentacao'
import { formatarIdade } from '@/modules/inicio/model'
import { separarAction, type EstadoDaDecisao } from '../[id]/actions'

/** No celular, o bloco mostra até 3 linhas e "Ver as N outras". */
const LINHAS_NO_CELULAR = 3

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** "Separar": desfaz a junção da triagem (a demanda juntada volta para a triagem). */
export function BotaoSeparar({ demandaJuntadaId }: { demandaJuntadaId: string }) {
  const [estado, setEstado] = useState<EstadoDaDecisao>({})
  const [enviando, iniciar] = useTransition()
  return (
    <span className="ml-auto inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={enviando}
        aria-busy={enviando}
        onClick={() =>
          iniciar(async () => {
            setEstado(await separarAction(demandaJuntadaId))
          })
        }
      >
        Separar
      </Button>
      <MensagensDeEstado estado={{ erro: estado.erro }} />
    </span>
  )
}

function CabecalhoDoGrupo({ grupo }: { grupo: GrupoDeEvidencia }) {
  if (grupo.tipo === 'desta') return <>Desta demanda</>
  if (grupo.tipo === 'ligado') return <>Ligado pela triagem (estava sem demanda no GlitchTip)</>
  const de = grupo.de!
  return (
    <>
      <span
        data-testid="cabecalho-da-juntada"
        className="min-w-0 flex-1 basis-[200px] wrap-anywhere"
      >
        Juntada de{' '}
        <Link href={`/demandas/${de.id}`} className="text-text-link hover:underline">
          &quot;{de.titulo}&quot;
        </Link>{' '}
        · {formatarData(de.em)} · {de.motivo}
      </span>
      {grupo.podeSeparar && <BotaoSeparar demandaJuntadaId={de.id} />}
    </>
  )
}

function LinhaDoItem({ item, agora }: { item: ItemDeEvidencia; agora: Date }) {
  const relato = item.tipo === 'relato'
  const [aberto, setAberto] = useState(false)
  const painel = useId()
  return (
    <>
      {/* Abaixo de lg, volume e ação descem para baixo do texto: a linha nunca alarga a página. */}
      <div className="flex min-w-0 flex-wrap items-start gap-x-2.5 gap-y-1 lg:flex-nowrap lg:items-center lg:gap-3.5">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-[22px] shrink-0 place-items-center rounded-compacto text-[11px] font-[700]',
            relato ? 'bg-tonal-informacao text-action-primary' : 'bg-tonal-erro text-erro',
          )}
        >
          {relato ? 'R' : 'E'}
        </span>
        <div
          data-testid="texto-da-linha"
          className="min-w-0 flex-1 basis-[calc(100%-36px)] lg:basis-0"
        >
          {relato ? (
            <>
              <p className="font-[550] text-text-primary wrap-anywhere lg:truncate">
                {item.trecho ? `"${item.trecho}"` : 'Relato sem texto'}
              </p>
              <p className="mt-0.5 truncate text-xs text-text-tertiary">
                {[
                  item.papel,
                  item.canal,
                  item.tela && `tela ${item.tela}`,
                  formatarDataHora(item.em),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </>
          ) : (
            <>
              <p className="font-[550] text-text-primary wrap-anywhere lg:truncate">
                {item.titulo}
              </p>
              {item.onde && (
                <p className="mt-0.5 truncate font-mono text-[11.5px] text-text-tertiary">
                  {item.onde}
                </p>
              )}
            </>
          )}
        </div>
        <div className="ml-8 text-xs text-text-secondary lg:ml-0 lg:w-[190px] lg:shrink-0 lg:text-right">
          {relato ? (
            item.reforcos > 0 ? (
              <>
                <b className="text-text-primary">{item.reforcos}</b>{' '}
                {item.reforcos === 1 ? 'reforço' : 'reforços'}
              </>
            ) : (
              <span aria-hidden="true">—</span>
            )
          ) : (
            <>
              <b className="text-text-primary">{item.eventos}</b> eventos ·{' '}
              <b className="text-text-primary">{item.usuarios}</b> usuários
              <br />
              último {formatarIdade(item.ultimoEm, agora)}
            </>
          )}
        </div>
        <div className="ml-auto text-[12.5px] lg:w-[90px] lg:shrink-0 lg:text-right">
          {relato ? (
            <button
              type="button"
              aria-expanded={aberto}
              aria-controls={painel}
              onClick={() => setAberto((a) => !a)}
              className="text-text-link hover:underline"
            >
              {aberto ? 'Fechar relato' : 'Ver relato'}
            </button>
          ) : (
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-link hover:underline"
            >
              GlitchTip <span aria-hidden="true">↗</span>
            </a>
          )}
        </div>
      </div>
      {relato && aberto && (
        <div
          id={painel}
          className="ml-8 mt-2 min-w-0 space-y-1 rounded-compacto bg-surface-subtle px-3 py-2 text-[13px] text-text-secondary"
        >
          <p className="whitespace-pre-line text-text-primary wrap-anywhere">
            {item.texto || 'Relato sem texto.'}
          </p>
          {item.anexos > 0 && (
            <p className="text-xs text-text-tertiary">
              {item.anexos === 1 ? '1 anexo' : `${item.anexos} anexos`}
            </p>
          )}
        </div>
      )}
    </>
  )
}

/** O bloco Evidências: relatos e erros da demanda, agrupados pela origem. */
export function EvidenciasDaDemanda({
  evidencias,
  agora,
}: {
  evidencias: Evidencias | null
  agora: Date
}) {
  const id = useId()
  const [todas, setTodas] = useState(false)
  if (!evidencias) return null

  const total = evidencias.grupos.reduce((n, g) => n + g.itens.length, 0)
  const outras = total - LINHAS_NO_CELULAR
  const escondeNoCelular = (indice: number) => !todas && indice >= LINHAS_NO_CELULAR
  // O índice do primeiro item de cada grupo na lista inteira.
  const inicios = evidencias.grupos.map((_, g) =>
    evidencias.grupos.slice(0, g).reduce((n, x) => n + x.itens.length, 0),
  )

  return (
    // `contain: inline-size`: o texto truncado (nowrap) não entra na largura mínima do `main`,
    // então o bloco acompanha a largura da página em vez de alargá-la.
    <section
      aria-labelledby={id}
      className={cn(CLASSE_DO_CARTAO, 'min-w-0 overflow-hidden [contain:inline-size]')}
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3">
        <h2 id={id} className="text-[15px] font-[650] text-text-primary">
          Evidências
        </h2>
        {evidencias.erros > 0 && (
          <span className="rounded-full bg-tonal-erro px-2.5 py-0.5 text-xs text-erro">
            {plural(evidencias.erros, 'erro', 'erros')}
          </span>
        )}
        {evidencias.relatos > 0 && (
          <span className="rounded-full bg-tonal-informacao px-2.5 py-0.5 text-xs text-action-primary">
            {plural(evidencias.relatos, 'relato', 'relatos')}
          </span>
        )}
        {evidencias.reforcos > 0 && (
          <span className="rounded-full bg-surface-subtle px-2.5 py-0.5 text-xs text-text-secondary">
            +{plural(evidencias.reforcos, 'reforço', 'reforços')}
          </span>
        )}
      </div>

      {evidencias.grupos.map((grupo, g) => {
        const inicio = inicios[g]!
        return (
          <div key={grupo.de?.id ?? grupo.tipo}>
            <div
              data-grupo={grupo.tipo}
              className={cn(
                'flex-wrap items-center gap-2 border-border bg-surface-subtle px-4 py-1.5 text-xs text-text-tertiary',
                g > 0 && 'border-t',
                escondeNoCelular(inicio) ? 'hidden md:flex' : 'flex',
              )}
            >
              <CabecalhoDoGrupo grupo={grupo} />
            </div>
            <ul>
              {grupo.itens.map((item, i) => (
                <li
                  key={item.id}
                  className={cn(
                    'border-t border-border px-4 py-2.5 text-sm',
                    escondeNoCelular(inicio + i) ? 'hidden md:block' : 'block',
                  )}
                >
                  <LinhaDoItem item={item} agora={agora} />
                </li>
              ))}
            </ul>
          </div>
        )
      })}

      {!todas && outras > 0 && (
        <div className="border-t border-border bg-surface-subtle px-4 py-1.5 text-center md:hidden">
          <button
            type="button"
            onClick={() => setTodas(true)}
            className="text-xs text-text-link hover:underline"
          >
            Ver as {outras} outras
          </button>
        </div>
      )}
    </section>
  )
}
