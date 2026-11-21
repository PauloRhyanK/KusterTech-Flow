// Pixel art do escritório da Fábrica. Arte própria, portada do rascunho aprovado
// (docs/superpowers/specs/assets/2026-11-21-escritorio-da-fabrica-rascunho.html). Cada letra da matriz aponta
// para uma variável --pixel-* de globals.css; nenhuma cor fixa aqui.
import type { ReactElement } from 'react'

type Paleta = Record<string, string>

const v = (nome: string) => `var(--pixel-${nome})`

/** Desenha uma matriz de letras como pixels (um <rect> por pixel colorido), nítida em qualquer escala. */
export function Sprite({
  mapa,
  paleta,
  escala,
  ...resto
}: { mapa: string[]; paleta: Paleta; escala: number } & Record<`data-${string}`, string>) {
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
  'fone' | 'gorro' | 'oculos' | 'prancheta' | 'boina' | 'lupa' | 'capacete' | 'nenhum'

const ROUPA: Record<string, { cor: string; acessorio: Acessorio }> = {
  frontend: { cor: 'frontend', acessorio: 'fone' },
  backend: { cor: 'backend', acessorio: 'gorro' },
  revisor: { cor: 'revisor', acessorio: 'oculos' },
  orquestrador: { cor: 'planejador', acessorio: 'prancheta' },
  'ux-ui': { cor: 'desenho', acessorio: 'boina' },
  'ux-engineer': { cor: 'desenho', acessorio: 'boina' },
  produto: { cor: 'triagem', acessorio: 'lupa' },
  qa: { cor: 'teste', acessorio: 'fone' },
  fixer: { cor: 'conserto', acessorio: 'capacete' },
}

export function roupaDoPapel(papel: string | null) {
  return (papel && ROUPA[papel]) || { cor: 'triagem', acessorio: 'nenhum' as Acessorio }
}

function numeroDaSemente(semente: string): number {
  let h = 0
  for (const c of semente) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

/** Boneco visto de cima (14x14). A semente (o runId) fixa cabelo e pele; o papel dá a camisa e o acessório. */
export function Boneco({
  papel,
  semente,
  escala = 4,
}: {
  papel: string | null
  semente: string
  escala?: number
}) {
  const { cor, acessorio } = roupaDoPapel(papel)
  const n = numeroDaSemente(semente)
  const m = [
    '.....oooo.....',
    '....ohhhho....',
    '...ohhHhhho...',
    '...ohhhhhHo...',
    '...ohhhhhho...',
    '....osssso....',
    '..oooccccooo..',
    '.occcccccccco.',
    '.oCccccccccCo.',
    'osccccccccccso',
    'osCccccccccCso',
    '.oo.cccccc.oo.',
    '....oooooo....',
  ]
  if (acessorio === 'gorro')
    Object.assign(m, { 1: '....occcco....', 2: '...occcccco...', 3: '...oCCCCCCo...' })
  if (acessorio === 'boina')
    Object.assign(m, { 0: '....ooooo.....', 1: '...occcccco...', 2: '..occcccccco..' })
  if (acessorio === 'capacete')
    Object.assign(m, { 1: '....oyyyyo....', 2: '...oyyyyyyo...', 3: '...oyYyyyyo...' })
  if (acessorio === 'fone') Object.assign(m, { 3: '..FohhhhhHoF..', 4: '..FohhhhhhoF..' })
  if (acessorio === 'oculos') Object.assign(m, { 5: '...ogsssgo....' })
  if (acessorio === 'prancheta')
    Object.assign(m, { 9: 'osccccccccccsk', 10: 'osCccccccccCsk', 11: '.oo.cccccc.okk' })
  if (acessorio === 'lupa') Object.assign(m, { 10: 'osCcccccccccLl', 11: '.oo.cccccc.oLL' })
  return (
    <Sprite
      mapa={m}
      escala={escala}
      data-acessorio={acessorio}
      paleta={{
        o: v('contorno'),
        h: v(`cabelo-${n % 5}`),
        H: v('cabelo-brilho'),
        s: v(`pele-${(n >> 3) % 4}`),
        c: v(`papel-${cor}`),
        C: v(`papel-${cor}-sombra`),
        F: v('metal'),
        y: v('ouro'),
        Y: v('ouro-claro'),
        g: v('contorno'),
        k: v('cortica'),
        l: v('vidro'),
        L: v('moldura'),
      }}
    />
  )
}

// ---------------------------------------------------------------- móveis

export function Mesa({ acesa, cor }: { acesa: boolean; cor: number | null }) {
  return (
    <Sprite
      escala={4}
      mapa={[
        'oooooooooooooooo',
        'obbbbbbbbbbbbbbo',
        'obboooooooobbbbo',
        'obboFFFFFFobxxbo',
        'obboFllllFobxxbo',
        'obboFllllFobbbbo',
        'obboooooooobmbbo',
        'obbbbbbbbbbbbbbo',
        'oBBBBBBBBBBBBBBo',
        'oooooooooooooooo',
      ]}
      paleta={{
        o: v('madeira-escura'),
        b: v('madeira'),
        B: v('madeira-sombra'),
        F: v('metal'),
        l: v(acesa ? 'tela-acesa' : 'tela-apagada'),
        x: cor === null ? v('madeira') : v(`raia-${cor % 8}`),
        m: v('papel'),
      }}
    />
  )
}

export function Cadeira() {
  return (
    <Sprite
      escala={4}
      mapa={['.oooooo.', 'occcccco', 'occcccco', '.oooooo.', '...oo...']}
      paleta={{ o: v('contorno'), c: v('servidor') }}
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
