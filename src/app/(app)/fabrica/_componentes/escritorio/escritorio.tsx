'use client'

// O escritório da Fábrica: prédio à esquerda, o mapa e o plano do andar escolhido no centro, o detalhe à direita.
// No celular, uma lista simples de andares (sem o mapa).
import { type ReactNode, useState } from 'react'
import type { DadosDaGestao } from '@/modules/fabrica/escritorio/gestao'
import type { Escritorio as DadosDoEscritorio } from '@/modules/fabrica/escritorio/model'
import { Detalhe, type Selecao } from './detalhe'
import { Mapa } from './mapa'
import { PlanoDaEntrega, textoDosTotais } from './plano-da-entrega'
import { Predio } from './predio'
import { SalaDeGestao } from './sala-de-gestao'
import { TelaDoAgente } from './tela-do-agente'

export interface EscritorioProps {
  escritorio: DadosDoEscritorio
  gestao: Record<string, DadosDaGestao>
  /** ISO do instante da leitura no servidor */
  agora: string
  tecnico: ReactNode
}

export function Escritorio({ escritorio, gestao, agora, tecnico }: EscritorioProps) {
  const { andares, recepcao, formatoAntigo } = escritorio
  const primeiro =
    andares.find((a) => a.esperaPaulo)?.planoId ?? andares[andares.length - 1]?.planoId ?? null
  const [planoId, setPlanoId] = useState<string | null>(primeiro)
  const [selecao, setSelecao] = useState<Selecao>(null)
  const [tela, setTela] = useState<string | null>(null)
  const [gestaoAberta, setGestaoAberta] = useState(false)
  const andar =
    andares.find((a) => a.planoId === planoId) ??
    andares.find((a) => a.planoId === primeiro) ??
    null

  const agoraData = new Date(agora)
  const agenteDaTela = andar?.agentes.find((a) => a.runId === tela) ?? null
  const parteDaTela =
    andar?.fases.flatMap((f) => f.partes).find((p) => p.raia === agenteDaTela?.raia) ?? null

  const abrirParte = (raia: string) => {
    if (!andar) return
    const fase = andar.fases.find((f) => f.partes.some((p) => p.raia === raia))
    const parte = fase?.partes.find((p) => p.raia === raia)
    if (fase && parte) setSelecao({ tipo: 'parte', parte, fase: fase.id })
  }
  const abrirAgente = (id: string) => {
    const agente = andar?.agentes.find((a) => a.id === id)
    if (agente) setSelecao({ tipo: 'agente', agente })
  }

  return (
    <div className="space-y-4">
      {formatoAntigo && (
        <p className="rounded-padrao bg-tonal-atencao px-3 py-2 text-sm">
          A Fábrica ainda manda o formato antigo do retrato: o prédio e o plano aparecem, mas sem os
          bonecos e sem o que cada agente faz.
        </p>
      )}

      {/* celular: lista simples */}
      <ul className="space-y-2 md:hidden">
        {andares.length === 0 && (
          <li className="text-sm text-text-secondary">nenhuma demanda andando</li>
        )}
        {[...andares].reverse().map((a) => (
          <li
            key={a.planoId}
            className={`rounded-padrao border border-border bg-surface p-3 ${a.esperaPaulo ? 'bg-tonal-atencao' : ''}`}
          >
            <b className="block text-sm text-text-primary">{a.titulo}</b>
            <span className="text-xs text-text-secondary">
              {textoDosTotais(a.fases)}
              {a.esperaPaulo ? ' · espera você' : ''}
            </span>
          </li>
        ))}
      </ul>

      {/* tela grande: o escritório */}
      <div className="hidden gap-4 md:grid lg:grid-cols-[290px_minmax(0,1fr)_300px]">
        <Predio
          andares={andares}
          recepcao={recepcao}
          selecionado={andar?.planoId ?? null}
          onSelecionar={(id) => {
            setPlanoId(id)
            setSelecao(null)
          }}
        />
        <div className="min-w-0 space-y-4">
          {andar ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-text-primary">{andar.titulo}</h2>
                <span className="text-xs text-text-secondary">{textoDosTotais(andar.fases)}</span>
              </div>
              <Mapa
                andar={andar}
                onAbrirAgente={abrirAgente}
                onAbrirTela={setTela}
                onAbrirParte={abrirParte}
                onAbrirGestao={() => setGestaoAberta(true)}
              />
              <PlanoDaEntrega
                fases={andar.fases}
                selecionada={selecao?.tipo === 'parte' ? selecao.parte.raia : null}
                onSelecionar={abrirParte}
              />
            </>
          ) : (
            <p className="rounded-padrao border border-border bg-surface p-6 text-sm text-text-secondary">
              Nenhuma demanda em execução agora. Quando a Fábrica pegar uma, ela ganha um andar no
              prédio.
            </p>
          )}
        </div>
        <aside className="rounded-padrao border border-border bg-surface p-4">
          <Detalhe selecao={selecao} />
        </aside>
      </div>

      {/* detalhes técnicos em linha: no celular sempre; na tela grande, só sem demanda (senão ficam na sala de gestão) */}
      <div className={andares.length === 0 ? undefined : 'md:hidden'}>{tecnico}</div>

      <TelaDoAgente
        agente={agenteDaTela}
        parte={parteDaTela}
        aberto={tela !== null}
        onFechar={() => setTela(null)}
      />
      <SalaDeGestao
        aberto={gestaoAberta}
        onFechar={() => setGestaoAberta(false)}
        titulo={andar?.titulo ?? 'Fábrica'}
        dados={andar ? gestao[andar.planoId] : undefined}
        agora={agoraData}
        tecnico={tecnico}
      />
    </div>
  )
}
