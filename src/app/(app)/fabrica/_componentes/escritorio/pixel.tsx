// Pixel art do escritório da Fábrica. Arte própria, portada do rascunho aprovado
// (docs/superpowers/specs/assets/2026-11-21-escritorio-da-fabrica-rascunho.html). Cada letra da matriz aponta
// para uma variável --pixel-* de globals.css; nenhuma cor fixa aqui.
import type { ReactElement } from 'react'
import { s } from './classes'

type Paleta = Record<string, string>

const v = (nome: string) => `var(--pixel-${nome})`

/** Desenha uma matriz de letras como pixels (um <rect> por pixel colorido), nítida em qualquer escala. */
export function Sprite({
  mapa,
  paleta,
  escala,
  ...resto
}: { mapa: string[]; paleta: Paleta; escala: number; className?: string } & Record<
  `data-${string}`,
  string
>) {
  const largura = Math.max(...mapa.map((l) => l.length))
  const pixels: ReactElement[] = []
  mapa.forEach((linha, y) => {
    ;[...linha].forEach((letra, x) => {
      const cor = paleta[letra]
      if (cor)
        pixels.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={cor} />)
    })
  })
  return (
    <svg
      width={largura * escala}
      height={mapa.length * escala}
      viewBox={`0 0 ${largura} ${mapa.length}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...resto}
    >
      {pixels}
    </svg>
  )
}

// ---------------------------------------------------------------- bonecos

export type Acessorio =
  | 'fone'
  | 'gorro'
  | 'gorroEscuro'
  | 'oculos'
  | 'prancheta'
  | 'boina'
  | 'lupa'
  | 'capacete'
  | 'bone'
  | 'nenhum'

const ROUPA: Record<string, { cor: string; acessorio: Acessorio }> = {
  frontend: { cor: 'frontend', acessorio: 'fone' },
  backend: { cor: 'backend', acessorio: 'gorro' },
  revisor: { cor: 'revisor', acessorio: 'oculos' },
  orquestrador: { cor: 'planejador', acessorio: 'prancheta' },
  'ux-ui': { cor: 'desenho', acessorio: 'boina' },
  'ux-engineer': { cor: 'desenho', acessorio: 'boina' },
  produto: { cor: 'triagem', acessorio: 'lupa' },
  qa: { cor: 'teste', acessorio: 'bone' },
  fixer: { cor: 'conserto', acessorio: 'capacete' },
  arquiteto: { cor: 'arquiteto', acessorio: 'oculos' },
  devops: { cor: 'devops', acessorio: 'capacete' },
  seguranca: { cor: 'seguranca', acessorio: 'gorroEscuro' },
}

/** Cabelo (índice base) e pele fixos por papel; a variação só gira o cabelo. */
const APARENCIA: Record<string, { cabelo: number; pele: number }> = {
  orquestrador: { cabelo: 3, pele: 1 },
  'ux-ui': { cabelo: 4, pele: 0 },
  'ux-engineer': { cabelo: 4, pele: 0 },
  frontend: { cabelo: 1, pele: 1 },
  backend: { cabelo: 3, pele: 3 },
  revisor: { cabelo: 0, pele: 0 },
  qa: { cabelo: 4, pele: 3 },
  fixer: { cabelo: 1, pele: 2 },
  produto: { cabelo: 2, pele: 0 },
  arquiteto: { cabelo: 0, pele: 2 },
  devops: { cabelo: 2, pele: 1 },
  seguranca: { cabelo: 1, pele: 0 },
}

export function roupaDoPapel(papel: string | null) {
  return (papel && ROUPA[papel]) || { cor: 'triagem', acessorio: 'nenhum' as Acessorio }
}

const CORPO = [
  '.....oooooo.....',
  '...oohhhhhHoo...',
  '..ohhhhhhhhhHo..',
  '..ohhhhhhhhhho..',
  '..ohhsssssshho..',
  '..ossEssssEsso..',
  '..osrssssssrso..',
  '..ossssmmsssso..',
  '...osssssssso...',
  '....ooossooo....',
  '..oooccwwccooo..',
  '.occcccwwccccco.',
  'occcccccccccccco',
  'oscCccccccccCcso',
  'oscCccccccccCcso',
  'ossccccccccccsso',
  '.ooccccccccccoo.',
  '...oBBBBBBBBo...',
  '...oppppppppo...',
  '...opppoopppo...',
  '...oSSo..oSSo...',
  '...oooo..oooo...',
]
/** Sobrescreve linhas da matriz conforme o acessório. */
function comAcessorio(acessorio: Acessorio): string[] {
  const m = [...CORPO]
  const set = (i: number, l: string) => {
    m[i] = l
  }
  if (acessorio === 'gorro' || acessorio === 'gorroEscuro') {
    const g = ['.....oooooo.....', '...oocccccccoo..', '..occcccccccccco', '..oCCCCCCCCCCo..']
    const escuro = acessorio === 'gorroEscuro'
    g.forEach((l, i) => set(i, escuro ? l.replace(/c/g, 'C') : l))
  }
  if (acessorio === 'boina') {
    set(0, '....ooooooo.....')
    set(1, '..oocccccccco...')
    set(2, '.occcccccccccco.')
    set(3, '..oCCCCCCCCCo...')
  }
  if (acessorio === 'capacete') {
    set(0, '....oooooooo....')
    set(1, '...oyyyyyyyyo...')
    set(2, '..oyyYyyyyyyyo..')
    set(3, '.ooooooooooooooo')
  }
  if (acessorio === 'bone') {
    set(0, '....oooooooo....')
    set(1, '...occcccccco...')
    set(2, '..occcccccccco..')
    set(3, '..oooooooooooooo')
  }
  if (acessorio === 'fone') {
    set(1, '...oFhhhhhHFo...')
    set(2, '..oFhhhhhhhhFo..')
    set(4, '.FFhhsssssshhFF.')
    set(5, '.FFssEssssEssFF.')
    set(6, '..osrssssssrso..')
  }
  if (acessorio === 'oculos') set(5, '..oggggssggggo..')
  if (acessorio === 'prancheta') {
    set(13, 'oscCccccccccCkko')
    set(14, 'oscCccccccccCkWk')
    set(15, 'ossccccccccccskk')
  }
  if (acessorio === 'lupa') {
    set(13, 'oscCccccccccCsLl')
    set(14, 'oscCccccccccCsoL')
  }
  return m
}

/** Boneco de frente (16x22). O papel fixa camisa, acessório, pele e cabelo base; a variação gira o cabelo. */
export function Boneco({
  papel,
  variacao = 0,
  escala = 4,
}: {
  papel: string | null
  variacao?: number
  escala?: number
}) {
  const { cor, acessorio } = roupaDoPapel(papel)
  const ap = (papel && APARENCIA[papel]) || { cabelo: 0, pele: 0 }
  return (
    <Sprite
      mapa={comAcessorio(acessorio)}
      escala={escala}
      data-acessorio={acessorio}
      paleta={{
        o: v('contorno'),
        h: v(`cabelo-${(ap.cabelo + variacao) % 5}`),
        H: v('cabelo-brilho'),
        s: v(`pele-${ap.pele}`),
        E: v('olho'),
        r: v('bochecha'),
        m: v('boca'),
        c: v(`papel-${cor}`),
        C: v(`papel-${cor}-sombra`),
        w: v('gola'),
        B: v('madeira-escura'),
        p: v('calca'),
        S: v('sapato'),
        F: v('metal'),
        y: v('ouro'),
        Y: v('ouro-claro'),
        g: v('contorno'),
        k: v('cortica'),
        W: v('papel'),
        l: v('vidro'),
        L: v('moldura'),
      }}
    />
  )
}

// ---------------------------------------------------------------- móveis

const MESA = [
  '..oooooooo......',
  '..oTTTTTTo......',
  '..oTTTTTTo......',
  '..oTTTTTTo......',
  '..oTTTTTTo......',
  '..oooooooo......',
  '.....oo....owwo.',
  '.oKKKKKKo..owwo.',
  'oooooooooooooooo',
  'obbbbbbbbbbbbbbo',
  'obbbbbbboBBBBBbo',
  'oooooooooooooooo',
]

/** Mesa com monitor, teclado, caneca e gaveta. O CSS anima as linhas de código e o vapor só quando acesa. */
export function Mesa({ estado }: { estado: 'apagada' | 'acesa' | 'falha' }) {
  const tela =
    estado === 'acesa' ? 'tela-acesa' : estado === 'falha' ? 'tela-falha' : 'tela-apagada'
  const paleta: Paleta = {
    o: v('madeira-escura'),
    b: v('madeira'),
    B: v('madeira-sombra'),
    K: v('metal'),
    w: v('creme'),
    T: v(tela),
  }
  const pixels: ReactElement[] = []
  MESA.forEach((linha, y) => {
    ;[...linha].forEach((letra, x) => {
      const cor = paleta[letra]
      if (cor)
        pixels.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={cor} />)
    })
  })
  return (
    <svg
      width={16 * 4}
      height={MESA.length * 4}
      viewBox={`0 0 16 ${MESA.length}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={s.mesa}
      data-estado={estado}
    >
      {pixels}
      <rect
        className={s.telaLinha}
        data-linha="1"
        x={3}
        y={1}
        width={4}
        height={1}
        fill={v('tela-codigo-1')}
      />
      <rect
        className={s.telaLinha}
        data-linha="2"
        x={4}
        y={2}
        width={3}
        height={1}
        fill={v('tela-codigo-2')}
      />
      <rect
        className={s.telaLinha}
        data-linha="3"
        x={3}
        y={3}
        width={5}
        height={1}
        fill={v('tela-codigo-3')}
      />
      {estado === 'falha' && (
        <>
          <rect x={5} y={1} width={2} height={2} fill={v('branco')} />
          <rect x={5} y={4} width={2} height={1} fill={v('branco')} />
        </>
      )}
      <rect className={s.vapor} x={12} y={4} width={1} height={2} fill={v('branco')} />
    </svg>
  )
}

/** Cadeira reta (de frente para a mesa). Vazia, só recua para trás (CSS), sem girar. */
export function Cadeira({ vazia }: { vazia: boolean }) {
  return (
    <Sprite
      escala={4}
      className={s.cadeira}
      data-vazia={String(vazia)}
      mapa={['.oooooooo.', 'osssssssso', 'osSSSSSSso', 'osSSSSSSso', '.oooooooo.', '...o..o...']}
      paleta={{ o: v('contorno'), s: v('servidor'), S: v('cinza') }}
    />
  )
}

export function Caixa({ cor, entregue }: { cor: number; entregue: boolean }) {
  return (
    <Sprite
      escala={4}
      mapa={[
        'oooooooooo',
        'oCCCCCCCCo',
        'occcwwccco',
        'oCCCwwCCCo',
        'occcccccco',
        'occcccccco',
        'oooooooooo',
      ]}
      paleta={{
        o: v('madeira-escura'),
        c: v(`raia-${cor % 8}`),
        C: v('madeira-sombra'),
        w: v(entregue ? 'branco' : 'fita'),
      }}
    />
  )
}

// ---------------------------------------------------------------- objetos do cenário

const OBJ: Record<string, { mapa: string[]; paleta: Paleta; escala: number }> = {
  janela: {
    escala: 5,
    mapa: [
      'oooooooooooooooo',
      'oLLLLLLooLLLLLLo',
      'oLwLLLLooLLLLwLo',
      'oLLLLLLooLLLLLLo',
      'oooooooooooooooo',
    ],
    paleta: { o: v('moldura'), L: v('vidro'), w: v('branco') },
  },
  relogio: {
    escala: 5,
    mapa: ['.oooo.', 'owwwwo', 'owwowo', 'owoowo', 'owwwwo', '.oooo.'],
    paleta: { o: v('contorno'), w: v('branco') },
  },
  planta: {
    escala: 4,
    mapa: [
      '..gg.gg..',
      '.gGggGgg.',
      'gGgGgggGg',
      '.ggGgggg.',
      '..ggGgg..',
      '..ooooo..',
      '..oTTTo..',
      '...ooo...',
    ],
    paleta: { g: v('folha'), G: v('folha-escura'), o: v('terra'), T: v('vaso') },
  },
  plantona: {
    escala: 4,
    mapa: [
      '...g.gg...',
      '..gGggGg..',
      '.gGgGgggg.',
      'gggGggGggg',
      '.gGgggGgg.',
      '..gggGgg..',
      '...oooo...',
      '..oTTTTo..',
      '..oTTTTo..',
      '...oooo...',
    ],
    paleta: { g: v('folha'), G: v('folha-escura'), o: v('terra'), T: v('vaso') },
  },
  sofa: {
    escala: 5,
    mapa: [
      'oooooooooooooo',
      'osssssssssssso',
      'osSSSSSSSSSSso',
      'osSSSSSSSSSSso',
      'osssssssssssso',
      'oooooooooooooo',
    ],
    paleta: { o: v('contorno'), s: v('sofa'), S: v('sofa-claro') },
  },
  gato: {
    escala: 3,
    mapa: ['.o...o...', 'oco.oco..', 'occcccco.', 'ocwccwco.', 'occcccccoo', '.oooooo.o'],
    paleta: { o: v('contorno'), c: v('gato'), w: v('contorno') },
  },
  cafe: {
    escala: 5,
    mapa: ['oooooo', 'oRRRRo', 'oRwwRo', 'oRRRRo', 'oKKKKo', 'oooooo'],
    paleta: { o: v('contorno'), R: v('vermelho'), w: v('creme'), K: v('moldura') },
  },
  bebedouro: {
    escala: 5,
    mapa: ['.ooo.', 'olllo', 'olwlo', 'ooooo', 'ossso', 'ossso', 'ooooo'],
    paleta: { o: v('contorno'), l: v('vidro'), w: v('branco'), s: v('metal') },
  },
  quadro: {
    escala: 5,
    mapa: [
      'oooooooooooooooooo',
      'owwwwwwwwwwwwwwwwo',
      'owbbwwwrrwwwwgwwwo',
      'owwbbbbbbbwwgggwwo',
      'owwwwwwwwwwwwwwwwo',
      'oooooooooooooooooo',
    ],
    paleta: { o: v('cinza'), w: v('branco'), b: v('azul'), r: v('vermelho'), g: v('folha') },
  },
  cortica: {
    escala: 5,
    mapa: ['oooooooooooo', 'okyykppkkggo', 'okyykppkkggo', 'okkbbkkyykko', 'oooooooooooo'],
    paleta: {
      o: v('moldura'),
      k: v('cortica'),
      y: v('amarelo'),
      p: v('rosa'),
      g: v('verde-claro'),
      b: v('vidro'),
    },
  },
  cavalete: {
    escala: 5,
    mapa: ['oooooooo', 'owwppwyo', 'owbbppyo', 'owbbwwwo', 'oooooooo', '.o....o.'],
    paleta: {
      o: v('moldura'),
      w: v('tela-pintura'),
      p: v('rosa-forte'),
      b: v('azul-claro'),
      y: v('ouro'),
    },
  },
  paleta: {
    escala: 4,
    mapa: ['.oooo.', 'orybwo', 'owwwwo', '.oooo.'],
    paleta: {
      o: v('moldura'),
      r: v('led-vermelho'),
      y: v('ouro'),
      b: v('azul-claro'),
      w: v('fita'),
    },
  },
  rack: {
    escala: 6,
    mapa: ['oooooo', 'osgsro', 'oooooo', 'osgsgo', 'oooooo', 'osgsso', 'oooooo'],
    paleta: { o: v('contorno'), s: v('servidor'), g: v('led-verde'), r: v('led-vermelho') },
  },
  foguete: {
    escala: 5,
    mapa: ['...o...', '..owo..', '.owbwo.', '.owwwo.', 'oowwwoo', '..yry..'],
    paleta: { o: v('contorno'), w: v('papel'), b: v('azul-claro'), y: v('ouro'), r: v('chama') },
  },
  telao: {
    escala: 5,
    mapa: [
      'oooooooooooooo',
      'oGGGGGGGGGGGGo',
      'oGwGGGGGGGwGGo',
      'oGGwGGGGGwGGGo',
      'oGGGwwwwwGGGGo',
      'oooooooooooooo',
    ],
    paleta: { o: v('contorno'), G: v('tela-verde'), w: v('branco') },
  },
  mesaRedonda: {
    escala: 5,
    mapa: [
      '...oooooo...',
      '..obbbbbbo..',
      '.obbbbbbbbo.',
      'obbbbbbbbbbo',
      'obbbbbbbbbbo',
      '.obbbbbbbbo.',
      '..obbbbbbo..',
      '...oooooo...',
    ],
    paleta: { o: v('madeira-escura'), b: v('mesa-redonda') },
  },
  estante: {
    escala: 5,
    mapa: [
      'oooooooooooooo',
      'oRRBByyGGRRBBo',
      'oooooooooooooo',
      'oGGyyRRBBGGyyo',
      'oooooooooooooo',
    ],
    paleta: {
      o: v('moldura'),
      R: v('vermelho'),
      B: v('azul'),
      y: v('livro-amarelo'),
      G: v('folha'),
    },
  },
  impressora: {
    escala: 5,
    mapa: ['oooooooo', 'owwwwwwo', 'oggggggo', 'oggggrgo', 'oooooooo'],
    paleta: { o: v('contorno'), w: v('branco'), g: v('impressora'), r: v('led-vermelho') },
  },
  lixo: {
    escala: 5,
    mapa: ['oooo', 'oggo', 'oggo', 'oooo'],
    paleta: { o: v('contorno'), g: v('lixo') },
  },
  palete: {
    escala: 5,
    mapa: ['oooooooooooooo', 'obbbbbbbbbbbbo', 'oooooooooooooo', 'oboobooboobobo'],
    paleta: { o: v('terra'), b: v('madeira') },
  },
  painel: {
    escala: 5,
    mapa: [
      'oooooooooooooooooooooooooooooooo',
      'owwwwwwwwwwwwwwwwwwwwwwwwwwwwwwo',
      'owwwwwwwwwwwwwwwwwwwwwwwwwwwwggo',
      'owwwwwwwwwwwwwwwwwwwwwwwwwwwggwo',
      'owwwwwwwwbbwwwwwwwwwwwwwwwwggwwo',
      'owwwwwwwbbwwwwwwwwwwwwwwwwggwwwo',
      'owwwwbbbbwwwwwwwyywwwwwwwggwwwwo',
      'owwbbbwwwwwwwwyyyywwwwwwggwwwwwo',
      'owwwwwwwwwwwwyyyyyywwwwggwwwwwwo',
      'owrrwyywwbbwwwwwwwwwwwggwwwwwwwo',
      'owrrwyywwbbwwggwwwwwwggwwwwwwwwo',
      'owrrwyywwbbwwggwwwwwggwwwwwwwwwo',
      'owwwwwwwwwwwwwwwwwwwwwwwwwwwwwwo',
      'oooooooooooooooooooooooooooooooo',
      '..............oooo..............',
      '............oooooooo............',
    ],
    paleta: {
      o: v('contorno'),
      w: v('papel'),
      b: v('papel-frontend'),
      g: v('tela-verde'),
      y: v('livro-amarelo'),
      r: v('papel-conserto'),
    },
  },
}

export const OBJETOS = Object.keys(OBJ)

export function Objeto({ nome }: { nome: string }) {
  const o = OBJ[nome]
  if (!o) return null
  return <Sprite mapa={o.mapa} paleta={o.paleta} escala={o.escala} />
}
