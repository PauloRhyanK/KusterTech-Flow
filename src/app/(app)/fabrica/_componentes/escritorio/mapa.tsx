'use client'

// O escritório de um andar: mapa visto de cima com uma área por etapa, a copa (só cenário), a sala de gestão,
// a esteira (fila → mesa → entrega), as mesas, os cantos de hobby e os personagens. Posições em layout.ts.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  type Agente,
  type Andar,
  type Area,
  type Caixa as CaixaDoModelo,
  type Grupo,
  grupoDoEstado,
} from '@/modules/fabrica/escritorio/model'
import { s } from './classes'
import { CantoDoHobby, hobbyDoPapel, TAMANHO_DO_CANTO } from './hobbies'
import {
  ALTURA,
  AREAS,
  CADEIRA,
  CAIXA_NA_MESA,
  DE_PE,
  ENTRADA,
  ENTRADA_DO_CONSERTO,
  ENTREGA,
  FILA,
  GESTAO,
  LARGURA,
  lugaresDoAndar,
  type Ponto,
  POSE_DO_HOBBY,
  PORTA_DA_GESTAO,
  pontoDoConserto,
  SENTADO,
  soma,
} from './layout'
import { type Lugar, Personagem } from './personagem'
import { Cadeira, Caixa, Mesa, Objeto, v } from './pixel'

export interface MapaProps {
  andar: Andar
  onAbrirAgente: (id: string) => void
  onAbrirTela: (runId: string) => void
  onAbrirParte: (raia: string) => void
  onAbrirGestao: () => void
  /** grupo aceso pelos contadores; quem é de outro grupo fica esmaecido */
  filtro: Grupo | null
  /** id do agente realçado pelo mouse (Task 7) */
  realce: string | null
  onRealcar: (id: string | null) => void
}

interface Decoracao {
  nome: string
  x: number
  y: number
  /** token da cor do tapete (só para o tapete) */
  tapete?: string
}

// Cenário do rascunho v7, em coordenadas do mapa (canto superior esquerdo de cada objeto).
const DECORACAO: Decoracao[] = [
  { nome: 'janelaComNuvem', x: 40, y: 9 },
  { nome: 'janelaComNuvem', x: 290, y: 9 },
  { nome: 'janelaComNuvem', x: 540, y: 9 },
  { nome: 'relogio', x: 745, y: 10 },
  { nome: 'janelaComNuvem', x: 850, y: 9 },
  // triagem
  { nome: 'tapete', x: 125, y: 216, tapete: 'tapete-triagem' },
  { nome: 'planta', x: 214, y: 90 },
  { nome: 'lixo', x: 120, y: 236 },
  // planejamento
  { nome: 'tapete', x: 300, y: 226, tapete: 'tapete-planejamento' },
  { nome: 'quadroPostIts', x: 377, y: 92 },
  // desenho
  { nome: 'tapete', x: 515, y: 226, tapete: 'tapete-desenho' },
  { nome: 'painelDeCores', x: 540, y: 170 },
  // copa: só cenário
  { nome: 'bebedouro', x: 713, y: 100 },
  { nome: 'geladeira', x: 753, y: 94 },
  { nome: 'planta', x: 729, y: 156 },
  { nome: 'sofaComGato', x: 711, y: 206 },
  // sala de gestão
  { nome: 'tapete', x: 865, y: 196, tapete: 'tapete-gestao' },
  { nome: 'telaoGrafico', x: 819, y: 98 },
  { nome: 'plantona', x: 955, y: 92 },
  { nome: 'mesaDeReuniao', x: 905, y: 146 },
  { nome: 'portaDaGestao', x: PORTA_DA_GESTAO.x - 24, y: GESTAO.y + GESTAO.h - 24 },
  // desenvolvimento
  { nome: 'tapete', x: 114, y: 602, tapete: 'tapete-desenvolvimento' },
  { nome: 'tapete', x: 270, y: 602, tapete: 'tapete-desenvolvimento' },
  { nome: 'tapete', x: 420, y: 602, tapete: 'tapete-desenvolvimento' },
  { nome: 'estante', x: 222, y: 594 },
  // teste e revisão
  { nome: 'tapete', x: 635, y: 608, tapete: 'tapete-teste' },
  { nome: 'telaoTestes', x: 655, y: 476 },
  { nome: 'planta', x: 661, y: 577 },
  // publicação
  { nome: 'racks', x: 830, y: 396 },
  { nome: 'impressora', x: 830, y: 492 },
  { nome: 'foguete', x: 898, y: 492 },
  { nome: 'palete', x: 830, y: 572 },
  { nome: 'planta', x: 884, y: 608 },
]

// LEDs piscando nos racks: as casas 'gg' de cada gaveta do sprite (escala 3), duas torres a 45 px.
const LEDS: Ponto[] = [0, 45].flatMap((dx) =>
  [0, 1, 2, 3].map((u) => ({ x: 6 + dx, y: 6 + 12 * u })),
)

function posicaoDaCaixa(caixa: CaixaDoModelo, indiceNoLugar: number, mesaDaRaia: Ponto | null) {
  if (caixa.lugar === 'fila') return { x: FILA.x + 45, y: FILA.y + 48 + (indiceNoLugar % 4) * 58 }
  if (caixa.lugar === 'entrega') {
    return {
      x: ENTREGA.x + 40 + (indiceNoLugar % 3) * 26,
      y: ENTREGA.y + 44 - Math.floor(indiceNoLugar / 3) * 20,
    }
  }
  if (mesaDaRaia) return soma(mesaDaRaia, CAIXA_NA_MESA)
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

const SENTA = new Set<Agente['estado']>(['trabalhando', 'semNoticias'])

interface Cena {
  agente: Agente
  mesa: Ponto | null
  canto: Ponto | null
  destino: Ponto
  lugar: Lugar
  sentado: boolean
}

/** Onde cada agente fica agora, pelo estado: sentado, de pé na frente da mesa, no canto, na porta ou no conserto. */
function montarCena(agentes: Agente[]): Cena[] {
  const lugares = lugaresDoAndar(agentes)
  const areaPorId = new Map(agentes.map((a) => [a.id, a.area]))
  return agentes.map((agente) => {
    const { mesa, canto } = lugares.get(agente.id) ?? { mesa: null, canto: null }
    const base = { agente, mesa, canto }
    if (agente.papel === 'fixer') {
      const idDaRaia = agente.raia ? `raia:${agente.raia}` : null
      const mesaDaRaia = idDaRaia ? (lugares.get(idDaRaia)?.mesa ?? null) : null
      const destino = mesaDaRaia
        ? pontoDoConserto(mesaDaRaia, areaPorId.get(idDaRaia!) ?? agente.area)
        : { x: AREAS[agente.area].x + 230, y: AREAS[agente.area].y + 110 }
      return { ...base, destino, lugar: 'conserto', sentado: false }
    }
    if (agente.estado === 'chamando')
      return { ...base, destino: PORTA_DA_GESTAO, lugar: 'porta', sentado: false }
    const hobby = hobbyDoPapel(agente.papel)
    if (agente.estado === 'livre' && canto && hobby)
      return { ...base, destino: soma(canto, POSE_DO_HOBBY[hobby]), lugar: 'canto', sentado: false }
    const naMesa = mesa ?? { x: AREAS[agente.area].x + 60, y: AREAS[agente.area].y + 62 }
    const sentado = SENTA.has(agente.estado)
    return {
      ...base,
      destino: soma(naMesa, sentado ? SENTADO : DE_PE),
      lugar: 'mesa',
      sentado,
    }
  })
}

function estadoDaMesa(agente: Agente): 'apagada' | 'acesa' | 'falha' {
  if (SENTA.has(agente.estado)) return 'acesa'
  return agente.estado === 'falha' ? 'falha' : 'apagada'
}

function ObjetoDoCenario({ o }: { o: Decoracao }) {
  const estilo: React.CSSProperties & Record<'--pixel-tapete', string | undefined> = {
    left: o.x,
    top: o.y,
    '--pixel-tapete': o.tapete ? v(o.tapete) : undefined,
  }
  return (
    <span className={o.tapete ? `${s.objeto} ${s.tapete}` : s.objeto} style={estilo}>
      <Objeto nome={o.nome} />
      {o.nome === 'janelaComNuvem' && (
        <span className={s.ceuDaJanela}>
          <i className={s.nuvem} />
          <i className={s.nuvem} />
        </span>
      )}
      {o.nome === 'racks' &&
        LEDS.map((p, i) => (
          <i key={i} className={s.led} style={{ left: p.x, top: p.y }} data-cor={i % 2} />
        ))}
    </span>
  )
}

export function Mapa({
  andar,
  onAbrirAgente,
  onAbrirTela,
  onAbrirParte,
  onAbrirGestao,
  filtro,
}: MapaProps) {
  const palco = useRef<HTMLDivElement>(null)
  const escala = useEscala(palco)
  const andando = useEsteiraAndando(andar.caixas)

  const cena = montarCena(andar.agentes)
  const mesaPorId = new Map(cena.map((c) => [c.agente.id, c.mesa]))
  const esmaecido = (a: Agente) => filtro !== null && grupoDoEstado(a.estado) !== filtro
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
          <ObjetoDoCenario key={`${o.nome}-${i}`} o={o} />
        ))}

        {/* Cantos de hobby: um por agente que tem hobby, ocupado ou não. Sem z-index no contêiner, para a
            camada da frente da poltrona passar na frente de quem lê. */}
        {cena.map(({ agente, canto }) => {
          const hobby = hobbyDoPapel(agente.papel)
          if (!canto || !hobby) return null
          const [w, h] = TAMANHO_DO_CANTO[hobby]
          return (
            <div
              key={`canto-${agente.id}`}
              className={s.lugarDoCanto}
              style={{ left: canto.x - w / 2, top: canto.y - h / 2 }}
            >
              <CantoDoHobby hobby={hobby} />
            </div>
          )
        })}

        {/* Mesas: uma por agente, com a cadeira atrás (vazia quando ele não está sentado). */}
        {cena.map(({ agente, mesa, sentado }) =>
          mesa ? (
            <div
              key={`mesa-${agente.id}`}
              className={s.posto}
              style={{ left: mesa.x, top: mesa.y }}
              data-mesa={agente.id}
              data-esmaecido={esmaecido(agente)}
            >
              <span className={s.objeto} style={{ left: CADEIRA.x, top: CADEIRA.y }}>
                <Cadeira vazia={!sentado} />
              </span>
              <button
                type="button"
                className={s.computador}
                style={{ left: -32, top: -24 }}
                aria-label={`computador de ${agente.nome}: ver a tela`}
                onClick={() => agente.runId !== null && onAbrirTela(agente.runId)}
              >
                <Mesa estado={estadoDaMesa(agente)} />
              </button>
            </div>
          ) : null,
        )}

        {cena.map(({ agente, destino, lugar, sentado }) => {
          const hobby = lugar === 'canto' ? hobbyDoPapel(agente.papel) : null
          return (
            <Personagem
              key={agente.id}
              agente={agente}
              destino={destino}
              lugar={lugar}
              sentado={sentado}
              hobby={hobby}
              esmaecido={esmaecido(agente)}
              entrada={lugar === 'conserto' ? ENTRADA_DO_CONSERTO : null}
              onAbrir={() => onAbrirAgente(agente.id)}
            />
          )
        })}

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
          const p = posicaoDaCaixa(c, i, mesaPorId.get(`raia:${c.raia}`) ?? null)
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
