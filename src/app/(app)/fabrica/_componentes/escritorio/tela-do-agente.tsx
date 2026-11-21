'use client'

// A tela do agente: um clique no computador do boneco abre o monitor grande com o que ele está fazendo.
// Só mostra o que a Fábrica mandou (as últimas 30 linhas), sempre como texto.
import { Dialog } from '@base-ui/react/dialog'
import { useState } from 'react'
import type { Agente, Parte } from '@/modules/fabrica/escritorio/model'
import { cn } from '@/lib/utils'
import { hora } from './hora'

type Aba = 'agora' | 'alteracoes' | 'testes'

const COMANDO_DE_VERIFICACAO =
  /^(npm|pnpm|npx|yarn|pytest|python3? -m unittest|python3? -I -B -m unittest|go test|cargo test)\b/
const EDICAO = /^(Edit|Write|MultiEdit|NotebookEdit)\b/

export function linhasDaAba(linhas: Agente['linhas'], aba: Aba): Agente['linhas'] {
  if (aba === 'testes')
    return linhas.filter((l) => l.tipo === 'ferramenta' && COMANDO_DE_VERIFICACAO.test(l.texto))
  if (aba === 'alteracoes')
    return linhas.filter((l) => l.tipo === 'ferramenta' && EDICAO.test(l.texto))
  return linhas
}

function custo(valor: number | null): string {
  return valor === null ? '—' : `US$ ${valor.toFixed(2).replace('.', ',')}`
}

const COR_DA_LINHA = {
  texto: 'var(--pixel-tela-acesa)',
  ferramenta: 'var(--pixel-led-verde)',
  estado: 'var(--pixel-ouro)',
}

export interface TelaDoAgenteProps {
  agente: Agente | null
  parte: Parte | null
  aberto: boolean
  onFechar: () => void
}

export function TelaDoAgente({ agente, parte, aberto, onFechar }: TelaDoAgenteProps) {
  const [aba, setAba] = useState<Aba>('agora')
  if (!agente) return null
  const linhas = linhasDaAba(agente.linhas, aba)
  const abas: { id: Aba; rotulo: string }[] = [
    { id: 'agora', rotulo: 'Agora' },
    { id: 'alteracoes', rotulo: 'Alterações' },
    { id: 'testes', rotulo: 'Testes' },
  ]
  return (
    <Dialog.Root open={aberto} onOpenChange={(abrir) => !abrir && onFechar()}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className="fixed inset-0 z-50 opacity-80"
          style={{ background: 'var(--pixel-contorno)' }}
        />
        <Dialog.Popup
          className="fixed top-1/2 left-1/2 z-50 w-[min(980px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-[22px] p-[22px] pb-12 shadow-2xl motion-safe:animate-in motion-safe:zoom-in-50"
          style={{ background: 'var(--pixel-metal)', boxShadow: '0 0 0 6px var(--pixel-contorno)' }}
        >
          <Dialog.Title className="sr-only">Tela de {agente.nome}</Dialog.Title>
          <Dialog.Close
            className="absolute -top-3.5 -right-3.5 size-9 rounded-full bg-surface text-base font-bold text-text-primary shadow-lg"
            aria-label="Fechar a tela"
          >
            ✕
          </Dialog.Close>
          <div
            className="grid h-[520px] grid-rows-[auto_1fr] overflow-hidden rounded-lg font-mono text-xs leading-[18px]"
            style={{
              background: 'var(--pixel-contorno)',
              color: 'var(--pixel-papel)',
              border: '4px solid var(--pixel-contorno)',
            }}
          >
            <div
              className="flex items-center gap-2 border-b px-3 py-2"
              style={{ borderColor: 'var(--pixel-servidor)' }}
            >
              <b className="text-sm">{agente.nome}</b>
              <span style={{ color: 'var(--pixel-tela-apagada)' }}>{agente.balao}</span>
              <div role="tablist" aria-label="O que ver" className="ml-auto flex gap-1">
                {abas.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="tab"
                    aria-selected={aba === a.id}
                    onClick={() => setAba(a.id)}
                    className={cn('rounded-compacto px-2.5 py-0.5 text-[11px]')}
                    style={{
                      background:
                        aba === a.id ? 'var(--pixel-papel-frontend)' : 'var(--pixel-servidor)',
                      color: 'var(--pixel-branco)',
                    }}
                  >
                    {a.rotulo}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid min-h-0 grid-cols-[1fr_300px]">
              <div role="tabpanel" className="overflow-auto px-3.5 py-3">
                {linhas.length === 0 ? (
                  <p style={{ color: 'var(--pixel-tela-apagada)' }}>nada por aqui ainda</p>
                ) : (
                  linhas.map((l, i) => (
                    <div key={i} className="whitespace-pre-wrap">
                      <span style={{ color: 'var(--pixel-tela-apagada)' }}>{hora(l.em)} </span>
                      <span style={{ color: COR_DA_LINHA[l.tipo] }}>{l.texto}</span>
                    </div>
                  ))
                )}
              </div>
              <aside
                className="overflow-auto border-l p-3 font-sans"
                style={{ borderColor: 'var(--pixel-servidor)' }}
              >
                <h5
                  className="mb-1.5 text-[10px] font-bold tracking-widest uppercase"
                  style={{ color: 'var(--pixel-tela-apagada)' }}
                >
                  Execução
                </h5>
                <dl
                  className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-compacto p-2"
                  style={{ background: 'var(--pixel-servidor)' }}
                >
                  <dt>parte</dt>
                  <dd className="text-right">{agente.raia ?? '—'}</dd>
                  <dt>começou</dt>
                  <dd className="text-right">{hora(agente.inicio)}</dd>
                  <dt>modelo</dt>
                  <dd className="text-right">{agente.modelo ?? '—'}</dd>
                  <dt>custo</dt>
                  <dd className="text-right">{custo(agente.custoUsd)}</dd>
                </dl>
                {parte && (
                  <>
                    <h5
                      className="mb-1.5 text-[10px] font-bold tracking-widest uppercase"
                      style={{ color: 'var(--pixel-tela-apagada)' }}
                    >
                      Critérios de aceite
                    </h5>
                    <ul className="space-y-1.5">
                      {parte.criterios.map((c, i) => (
                        <li key={i} data-marca={c.marca} className="flex gap-2">
                          <span
                            className="mt-0.5 inline-block size-3 shrink-0 rounded-[3px]"
                            style={{
                              background:
                                c.marca === 'verde'
                                  ? 'var(--pixel-led-verde)'
                                  : c.marca === 'vermelho'
                                    ? 'var(--pixel-led-vermelho)'
                                    : 'var(--pixel-servidor)',
                              outline: '1px solid var(--pixel-tela-apagada)',
                            }}
                          />
                          <span>{c.texto}</span>
                        </li>
                      ))}
                    </ul>
                    {parte.prUrl && (
                      <a
                        href={parte.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-block underline"
                      >
                        abrir o PR ↗
                      </a>
                    )}
                  </>
                )}
              </aside>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
