'use client'

// O escritório da Fábrica: prédio à esquerda, o mapa e o plano do andar escolhido no centro, o detalhe à direita.
// No celular, uma lista simples de andares (sem o mapa).
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { DadosDaGestao } from '@/modules/fabrica/escritorio/gestao'
import type { DadosDoEscritorio as DadosDaPagina } from '@/modules/fabrica/escritorio/queries'
import {
  contarEstados,
  type Escritorio as DadosDoEscritorio,
  type Grupo,
  porEsperaMaisLonga,
} from '@/modules/fabrica/escritorio/model'
import { Contadores } from './contadores'
import { Detalhe, type Selecao } from './detalhe'
import { EsperasDoPaulo } from './esperas-do-paulo'
import { GavetaDaFila } from './gaveta-da-fila'
import { Mapa } from './mapa'
import { PlanoDaEntrega, textoDosTotais } from './plano-da-entrega'
import { Predio, origemDoAndar, textoDaEspera } from './predio'
import { SalaDeGestao } from './sala-de-gestao'
import { TelaDoAgente } from './tela-do-agente'

export interface EscritorioProps {
  escritorio: DadosDoEscritorio
  gestao: Record<string, DadosDaGestao>
  /** fila de publicação para a gaveta; null sem o módulo */
  publicacao: DadosDaPagina['publicacao']
  /** ISO do instante da leitura no servidor */
  agora: string
  tecnico: ReactNode
}

/** Guarda só as chaves: o conteúdo é lido do retrato atual a cada render, para a ficha não envelhecer. */
type Escolha = { tipo: 'agente'; id: string } | { tipo: 'parte'; raia: string; fase: string } | null

export function Escritorio({ escritorio, gestao, publicacao, agora, tecnico }: EscritorioProps) {
  const { andares, recepcao, esperas, formatoAntigo } = escritorio
  // abre no andar que espera o Paulo há mais tempo
  const primeiro =
    [...andares].sort(porEsperaMaisLonga).find((a) => a.esperaPaulo)?.planoId ??
    andares[andares.length - 1]?.planoId ??
    null
  const [planoId, setPlanoId] = useState<string | null>(primeiro)
  const [selecao, setSelecao] = useState<Escolha>(null)
  const [tela, setTela] = useState<string | null>(null)
  const [gestaoAberta, setGestaoAberta] = useState(false)
  const [filaAberta, setFilaAberta] = useState(false)
  // o botão da recepção, para devolver o foco ao fechar a gaveta (alguns navegadores não focam o botão ao clicar)
  const gatilhoDaFila = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!filaAberta) gatilhoDaFila.current?.focus()
  }, [filaAberta])
  const [filtro, setFiltro] = useState<Grupo | null>(null)
  const [realce, setRealce] = useState<string | null>(null)
  const andar =
    andares.find((a) => a.planoId === planoId) ??
    andares.find((a) => a.planoId === primeiro) ??
    null

  const esperam = recepcao.filter((r) => r.esperaPaulo).length
  const agoraData = new Date(agora)
  const agenteDaTela = tela === null ? null : (andar?.agentes.find((a) => a.runId === tela) ?? null)
  const parteDaTela =
    andar?.fases.flatMap((f) => f.partes).find((p) => p.raia === agenteDaTela?.raia) ?? null

  const abrirParte = (raia: string) => {
    if (!andar) return
    const fase = andar.fases.find((f) => f.partes.some((p) => p.raia === raia))
    if (fase) setSelecao({ tipo: 'parte', raia, fase: fase.id })
  }
  let selecionado: Selecao = null
  if (andar && selecao?.tipo === 'agente') {
    const agente = andar.agentes.find((a) => a.id === selecao.id)
    if (agente) selecionado = { tipo: 'agente', agente }
  } else if (andar && selecao?.tipo === 'parte') {
    const fase = andar.fases.find((f) => f.id === selecao.fase)
    const parte = fase?.partes.find((p) => p.raia === selecao.raia)
    if (parte) selecionado = { tipo: 'parte', parte, fase: selecao.fase }
  }
  // realce é o id do agente; o plano fala em raia. Quem não tem raia (papéis) não acende cartão.
  const raiaRealcada = andar?.agentes.find((a) => a.id === realce)?.raia ?? null
  const realcarRaia = (raia: string | null) =>
    setRealce(
      raia === null
        ? null
        : (andar?.agentes.find((a) => a.raia === raia && a.papel !== 'fixer')?.id ?? null),
    )
  const abrirAgente = (id: string) => {
    if (andar?.agentes.some((a) => a.id === id)) setSelecao({ tipo: 'agente', id })
  }

  return (
    <div className="space-y-4">
      {formatoAntigo && (
        <p className="rounded-padrao bg-tonal-atencao px-3 py-2 text-sm">
          A Fábrica ainda manda o formato antigo do retrato: o prédio e o plano aparecem, mas sem os
          bonecos e sem o que cada agente faz.
        </p>
      )}

      <EsperasDoPaulo esperas={esperas} />

      {/* celular: o prédio não aparece, então a fila abre por este botão */}
      <button
        type="button"
        className="w-full rounded-padrao border border-border bg-surface px-3 py-2 text-left text-sm font-medium text-text-primary md:hidden"
        aria-haspopup="dialog"
        aria-expanded={filaAberta}
        onClick={(e) => {
          gatilhoDaFila.current = e.currentTarget
          setFilaAberta(true)
        }}
      >
        Fila · {recepcao.length} {recepcao.length === 1 ? 'demanda' : 'demandas'}
        {esperam > 0 ? ` · ${esperam} ${esperam === 1 ? 'espera' : 'esperam'} você` : ''}
      </button>

      {/* celular: lista simples, quem espera o Paulo há mais tempo primeiro */}
      <ul className="space-y-2 md:hidden">
        {andares.length === 0 && (
          <li className="text-sm text-text-secondary">nenhuma demanda andando</li>
        )}
        {[...andares]
          .reverse()
          .sort(porEsperaMaisLonga)
          .map((a) => (
            <li
              key={a.planoId}
              data-longa={a.esperando?.longa ?? false}
              className={`rounded-padrao border p-3 ${
                a.esperando?.longa
                  ? 'border-erro/30 bg-tonal-erro'
                  : a.esperaPaulo
                    ? 'border-border bg-tonal-atencao'
                    : 'border-border bg-surface'
              }`}
            >
              <b className="block text-sm text-text-primary">{a.titulo}</b>
              <span className="block text-xs text-text-secondary">{origemDoAndar(a)}</span>
              <span className="text-xs text-text-secondary">
                {textoDosTotais(a.fases)}
                {a.esperaPaulo ? ` · ${textoDaEspera(a)}` : ''}
              </span>
            </li>
          ))}
      </ul>

      {/* tela grande: o escritório */}
      <div className="hidden gap-4 md:grid lg:grid-cols-[290px_minmax(0,1fr)_300px]">
        <Predio
          andares={andares}
          recepcao={recepcao}
          filaAberta={filaAberta}
          onAbrirFila={(gatilho) => {
            gatilhoDaFila.current = gatilho
            setFilaAberta(true)
          }}
          selecionado={andar?.planoId ?? null}
          onSelecionar={(id) => {
            setPlanoId(id)
            setSelecao(null)
            setFiltro(null)
            setRealce(null)
          }}
        />
        <div className="min-w-0 space-y-4">
          {andar ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-text-primary">{andar.titulo}</h2>
                  <p className="text-xs text-text-secondary">{origemDoAndar(andar)}</p>
                </div>
                <Contadores
                  contagem={contarEstados(andar.agentes)}
                  filtro={filtro}
                  onFiltrar={setFiltro}
                />
                <span className="text-xs text-text-secondary">{textoDosTotais(andar.fases)}</span>
              </div>
              <Mapa
                key={andar.planoId}
                andar={andar}
                onAbrirAgente={abrirAgente}
                onAbrirTela={setTela}
                onAbrirParte={abrirParte}
                onAbrirGestao={() => setGestaoAberta(true)}
                filtro={filtro}
                realce={realce}
                onRealcar={setRealce}
              />
              <PlanoDaEntrega
                fases={andar.fases}
                selecionada={selecionado?.tipo === 'parte' ? selecionado.parte.raia : null}
                onSelecionar={abrirParte}
                realcada={raiaRealcada}
                onRealcar={realcarRaia}
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
          <Detalhe selecao={selecionado} onAbrirTela={setTela} agora={agoraData} />
        </aside>
      </div>

      {/* detalhes técnicos em linha: no celular sempre; na tela grande, só sem demanda (senão ficam na sala de gestão) */}
      <div className={andares.length === 0 ? undefined : 'md:hidden'}>{tecnico}</div>

      {filaAberta && (
        <GavetaDaFila
          recepcao={recepcao}
          publicacao={publicacao}
          agora={agoraData}
          onFechar={() => setFilaAberta(false)}
        />
      )}
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
