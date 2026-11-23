'use client'

// Um personagem do mapa: o boneco (botão) e o balão dele, que fica numa camada acima de mesas e cantos.
// A posição muda por left/top com transição de 1,8 s em CSS; enquanto anda, ganha esc-andando (passos).
import { useEffect, useRef, useState } from 'react'
import type { Agente } from '@/modules/fabrica/escritorio/model'
import { s } from './classes'
import { CLASSE_DO_HOBBY, FAZENDO_DO_HOBBY, type Hobby } from './hobbies'
import type { Ponto } from './layout'
import { Boneco } from './pixel'

export type Lugar = 'mesa' | 'canto' | 'porta' | 'conserto'

/** Duração da caminhada entre dois lugares (igual à transição de .esc-agente em globals.css). */
const CAMINHADA_MS = 1800
/** Metade da altura do boneco (16×22 em escala 3) mais a folga até o balão. */
const ALTURA_DO_BALAO = 37

/** O texto do aria-label depois do nome: o balão, ou o que o livre está fazendo, ou o chamado. */
export function textoDoAgente(agente: Agente, hobby: Hobby | null): string | null {
  if (agente.estado === 'livre') return hobby ? `livre, ${FAZENDO_DO_HOBBY[hobby]}` : 'livre'
  if (agente.estado === 'chamando') return `precisa de você: ${agente.balao ?? ''}`
  return agente.balao
}

/** true por CAMINHADA_MS sempre que o ponto muda depois da primeira posição. */
function useAndando(ponto: Ponto): boolean {
  const anterior = useRef<string | null>(null)
  const [andando, setAndando] = useState(false)
  const chave = `${ponto.x},${ponto.y}`
  useEffect(() => {
    const antes = anterior.current
    anterior.current = chave
    if (antes === null || antes === chave) return
    setAndando(true)
    const t = setTimeout(() => setAndando(false), CAMINHADA_MS)
    return () => clearTimeout(t)
  }, [chave])
  return andando
}

/** Quem entra por um ponto (o conserto) começa nele e, logo depois de montar, anda até o destino. */
function useChegada(entrada: Ponto | null): boolean {
  const [chegou, setChegou] = useState(entrada === null)
  useEffect(() => {
    if (chegou) return
    const t = setTimeout(() => setChegou(true), 30)
    return () => clearTimeout(t)
  }, [chegou])
  return chegou
}

export function Personagem({
  agente,
  destino,
  lugar,
  sentado,
  hobby,
  esmaecido,
  entrada,
  onAbrir,
}: {
  agente: Agente
  destino: Ponto
  lugar: Lugar
  sentado: boolean
  /** hobby do canto onde ele está; null fora do canto */
  hobby: Hobby | null
  esmaecido: boolean
  /** de onde ele entra correndo (o conserto); null para quem já está no andar */
  entrada: Ponto | null
  onAbrir: () => void
}) {
  const chegou = useChegada(entrada)
  const ponto = chegou || entrada === null ? destino : entrada
  const andando = useAndando(ponto)
  const texto = textoDoAgente(agente, hobby)
  const classes = [
    s.agente,
    hobby && agente.estado === 'livre' ? CLASSE_DO_HOBBY[hobby] : null,
    andando ? s.andando : null,
  ]
  const balao =
    agente.balao === null
      ? null
      : agente.estado === 'chamando'
        ? `✋ ${agente.balao}`
        : agente.balao
  return (
    <>
      <button
        type="button"
        className={classes.filter(Boolean).join(' ')}
        style={{ left: ponto.x, top: ponto.y }}
        data-area={agente.area}
        data-estado={agente.estado}
        data-lugar={lugar}
        data-sentado={sentado}
        data-esmaecido={esmaecido}
        aria-label={texto ? `${agente.nome}: ${texto}` : agente.nome}
        onClick={onAbrir}
      >
        <Boneco papel={agente.papel} variacao={agente.variacao} escala={3} />
      </button>
      {balao !== null && (
        <span
          className={s.balao}
          style={{ left: ponto.x, top: ponto.y - ALTURA_DO_BALAO }}
          data-tom={agente.estado === 'livre' ? undefined : agente.estado}
          data-esmaecido={esmaecido}
          title={balao}
        >
          {balao}
        </span>
      )}
    </>
  )
}
