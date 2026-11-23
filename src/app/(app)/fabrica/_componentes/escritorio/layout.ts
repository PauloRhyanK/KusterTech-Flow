// Layout do andar do escritório (palco fixo de 1100×680): onde ficam as áreas, as mesas e os cantos de hobby.
// Puro: só geometria. As mesas de uma área formam uma grade, ocupada na ordem dos agentes; os cantos são
// por papel, com 2 vagas (variacao % 2); da variação 2 em diante, a vaga se repete deslocada 52 px.
import type { Agente, Area } from '@/modules/fabrica/escritorio/model'
import { type Hobby, hobbyDoPapel } from './hobbies'

export interface Ponto {
  x: number
  y: number
}

export interface Retangulo {
  x: number
  y: number
  w: number
  h: number
}

export const LARGURA = 1100
export const ALTURA = 680

export const AREAS: Record<Area, Retangulo & { rotulo: string; cor: string }> = {
  triagem: { x: 110, y: 76, w: 150, h: 190, rotulo: 'Triagem', cor: 'area-triagem' },
  planejamento: { x: 275, y: 76, w: 170, h: 190, rotulo: 'Planejamento', cor: 'area-planejamento' },
  desenho: { x: 460, y: 76, w: 230, h: 190, rotulo: 'Desenho', cor: 'area-desenho' },
  copa: { x: 705, y: 76, w: 85, h: 190, rotulo: 'Copa', cor: 'area-copa' },
  desenvolvimento: {
    x: 110,
    y: 372,
    w: 460,
    h: 280,
    rotulo: 'Desenvolvimento',
    cor: 'area-desenvolvimento',
  },
  teste: { x: 585, y: 372, w: 220, h: 280, rotulo: 'Teste e revisão', cor: 'area-teste' },
  publicacao: { x: 820, y: 372, w: 110, h: 280, rotulo: 'Publicação', cor: 'area-publicacao' },
}
export const GESTAO: Retangulo = { x: 805, y: 76, w: 195, h: 190 }
export const FILA: Retangulo = { x: 10, y: 372, w: 92, h: 250 }
export const ENTRADA: Retangulo = { x: 10, y: 282, w: 90, h: 80 }
export const ENTREGA: Retangulo = { x: 950, y: 560, w: 130, h: 100 }

/** Onde fica quem chama o Paulo: na porta da sala de gestão, do lado de fora. */
export const PORTA_DA_GESTAO: Ponto = { x: GESTAO.x + 54, y: GESTAO.y + GESTAO.h - 16 }
/** Por onde o conserto entra: fora do palco, à esquerda, na altura do corredor. */
export const ENTRADA_DO_CONSERTO: Ponto = { x: -40, y: 320 }

type Par = readonly [number, number]

interface LayoutDaArea {
  /** centro de cada mesa (64×48), relativo à área, na ordem em que os agentes ocupam */
  mesas: Par[]
  /** centro do canto de cada papel, relativo à área: [vaga 0, vaga 1] */
  cantos: Record<string, readonly [Par, Par]>
}

// As coordenadas deixam espaço para o personagem sentado (que passa 50 px à direita do centro da mesa),
// para quem está de pé na frente da mesa e para o trajeto de cada hobby (POSE_DO_HOBBY e globals.css).
const LAYOUT: Record<Area, LayoutDaArea> = {
  triagem: {
    mesas: [
      [45, 62],
      [115, 140],
    ],
    cantos: {
      produto: [
        [100, 150],
        [118, 104],
      ],
    },
  },
  planejamento: {
    mesas: [
      [45, 62],
      [125, 140],
    ],
    cantos: {
      orquestrador: [
        [86, 160],
        [86, 112],
      ],
    },
  },
  desenho: {
    mesas: [
      [45, 62],
      [150, 62],
    ],
    cantos: {
      'ux-ui': [
        [84, 152],
        [84, 104],
      ],
      'ux-engineer': [
        [190, 152],
        [190, 104],
      ],
    },
  },
  copa: { mesas: [[42, 62]], cantos: {} },
  desenvolvimento: {
    mesas: [
      [50, 62],
      [160, 62],
      [270, 62],
      [380, 62],
      [50, 158],
      [160, 158],
      [270, 158],
      [380, 158],
    ],
    cantos: {
      frontend: [
        [47, 241],
        [199, 241],
      ],
      backend: [
        [335, 235],
        [325, 160],
      ],
      devops: [
        [428, 241],
        [432, 160],
      ],
      arquiteto: [
        [105, 160],
        [160, 110],
      ],
      seguranca: [
        [215, 160],
        [270, 110],
      ],
    },
  },
  teste: {
    mesas: [
      [50, 62],
      [155, 62],
      [50, 158],
      [155, 158],
    ],
    cantos: {
      revisor: [
        [40, 236],
        [95, 150],
      ],
      qa: [
        [140, 230],
        [150, 150],
      ],
    },
  },
  publicacao: {
    mesas: [
      [55, 62],
      [55, 158],
    ],
    cantos: {},
  },
}

/** Deslocamento da vaga repetida (variação 2 em diante). */
const DESLOCAMENTO_DA_VAGA = 52

/** Centro do personagem livre em relação ao centro do canto do hobby. */
export const POSE_DO_HOBBY: Record<Hobby, Ponto> = {
  xadrez: { x: -45, y: -10 },
  pintar: { x: -34, y: 5 },
  musica: { x: 41, y: -7 },
  cafe: { x: -37, y: 3 },
  plantas: { x: -30, y: -11 },
  cubo: { x: -28, y: -12 },
  blocos: { x: -36, y: -12 },
  palavrasCruzadas: { x: -44, y: -16 },
  fliperama: { x: 45, y: 6 },
  leitura: { x: 0, y: -8 },
}

/** Centro do personagem sentado atrás da mesa (à direita do monitor). */
export const SENTADO: Ponto = { x: 26, y: -1 }
/** Centro do personagem de pé na frente da mesa (falha, ou livre sem hobby). */
export const DE_PE: Ponto = { x: 0, y: 58 }
/** Canto superior esquerdo da cadeira (40×24), atrás de quem senta. */
export const CADEIRA: Ponto = { x: SENTADO.x - 20, y: -32 }
/** Centro da caixa de uma parte em execução: no chão, ao lado da mesa. */
export const CAIXA_NA_MESA: Ponto = { x: 44, y: 50 }

export const soma = (a: Ponto, b: Ponto): Ponto => ({ x: a.x + b.x, y: a.y + b.y })

function naArea(area: Area, [x, y]: Par): Ponto {
  const r = AREAS[area]
  return { x: r.x + x, y: r.y + y }
}

/** Mesa e canto de cada agente do andar. O conserto não tem nenhum dos dois: ele usa a mesa da raia. */
export function lugaresDoAndar(
  agentes: Pick<Agente, 'id' | 'papel' | 'area' | 'variacao'>[],
): Map<string, { mesa: Ponto | null; canto: Ponto | null }> {
  const lugares = new Map<string, { mesa: Ponto | null; canto: Ponto | null }>()
  const ocupadas = new Map<Area, number>()
  for (const a of agentes) {
    if (a.papel === 'fixer') {
      lugares.set(a.id, { mesa: null, canto: null })
      continue
    }
    const layout = LAYOUT[a.area]
    const i = ocupadas.get(a.area) ?? 0
    ocupadas.set(a.area, i + 1)
    const volta = Math.floor(i / layout.mesas.length)
    const mesa = soma(naArea(a.area, layout.mesas[i % layout.mesas.length]!), {
      x: volta * 16,
      y: volta * 16,
    })

    const vagas =
      hobbyDoPapel(a.papel) && a.papel !== null && Object.hasOwn(layout.cantos, a.papel)
        ? layout.cantos[a.papel]!
        : null
    const canto = vagas
      ? soma(naArea(a.area, vagas[a.variacao % 2]!), {
          x: Math.floor(a.variacao / 2) * DESLOCAMENTO_DA_VAGA,
          y: 0,
        })
      : null
    lugares.set(a.id, { mesa, canto })
  }
  return lugares
}

/** Onde o conserto para: ao lado da mesa da raia, à direita se couber na área, senão à esquerda. */
export function pontoDoConserto(mesa: Ponto, area: Area): Ponto {
  const r = AREAS[area]
  const direita = mesa.x + 52
  return { x: direita + 24 <= r.x + r.w ? direita : mesa.x - 52, y: mesa.y + 10 }
}
