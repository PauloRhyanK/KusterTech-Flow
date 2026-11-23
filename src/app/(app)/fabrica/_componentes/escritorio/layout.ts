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
  planejamento: { x: 272, y: 76, w: 255, h: 190, rotulo: 'Planejamento', cor: 'area-planejamento' },
  desenho: { x: 539, y: 76, w: 275, h: 190, rotulo: 'Desenho', cor: 'area-desenho' },
  copa: { x: 826, y: 76, w: 80, h: 190, rotulo: 'Copa', cor: 'area-copa' },
  desenvolvimento: {
    x: 110,
    y: 372,
    w: 460,
    h: 280,
    rotulo: 'Desenvolvimento',
    cor: 'area-desenvolvimento',
  },
  teste: { x: 585, y: 372, w: 282, h: 280, rotulo: 'Teste e revisão', cor: 'area-teste' },
  // acima da doca de entrega e à esquerda da esteira vertical
  publicacao: { x: 880, y: 372, w: 95, h: 180, rotulo: 'Publicação', cor: 'area-publicacao' },
}
export const GESTAO: Retangulo = { x: 918, y: 76, w: 160, h: 190 }
export const FILA: Retangulo = { x: 10, y: 372, w: 92, h: 250 }
export const ENTRADA: Retangulo = { x: 10, y: 282, w: 90, h: 80 }
export const ENTREGA: Retangulo = { x: 950, y: 560, w: 130, h: 100 }

/** Onde fica quem chama o Paulo: na porta da sala de gestão. */
export const PORTA_DA_GESTAO: Ponto = { x: GESTAO.x + 54, y: GESTAO.y + GESTAO.h - 16 }
/** Por onde o conserto entra: fora do palco, à esquerda, na altura do corredor. */
export const ENTRADA_DO_CONSERTO: Ponto = { x: -40, y: 320 }

type Par = readonly [number, number]

interface LayoutDaArea {
  /** centro de cada mesa (64×48), relativo à área, na ordem em que os agentes ocupam */
  mesas: Par[]
  /** onde fica o personagem livre de cada papel (o canto vem da pose do hobby), relativo à área: [vaga 0, vaga 1] */
  cantos: Record<string, readonly [Par, Par]>
}

// Mesas a 66 px uma da outra; no Desenvolvimento, duas fileiras a 100 px (quem fica de pé na frente de uma
// mesa da 1ª fileira fica a 48 px de quem senta na 2ª). Os cantos ficam fora da grade: numa faixa embaixo
// (y ≥ 48 px abaixo de quem fica de pé) ou, no Desenvolvimento, também numa coluna à direita das mesas.
// layout.spec.ts confere, para o pior caso de cada área, que os pontos de personagem (sentado, de pé, no
// canto) ficam a 48 px uns dos outros e que mesas e cantos não se sobrepõem nem saem da área.
// Capacidade sem sobreposição: triagem 2, planejamento 2, desenho 3, desenvolvimento 8, teste 4 agentes.
const MESAS_EM_FILA = (n: number, y: number): Par[] =>
  Array.from({ length: n }, (_, i) => [34 + 66 * i, y] as const)

const LAYOUT: Record<Area, LayoutDaArea> = {
  triagem: {
    mesas: MESAS_EM_FILA(2, 40),
    cantos: {
      produto: [
        [24, 150],
        [82, 150],
      ],
    },
  },
  planejamento: {
    mesas: MESAS_EM_FILA(2, 40),
    cantos: {
      orquestrador: [
        [24, 150],
        [140, 150],
      ],
    },
  },
  desenho: {
    mesas: MESAS_EM_FILA(3, 40),
    // a vaga 1 dos dois papéis é a mesma: só coincide com 4 pessoas no desenho (acima da capacidade)
    cantos: {
      'ux-ui': [
        [44, 150],
        [122, 150],
      ],
      'ux-engineer': [
        [200, 150],
        [122, 150],
      ],
    },
  },
  copa: { mesas: MESAS_EM_FILA(1, 40), cantos: {} },
  desenvolvimento: {
    mesas: [...MESAS_EM_FILA(4, 40), ...MESAS_EM_FILA(4, 140)],
    cantos: {
      frontend: [
        [100, 247],
        [284, 247],
      ],
      backend: [
        [308, 47],
        [384, 247],
      ],
      devops: [
        [382, 40],
        [382, 150],
      ],
      seguranca: [
        [308, 96],
        [308, 150],
      ],
      arquiteto: [
        [382, 96],
        [308, 199],
      ],
    },
  },
  teste: {
    mesas: MESAS_EM_FILA(4, 40),
    cantos: {
      revisor: [
        [40, 150],
        [40, 240],
      ],
      qa: [
        [170, 150],
        [170, 240],
      ],
    },
  },
  publicacao: { mesas: MESAS_EM_FILA(1, 40), cantos: {} },
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
    // acima da capacidade, a mesa repete a da grade deslocada meia mesa, para as duas ficarem visíveis
    const volta = Math.floor(i / layout.mesas.length)
    const mesa = soma(naArea(a.area, layout.mesas[i % layout.mesas.length]!), {
      x: volta * 33,
      y: 0,
    })

    const hobby = hobbyDoPapel(a.papel)
    const vagas =
      hobby && a.papel !== null && Object.hasOwn(layout.cantos, a.papel)
        ? layout.cantos[a.papel]!
        : null
    const pessoa = vagas
      ? soma(naArea(a.area, vagas[a.variacao % 2]!), {
          x: Math.floor(a.variacao / 2) * DESLOCAMENTO_DA_VAGA,
          y: 0,
        })
      : null
    const canto =
      pessoa && hobby
        ? { x: pessoa.x - POSE_DO_HOBBY[hobby].x, y: pessoa.y - POSE_DO_HOBBY[hobby].y }
        : null
    lugares.set(a.id, { mesa, canto })
  }
  return lugares
}

/** Onde o conserto trabalha: na cadeira da mesa da raia (quem falhou fica de pé na frente dela). */
export function pontoDoConserto(mesa: Ponto): Ponto {
  return soma(mesa, SENTADO)
}
