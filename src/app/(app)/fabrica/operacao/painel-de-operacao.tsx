// Tela Operação da Fábrica 2.0 (desenho aprovado em docs/superpowers/specs/2026-11-27-fabrica-operacao-desenho.html).
// Só leitura. Estilos em globals.css (classes op-*); cores só pelos tokens.
import type { ReactNode } from 'react'
import type { Icone, Painel } from '@/modules/fabrica-operacao/painel'

const traco = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function Svg({ tamanho, children }: { tamanho: number; children: ReactNode }) {
  return (
    <svg aria-hidden width={tamanho} height={tamanho} viewBox="0 0 24 24" {...traco}>
      {children}
    </svg>
  )
}

const ICONES: Record<Icone | 'alerta' | 'cadeado' | 'ok' | 'maquina', ReactNode> = {
  alerta: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  ok: <path d="m5 12 5 5 9-10" />,
  cadeado: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  lupa: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  tela: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 21h8" />
    </>
  ),
  codigo: <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />,
  maquina: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
}

const Rotulo = ({ children }: { children: ReactNode }) => (
  <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-text-tertiary">
    {children}
  </h2>
)

function Anel({ progresso }: { progresso: number }) {
  const r = 27
  const volta = 2 * Math.PI * r
  return (
    <div className="relative size-16 flex-none">
      <svg aria-hidden width="64" height="64" viewBox="0 0 64 64">
        <circle className="op-anel-fundo" cx="32" cy="32" r={r} fill="none" strokeWidth="7" />
        <circle
          className="op-anel"
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={volta}
          strokeDashoffset={volta * (1 - progresso / 100)}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <b className="absolute inset-0 grid place-items-center text-sm">{progresso}%</b>
    </div>
  )
}

export function PainelDeOperacao({ painel }: { painel: Painel }) {
  const { situacao, contadores } = painel
  return (
    <div className="space-y-8">
      <div
        className="op-situacao flex flex-wrap items-center gap-5 px-6 py-5"
        data-tipo={situacao.tipo}
        role="status"
      >
        <div className="op-icone size-14">
          <Svg tamanho={28}>{situacao.tipo === 'travada' ? ICONES.alerta : ICONES.ok}</Svg>
        </div>
        <div>
          <p className="text-2xl font-semibold leading-tight text-text-primary">
            {situacao.titulo}
          </p>
          <p className="text-text-secondary">{situacao.frase}</p>
        </div>
        {situacao.tipo !== 'vazia' && (
          <dl className="flex gap-6 sm:ml-auto">
            {(
              [
                ['trabalhando', contadores.trabalhando, 'trabalhando'],
                ['conferindo', contadores.conferindo, 'conferindo'],
                ['no-ar', contadores.noArHoje, 'no ar hoje'],
              ] as const
            ).map(([cor, n, texto]) => (
              <div key={cor} className="text-center">
                <dd className="op-numero text-3xl font-bold leading-none" data-cor={cor}>
                  {n}
                </dd>
                <dt className="text-xs text-text-tertiary">{texto}</dt>
              </div>
            ))}
          </dl>
        )}
      </div>

      {painel.travadas.length > 0 && (
        <section>
          <Rotulo>Travou</Rotulo>
          <ul className="space-y-3">
            {painel.travadas.map((t) => (
              <li
                key={`${t.demandaId}:${t.etapa}`}
                className="op-travada grid grid-cols-[auto_1fr] items-center gap-4 px-5 py-4 sm:grid-cols-[auto_1fr_auto]"
              >
                <div className="op-icone size-11">
                  <Svg tamanho={22}>{ICONES.cadeado}</Svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-text-primary">{t.titulo}</p>
                  <p className="text-sm text-text-secondary">
                    {t.etapa}
                    {t.motivo ? ` · ${t.motivo}` : ''}
                  </p>
                </div>
                <div className="col-span-2 rounded-xl border border-border-strong bg-surface-subtle px-4 py-2 text-center sm:col-span-1">
                  {t.proximaTentativa ? (
                    <>
                      <b className="op-relogio block text-xl">{t.proximaTentativa}</b>
                      <span className="text-xs text-text-tertiary">próxima tentativa</span>
                    </>
                  ) : (
                    <b className="op-relogio block text-sm">Precisa de você</b>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {painel.emAndamento.length > 0 && (
        <section>
          <Rotulo>Em andamento</Rotulo>
          <ul className="grid gap-4 md:grid-cols-2">
            {painel.emAndamento.map((p) => (
              <li key={p.demandaId} className="op-pedido p-5" data-cor={p.cor}>
                <div className="flex items-center gap-4">
                  <Anel progresso={p.progresso} />
                  <div className="min-w-0">
                    <p className="font-semibold text-text-primary">{p.titulo}</p>
                    <p className="text-xs text-text-tertiary">{p.projeto}</p>
                  </div>
                </div>
                <div className="my-4 flex items-center gap-3 rounded-xl border border-border bg-surface-subtle px-3.5 py-3">
                  <div className="op-icone op-avatar size-9 rounded-full">
                    <Svg tamanho={18}>{ICONES[p.agora.icone]}</Svg>
                  </div>
                  <div>
                    <p className="font-medium text-text-primary">{p.agora.texto}</p>
                    {p.agora.desde && (
                      <p className="text-sm text-text-secondary">começou {p.agora.desde}</p>
                    )}
                  </div>
                </div>
                <ol className="flex gap-1.5" aria-label="Passos">
                  {p.passos.map((s, i) => (
                    <li
                      key={`${s.nome}:${i}`}
                      className="op-passo"
                      data-estado={s.estado}
                      title={s.nome}
                    >
                      <span className="sr-only">
                        {s.nome}:{' '}
                        {s.estado === 'feito' ? 'feito' : s.estado === 'atual' ? 'agora' : 'depois'}
                      </span>
                    </li>
                  ))}
                </ol>
                <div
                  className="mt-1.5 flex justify-between gap-2 text-[11px] text-text-tertiary"
                  aria-hidden
                >
                  {p.passos.map((s, i) => (
                    <span key={`${s.nome}:${i}`} className="truncate">
                      {s.nome}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {painel.maquinas.length > 0 && (
        <section>
          <Rotulo>Máquinas</Rotulo>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {painel.maquinas.map((m) => (
              <li
                key={m.nome}
                className="flex items-center gap-3.5 rounded-2xl border border-border bg-surface px-4 py-4"
              >
                <div className="relative grid size-11 flex-none place-items-center rounded-xl bg-surface-elevated text-text-secondary">
                  <Svg tamanho={22}>{ICONES.maquina}</Svg>
                  <i className="op-luz" data-estado={m.estado} aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-text-primary">{m.nome}</p>
                  <p className="truncate text-sm text-text-secondary">{m.texto}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {painel.noArHoje.length > 0 && (
        <section>
          <Rotulo>No ar hoje</Rotulo>
          <ul className="flex flex-wrap gap-2.5">
            {painel.noArHoje.map((t) => (
              <li
                key={t}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-2 text-sm text-text-secondary"
              >
                <span className="op-visto">
                  <Svg tamanho={16}>{ICONES.ok}</Svg>
                </span>
                {t}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
