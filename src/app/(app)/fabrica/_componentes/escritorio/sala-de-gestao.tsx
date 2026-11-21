'use client'

// Sala de gestão: indicadores, previsão de entrega com o tempo de cada parte, gráficos e os detalhes técnicos
// que ficavam no painel antigo da Fábrica (vagas, memória, avisos e consertos).
import { Dialog } from '@base-ui/react/dialog'
import type { ReactNode } from 'react'
import type { DadosDaGestao } from '@/modules/fabrica/escritorio/gestao'
import { BurnUp, ChancePorHorario, LinhaDoTempoDasPartes, TempoPorEtapa } from './graficos'
import { hora, quando } from './hora'
import { ROTULO_DA_SITUACAO } from './plano-da-entrega'

export interface SalaDeGestaoProps {
  aberto: boolean
  onFechar: () => void
  titulo: string
  dados: DadosDaGestao | undefined
  agora: Date
  tecnico: ReactNode
}

const SEM_BASE = 'previsão ainda sem base'

function Indicador({
  rotulo,
  valor,
  detalhe,
  tom,
}: {
  rotulo: string
  valor: string
  detalhe: string
  tom?: 'bom' | 'atencao'
}) {
  return (
    <div className="rounded-padrao border border-border bg-surface px-3 py-2.5">
      <span className="block text-[11px] text-text-secondary">{rotulo}</span>
      <b
        className={
          tom === 'bom'
            ? 'text-xl text-sucesso'
            : tom === 'atencao'
              ? 'text-xl text-atencao'
              : 'text-xl text-text-primary'
        }
      >
        {valor}
      </b>
      <small className="block text-[11px] text-text-secondary">{detalhe}</small>
    </div>
  )
}

function Quadro({
  titulo,
  texto,
  children,
  largo,
}: {
  titulo: string
  texto: string
  children: ReactNode
  largo?: boolean
}) {
  return (
    <div
      className={`rounded-padrao border border-border bg-surface px-3.5 py-3 ${largo ? 'lg:col-span-2' : ''}`}
    >
      <h4 className="text-sm font-semibold text-text-primary">{titulo}</h4>
      <p className="mt-0.5 mb-2 text-[11px] leading-snug text-text-secondary">{texto}</p>
      {children}
    </div>
  )
}

const usd = (v: number) => `US$ ${v.toFixed(2).replace('.', ',')}`

export function SalaDeGestao({
  aberto,
  onFechar,
  titulo,
  dados,
  agora,
  tecnico,
}: SalaDeGestaoProps) {
  const total = dados?.linhas.length ?? 0
  return (
    <Dialog.Root open={aberto} onOpenChange={(abrir) => !abrir && onFechar()}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className="fixed inset-0 z-50 opacity-80"
          style={{ background: 'var(--pixel-contorno)' }}
        />
        <Dialog.Popup
          className="fixed top-1/2 left-1/2 z-50 max-h-[92vh] w-[min(1180px,95vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-amplo bg-background px-5 py-5 motion-safe:animate-in motion-safe:zoom-in-90"
          style={{ boxShadow: '0 0 0 6px var(--pixel-borda)' }}
        >
          <Dialog.Close
            className="absolute top-3 right-3 size-9 rounded-full bg-surface text-base font-bold text-text-primary shadow"
            aria-label="Fechar a sala de gestão"
          >
            ✕
          </Dialog.Close>
          <Dialog.Title className="text-lg font-semibold text-text-primary">
            📊 Sala de gestão · {titulo}
          </Dialog.Title>
          <p className="mt-0.5 mb-3.5 text-xs text-text-secondary">
            Como a execução está indo, quanto falta e quando fica pronta.
          </p>

          {!dados ? (
            <p className="text-sm text-text-secondary">{SEM_BASE}</p>
          ) : (
            <>
              <div className="mb-3.5 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
                <Indicador
                  rotulo="Entrega prevista"
                  valor={dados.entregaPrevista ? hora(dados.entregaPrevista.p50) : '—'}
                  detalhe={
                    dados.entregaPrevista
                      ? `85% de chance até ${hora(dados.entregaPrevista.p85)}`
                      : SEM_BASE
                  }
                />
                <Indicador
                  rotulo="Faltam"
                  valor={`${dados.faltam}`}
                  detalhe="partes, mais a publicação"
                />
                <Indicador
                  rotulo="Critérios prontos"
                  valor={`${dados.criterios[0]} / ${dados.criterios[1]}`}
                  detalhe="conferidos pelo revisor"
                  tom="bom"
                />
                <Indicador
                  rotulo="Partes em andamento"
                  valor={`${dados.emAndamento}`}
                  detalhe={`limite: ${dados.vagas} de uma vez`}
                />
                <Indicador
                  rotulo="Custo dos agentes"
                  valor={usd(dados.custo.gasto)}
                  detalhe={
                    dados.custo.previsto === null
                      ? 'previsto: sem base'
                      : `previsto no total: ${usd(dados.custo.previsto)}`
                  }
                  tom="atencao"
                />
                <Indicador
                  rotulo="Retrabalho"
                  valor={`${dados.retrabalho}`}
                  detalhe="consertos e PRs devolvidos"
                  tom={dados.retrabalho === 0 ? 'bom' : 'atencao'}
                />
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                <div className="rounded-padrao border border-border bg-tonal-informacao px-3.5 py-3 lg:col-span-3">
                  <h4 className="text-sm font-semibold text-text-primary">
                    ⏱ Previsão de entrega e tempo de cada parte
                  </h4>
                  <div className="my-2 flex flex-wrap items-baseline gap-4">
                    <span className="text-2xl font-extrabold text-informacao">
                      {dados.entregaPrevista
                        ? `Pronta ${quando(dados.entregaPrevista.p50, agora)}`
                        : SEM_BASE}
                    </span>
                    {dados.entregaPrevista && (
                      <span className="text-sm text-text-secondary">
                        85% de chance até {hora(dados.entregaPrevista.p85)}
                        {dados.caminhoCritico.length > 0 &&
                          ` · caminho crítico: ${dados.caminhoCritico.join(' → ')} → publicação`}
                      </span>
                    )}
                  </div>
                  <p className="mb-2 text-[11px] text-text-secondary">
                    Barra cheia: tempo já gasto. Tracejada: o que falta, pela previsão. Linha azul:
                    agora.
                  </p>
                  <LinhaDoTempoDasPartes
                    linhas={dados.linhas}
                    agora={agora}
                    entrega={dados.entregaPrevista?.p50 ?? null}
                  />
                  <table className="mt-2.5 w-full border-collapse text-xs">
                    <thead>
                      <tr className="text-left text-[10px] tracking-wide text-text-secondary uppercase">
                        {[
                          'Parte',
                          'Situação',
                          'Começou',
                          'Terminou / termina',
                          'Tempo real',
                          'Previsto',
                          'Diferença',
                        ].map((c) => (
                          <th key={c} className="border-b border-border px-2 py-1.5 font-semibold">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dados.linhas.map((l) => (
                        <tr key={l.raia} className="border-b border-border">
                          <td className="px-2 py-1.5">
                            <span
                              className="mr-1.5 inline-block size-2.5 rounded-[3px] align-[-1px]"
                              style={{ background: `var(--pixel-raia-${l.cor % 8})` }}
                            />
                            {l.raia}
                          </td>
                          <td className="px-2 py-1.5">{ROTULO_DA_SITUACAO[l.situacao]}</td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {l.comecou ? hora(l.comecou) : '—'}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {l.termina ? `${l.terminaPrevisto ? '~' : ''}${hora(l.termina)}` : '—'}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {l.realMin === null ? '—' : `${l.realMin} min`}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {l.previstoMin === null ? '—' : `${Math.round(l.previstoMin)} min`}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {l.diferenca === null ? (
                              '—'
                            ) : (
                              <span
                                data-tom={l.diferenca > 0 ? 'ruim' : 'bom'}
                                className={
                                  l.diferenca > 0 ? 'font-bold text-erro' : 'font-bold text-sucesso'
                                }
                              >
                                {l.diferenca > 0 ? `+${l.diferenca}` : l.diferenca} min
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Quadro
                  largo
                  titulo="Burn-up das partes"
                  texto="Partes entregues ao longo do tempo. Tracejada: o ritmo previsto até a entrega."
                >
                  <BurnUp dados={dados} total={total} agora={agora} />
                </Quadro>
                <Quadro
                  titulo="Quando fica pronto?"
                  texto="Simulação com o ritmo das partes já feitas: a chance de terminar em cada horário."
                >
                  {dados.chances.length === 0 ? (
                    <p className="text-xs text-text-secondary">{SEM_BASE}</p>
                  ) : (
                    <ChancePorHorario chances={dados.chances} />
                  )}
                </Quadro>
                <Quadro
                  titulo="Tempo por etapa"
                  texto="Real (azul) contra o previsto; vermelho quando passa."
                >
                  {dados.etapas.length === 0 ? (
                    <p className="text-xs text-text-secondary">nenhuma etapa concluída ainda</p>
                  ) : (
                    <TempoPorEtapa etapas={dados.etapas} />
                  )}
                </Quadro>
                <div className="lg:col-span-3">
                  <h4 className="mb-2 text-sm font-semibold text-text-primary">
                    Detalhes técnicos
                  </h4>
                  {tecnico}
                </div>
              </div>
            </>
          )}
          {!dados && <div className="mt-4">{tecnico}</div>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
