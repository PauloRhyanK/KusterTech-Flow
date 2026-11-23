'use client'

// O escritório de um andar: mapa visto de cima com uma área por etapa, a copa, a sala de gestão, a esteira
// (fila → mesa → entrega) e os bonecos. Posições no palco fixo de 1100×680 do rascunho aprovado.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  Agente,
  Andar,
  Area,
  Caixa as CaixaDoModelo,
} from '@/modules/fabrica/escritorio/model'
import { s } from './classes'
import { Boneco, Cadeira, Caixa, Mesa, Objeto } from './pixel'

export interface MapaProps {
  andar: Andar
  onAbrirAgente: (id: string) => void
  onAbrirTela: (runId: string) => void
  onAbrirParte: (raia: string) => void
  onAbrirGestao: () => void
}

const LARGURA = 1100
const ALTURA = 680

interface Retangulo {
  x: number
  y: number
  w: number
  h: number
}

export const AREAS: Record<Area, Retangulo & { rotulo: string; cor: string }> = {
  triagem: { x: 110, y: 76, w: 160, h: 190, rotulo: 'Triagem', cor: 'area-triagem' },
  planejamento: { x: 285, y: 76, w: 170, h: 190, rotulo: 'Planejamento', cor: 'area-planejamento' },
  desenho: { x: 470, y: 76, w: 160, h: 190, rotulo: 'Desenho', cor: 'area-desenho' },
  copa: { x: 645, y: 76, w: 140, h: 190, rotulo: 'Copa', cor: 'area-copa' },
  desenvolvimento: {
    x: 110,
    y: 372,
    w: 390,
    h: 280,
    rotulo: 'Desenvolvimento',
    cor: 'area-desenvolvimento',
  },
  teste: { x: 520, y: 372, w: 210, h: 280, rotulo: 'Teste e revisão', cor: 'area-teste' },
  publicacao: { x: 750, y: 372, w: 180, h: 280, rotulo: 'Publicação', cor: 'area-publicacao' },
}
const GESTAO: Retangulo = { x: 800, y: 76, w: 200, h: 190 }
const FILA: Retangulo = { x: 10, y: 372, w: 92, h: 250 }
const ENTRADA: Retangulo = { x: 10, y: 282, w: 90, h: 80 }
const ENTREGA: Retangulo = { x: 950, y: 560, w: 130, h: 100 }

const DECORACAO: { nome: string; x: number; y: number }[] = [
  { nome: 'janela', x: 40, y: 4 },
  { nome: 'janela', x: 300, y: 4 },
  { nome: 'relogio', x: 720, y: 12 },
  { nome: 'janela', x: 540, y: 4 },
  { nome: 'janela', x: 800, y: 4 },
  { nome: 'cortica', x: 122, y: 92 },
  { nome: 'planta', x: 225, y: 214 },
  { nome: 'lixo', x: 122, y: 236 },
  { nome: 'quadro', x: 300, y: 92 },
  { nome: 'mesaRedonda', x: 380, y: 200 },
  { nome: 'cavalete', x: 580, y: 96 },
  { nome: 'paleta', x: 485, y: 226 },
  { nome: 'planta', x: 590, y: 214 },
  { nome: 'sofa', x: 655, y: 96 },
  { nome: 'gato', x: 690, y: 92 },
  { nome: 'cafe', x: 745, y: 140 },
  { nome: 'bebedouro', x: 750, y: 196 },
  { nome: 'plantona', x: 650, y: 206 },
  { nome: 'painel', x: 818, y: 90 },
  { nome: 'mesaRedonda', x: 860, y: 186 },
  { nome: 'planta', x: 960, y: 216 },
  { nome: 'estante', x: 130, y: 388 },
  { nome: 'plantona', x: 450, y: 600 },
  { nome: 'lixo', x: 470, y: 390 },
  { nome: 'telao', x: 560, y: 388 },
  { nome: 'planta', x: 690, y: 600 },
  { nome: 'rack', x: 770, y: 392 },
  { nome: 'rack', x: 815, y: 392 },
  { nome: 'foguete', x: 880, y: 396 },
  { nome: 'impressora', x: 870, y: 600 },
  { nome: 'palete', x: 955, y: 618 },
]

/** Onde fica o n-ésimo boneco de uma área: uma grade de mesas, com espaço para o balão em cima. */
export function posicaoNaArea(area: Area, indice: number): { x: number; y: number } {
  const r = AREAS[area]
  if (area === 'copa') return { x: r.x + 70, y: r.y + 120 + (indice % 2) * 40 }
  const colunas = Math.max(1, Math.floor((r.w - 20) / 120))
  return {
    x: r.x + 60 + (indice % colunas) * 120,
    y: r.y + 95 + Math.floor(indice / colunas) * 125,
  }
}

function posicaoDaCaixa(
  caixa: CaixaDoModelo,
  indiceNoLugar: number,
  posicaoDoAgente: Map<string, { x: number; y: number }>,
) {
  if (caixa.lugar === 'fila') return { x: FILA.x + 45, y: FILA.y + 48 + (indiceNoLugar % 4) * 58 }
  if (caixa.lugar === 'entrega') {
    return {
      x: ENTREGA.x + 40 + (indiceNoLugar % 3) * 26,
      y: ENTREGA.y + 44 - Math.floor(indiceNoLugar / 3) * 20,
    }
  }
  const agente = posicaoDoAgente.get(caixa.raia)
  if (agente) return { x: agente.x + 38, y: agente.y + 38 }
  return { x: AREAS.desenvolvimento.x + 300, y: AREAS.desenvolvimento.y + 240 - indiceNoLugar * 30 }
}

function useEscala(ref: React.RefObject<HTMLDivElement | null>): number {
  const [escala, setEscala] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = () => setEscala(Math.min(1, (el.clientWidth || LARGURA) / LARGURA))
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver(medir)
    obs.observe(el)
    return () => obs.disconnect()
  }, [ref])
  return escala
}

/** A esteira só anda enquanto uma caixa muda de lugar entre duas leituras (6,5 s). */
function useEsteiraAndando(caixas: CaixaDoModelo[]): boolean {
  const anterior = useRef<Map<string, string> | null>(null)
  const [andando, setAndando] = useState(false)
  useEffect(() => {
    const agora = new Map(caixas.map((c) => [c.raia, c.lugar]))
    const antes = anterior.current
    anterior.current = agora
    if (!antes) return
    const mudou = [...agora].some(([raia, lugar]) => antes.has(raia) && antes.get(raia) !== lugar)
    if (!mudou) return
    setAndando(true)
    const t = setTimeout(() => setAndando(false), 6500)
    return () => clearTimeout(t)
  }, [caixas])
  return andando
}

function Boneca({
  agente,
  x,
  y,
  onAbrir,
}: {
  agente: Agente
  x: number
  y: number
  onAbrir: () => void
}) {
  return (
    <button
      type="button"
      className={s.agente}
      style={{ left: x, top: y }}
      data-area={agente.area}
      data-trabalhando={agente.runId !== null}
      aria-label={agente.balao ? `${agente.nome}: ${agente.balao}` : agente.nome}
      onClick={onAbrir}
    >
      <span className={s.balao} title={agente.balao ?? undefined}>
        {agente.balao}
      </span>
      <Boneco papel={agente.papel} variacao={agente.variacao} />
    </button>
  )
}

export function Mapa({
  andar,
  onAbrirAgente,
  onAbrirTela,
  onAbrirParte,
  onAbrirGestao,
}: MapaProps) {
  const palco = useRef<HTMLDivElement>(null)
  const escala = useEscala(palco)
  const andando = useEsteiraAndando(andar.caixas)

  // posições dos agentes por área, na ordem do modelo
  const contagem = new Map<Area, number>()
  const posicoes = andar.agentes.map((a) => {
    const i = contagem.get(a.area) ?? 0
    contagem.set(a.area, i + 1)
    return posicaoNaArea(a.area, i)
  })
  const posicaoDoAgente = new Map<string, { x: number; y: number }>()
  andar.agentes.forEach((a, i) => {
    if (a.raia && a.runId !== null && a.area !== 'teste') posicaoDoAgente.set(a.raia, posicoes[i]!)
  })
  const porLugar = new Map<string, number>()

  return (
    <div ref={palco} className={s.palco} style={{ height: ALTURA * escala }}>
      <div
        className={`${s.mapa} ${andando ? s.andando : ''}`}
        style={{ transform: `scale(${escala})` }}
      >
        <div className={s.parede} />

        {(Object.keys(AREAS) as Area[]).map((area) => {
          const r = AREAS[area]
          return (
            <div
              key={area}
              className={s.area}
              data-area={area}
              data-atual={andar.areaAtual === area}
              style={{
                left: r.x,
                top: r.y,
                width: r.w,
                height: r.h,
                background: `var(--pixel-${r.cor})`,
              }}
            >
              <span className={s.rotulo}>{r.rotulo}</span>
              {area !== 'copa' &&
                andar.agentes
                  .map((a, i) => ({ a, p: posicoes[i]! }))
                  .filter(({ a }) => a.area === area)
                  .map(({ a, p }) => (
                    <div
                      key={a.id}
                      style={{ position: 'absolute', left: p.x - r.x, top: p.y - r.y }}
                    >
                      <span className={s.objeto} style={{ left: -16, top: -32 }}>
                        <Cadeira vazia={a.runId === null} />
                      </span>
                      <button
                        type="button"
                        className={s.computador}
                        style={{ left: -32, top: 24 }}
                        aria-label={`computador de ${a.nome}: ver a tela`}
                        onClick={() => a.runId !== null && onAbrirTela(a.runId)}
                      >
                        <Mesa
                          estado={
                            a.estado === 'falha' ? 'falha' : a.runId !== null ? 'acesa' : 'apagada'
                          }
                        />
                      </button>
                    </div>
                  ))}
            </div>
          )
        })}

        <div
          className={s.area}
          style={{
            left: GESTAO.x,
            top: GESTAO.y,
            width: GESTAO.w,
            height: GESTAO.h,
            background: 'var(--pixel-area-gestao)',
          }}
        />
        <button
          type="button"
          className={s.gestao}
          style={{ left: GESTAO.x, top: GESTAO.y, width: GESTAO.w, height: GESTAO.h }}
          aria-label="Sala de gestão: gráficos e previsão"
          onClick={onAbrirGestao}
        >
          <span className={s.rotulo}>Sala de gestão</span>
        </button>

        {DECORACAO.map((o, i) => (
          <span key={`${o.nome}-${i}`} className={s.objeto} style={{ left: o.x, top: o.y }}>
            <Objeto nome={o.nome} />
          </span>
        ))}

        {/* Bonecos fora do fundo da área (que tem opacidade e prende o empilhamento), acima da
            decoração e das placas, para o balão nunca ficar escondido. */}
        {andar.agentes.map((a, i) => (
          <Boneca
            key={a.id}
            agente={a}
            x={posicoes[i]!.x}
            y={posicoes[i]!.y}
            onAbrir={() => onAbrirAgente(a.id)}
          />
        ))}

        <div
          className={s.doca}
          style={{
            left: ENTRADA.x,
            top: ENTRADA.y,
            width: ENTRADA.w,
            height: ENTRADA.h,
            background: 'var(--pixel-doca-entrada)',
          }}
        />
        <span className={s.rotulo} style={{ left: ENTRADA.x + 12, top: ENTRADA.y - 11 }}>
          Entrada
        </span>
        <div
          className={s.prateleira}
          style={{ left: FILA.x + 6, top: FILA.y + 14, width: 80, height: 224 }}
        />
        <span className={s.rotulo} style={{ left: FILA.x + 12, top: FILA.y - 11 }}>
          Fila
        </span>
        <div
          className={`${s.esteira} ${s.esteiraH}`}
          style={{ left: 60, top: 300, width: 960, height: 40 }}
        />
        <div
          className={`${s.esteira} ${s.esteiraV}`}
          style={{ left: 980, top: 300, width: 40, height: 270 }}
        />
        <div
          className={s.doca}
          style={{
            left: ENTREGA.x,
            top: ENTREGA.y,
            width: ENTREGA.w,
            height: ENTREGA.h,
            background: 'var(--pixel-doca-entrega)',
          }}
        />
        <span className={s.rotulo} style={{ left: ENTREGA.x + 12, top: ENTREGA.y - 11 }}>
          Entrega
        </span>

        {andar.caixas.map((c) => {
          const i = porLugar.get(c.lugar) ?? 0
          porLugar.set(c.lugar, i + 1)
          const p = posicaoDaCaixa(c, i, posicaoDoAgente)
          // Na entrega as caixas ficam a 26 px uma da outra: o nome não cabe e vai para o title.
          const entregue = c.lugar === 'entrega'
          return (
            <button
              key={c.raia}
              type="button"
              className={s.caixa}
              style={{ left: p.x, top: p.y }}
              data-lugar={c.lugar}
              title={c.raia}
              aria-label={`caixa ${c.raia}, ${c.lugar === 'fila' ? 'na fila' : c.lugar === 'mesa' ? 'na mesa' : 'entregue'}`}
              onClick={() => onAbrirParte(c.raia)}
            >
              <span className={s.etiqueta}>{entregue ? '✓' : c.raia}</span>
              <Caixa cor={c.cor} entregue={c.lugar === 'entrega'} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
