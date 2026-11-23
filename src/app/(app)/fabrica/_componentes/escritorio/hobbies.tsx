// Cantos de hobby do escritório da Fábrica: só os objetos de cada canto (o personagem entra na Task 5).
// Sprites portados do rascunho aprovado (docs/superpowers/specs/assets/2026-11-23-escritorio-personagens-rascunho.html);
// os que não existem lá (palavras cruzadas, blocos, plantas, cubo) seguem o mesmo estilo. Cores são tokens --pixel-*.
import type { CSSProperties, ReactNode } from 'react'
import { Sprite, v } from './pixel'

export type Hobby =
  | 'palavrasCruzadas'
  | 'xadrez'
  | 'blocos'
  | 'pintar'
  | 'musica'
  | 'cafe'
  | 'plantas'
  | 'cubo'
  | 'fliperama'
  | 'leitura'

export const HOBBY_DO_PAPEL: Record<string, Hobby> = {
  produto: 'palavrasCruzadas',
  orquestrador: 'xadrez',
  arquiteto: 'blocos',
  'ux-ui': 'pintar',
  'ux-engineer': 'pintar',
  frontend: 'musica',
  backend: 'cafe',
  devops: 'plantas',
  seguranca: 'cubo',
  qa: 'fliperama',
  revisor: 'leitura',
}

export function hobbyDoPapel(papel: string | null): Hobby | null {
  return (papel && HOBBY_DO_PAPEL[papel]) || null
}

/** Classe aplicada ao personagem (Task 5); a animação dele fica em globals.css. */
export const CLASSE_DO_HOBBY: Record<Hobby, string> = {
  palavrasCruzadas: 'esc-hobby-palavrasCruzadas',
  xadrez: 'esc-hobby-xadrez',
  blocos: 'esc-hobby-blocos',
  pintar: 'esc-hobby-pintar',
  musica: 'esc-hobby-musica',
  cafe: 'esc-hobby-cafe',
  plantas: 'esc-hobby-plantas',
  cubo: 'esc-hobby-cubo',
  fliperama: 'esc-hobby-fliperama',
  leitura: 'esc-hobby-leitura',
}

const ESCALA = 3
const O = 'contorno'

type Desenho = { mapa: string[]; cores: Record<string, string> }

const D = {
  xadrez: {
    mapa: [
      'oooooooooooooo',
      'owbwbwbwbwbwbo',
      'obwbwbwbwbwbwo',
      'owbwbwbwbwbwbo',
      'obwbwbwbwbwbwo',
      'owbwbwbwbwbwbo',
      'oooooooooooooo',
      '.oTTTTTTTTTTo.',
      '..o........o..',
      '..o........o..',
      '.oo........oo.',
    ],
    cores: { o: O, w: 'gola', b: 'tabuleiro-escuro', T: 'madeira' },
  },
  banco: {
    mapa: ['oooooo', 'oSSSSo', 'oooooo', '.o..o.', '.o..o.'],
    cores: { o: O, S: 'banco' },
  },
  cavalete: {
    mapa: [
      '...oooooooooooo...',
      '...oWWWWWWWWWWo...',
      '...oWWWWWWWWWWo...',
      '...oWWWWWWWWWWo...',
      '...oWWWWWWWWWWo...',
      '...oWWWWWWWWWWo...',
      '...oWWWWWWWWWWo...',
      '...oooooooooooo...',
      '....oL......Lo....',
      '....oL......Lo....',
      '...oL...LL...Lo...',
      '...oL...LL...Lo...',
      '..oL....LL....Lo..',
      '..oL....LL....Lo..',
      '.oo.....oo.....oo.',
    ],
    cores: { o: O, W: 'tela-pintura', L: 'cavalete' },
  },
  paleta: {
    mapa: ['.oooooo.', 'oWrWbWo.', 'oWWyWgWo', 'oWWWWooo', '.oooo...'],
    cores: { o: O, W: 'paleta', r: 'tinta-1', b: 'tinta-2', y: 'tinta-3', g: 'tinta-4' },
  },
  vitrola: {
    mapa: [
      'oooooooooooooooo',
      'oKKKKKKKKKKKKKKo',
      'oKKKKKKKKKKKKKKo',
      'oKKKKKKKKKKKKKKo',
      'oKKKKKKKKKKKKKKo',
      'oKKKKKKKKKKKSKKo',
      'oooooooooooooooo',
      'oWWWWWWWWWWWWWWo',
      'oWrrWWWWWWWWggWo',
      'oWWWWWWWWWWWWWWo',
      'oooooooooooooooo',
      '.o............o.',
    ],
    cores: { o: O, K: 'vitrola', S: 'metal', W: 'cavalete', r: 'tinta-1', g: 'tinta-4' },
  },
  caixaSom: {
    mapa: [
      'oooooo',
      'oKKKKo',
      'oKccKo',
      'oKccKo',
      'oKKKKo',
      'oKccKo',
      'oKccKo',
      'oKKKKo',
      'oooooo',
    ],
    cores: { o: O, K: 'caixa-som', c: 'caixa-som-cone' },
  },
  balcao: {
    mapa: [
      '....oooooo..........',
      '...offffffo.........',
      '...ofmmmmfo...ooo...',
      '...offffffo...oWo...',
      '...oo....oo...oWo...',
      '...o.oooo.o...ooo...',
      '...o.owwo.o.........',
      'oooooooooooooooooooo',
      'oTTTTTTTTTTTTTTTTTTo',
      'oTttttttttttttttttTo',
      'oTttttttttttttttttTo',
      'oTttttttttttttttttTo',
      'oTTTTTTTTTTTTTTTTTTo',
      'oooooooooooooooooooo',
    ],
    cores: {
      o: O,
      f: 'cafeteira',
      m: 'cafeteira-jarra',
      w: 'gola',
      W: 'gola',
      T: 'vitrola',
      t: 'balcao',
    },
  },
  fliperama: {
    mapa: [
      '.oooooooooooo.',
      '.oPPPPPPPPPPo.',
      '.oPYPYPYPYPPo.',
      '.oooooooooooo.',
      '.oSSSSSSSSSSo.',
      '.oSSSSSSSSSSo.',
      '.oSSSSSSSSSSo.',
      '.oSSSSSSSSSSo.',
      '.oSSSSSSSSSSo.',
      '.oooooooooooo.',
      'oCCCCCCCCCCCCo',
      'oCCoCCCrrCbbCo',
      'oCoooCCrrCbbCo',
      'oooooooooooooo',
      '.oCCCCCCCCCCo.',
      '.oCCCyyyyCCCo.',
      '.oCCCCCCCCCCo.',
      '.oCCCCCCCCCCo.',
      '.oooooooooooo.',
    ],
    // S (a tela) fica vazio: o <div> esc-fliper-tela cobre o buraco e pisca
    cores: {
      o: O,
      P: 'fliperama-topo',
      Y: 'ouro-claro',
      C: 'fliperama',
      r: 'tinta-1',
      b: 'tinta-2',
      y: 'tinta-3',
    },
  },
  poltronaFundo: {
    mapa: [
      '..oooooooooooooo..',
      '.oTTTTTTTTTTTTTTo.',
      '.oTttttttttttttTo.',
      '.oTttttttttttttTo.',
      '.oTttttttttttttTo.',
      '.oTttttttttttttTo.',
      '.oTttttttttttttTo.',
      '.oTttttttttttttTo.',
    ],
    cores: { o: O, T: 'poltrona', t: 'poltrona-sombra' },
  },
  poltronaFrente: {
    mapa: [
      'ooooo........ooooo',
      'oTTTo........oTTTo',
      'oTTTo........oTTTo',
      'oTTToooooooooooTTo',
      'oTTTTTTTTTTTTTTTTo',
      'oTTTTTTTTTTTTTTTTo',
      'oooooooooooooooooo',
      '.oo............oo.',
    ],
    cores: { o: O, T: 'poltrona' },
  },
  pufe: {
    mapa: ['..oooooo..', '.oPPPPPPo.', 'oPPppppPPo', 'oPPPPPPPPo', '.oPPPPPPo.', '..oooooo..'],
    cores: { o: O, P: 'sofa', p: 'sofa-claro' },
  },
  revista: {
    mapa: ['oooooooo', 'orrWWbbo', 'orrWWbbo', 'oWWWWWWo', 'oooooooo'],
    cores: { o: O, r: 'tinta-1', b: 'tinta-2', W: 'papel' },
  },
  mesinha: {
    mapa: [
      'oooooooooooo',
      'oTTTTTTTTTTo',
      'oooooooooooo',
      '.o........o.',
      '.o........o.',
      '.o........o.',
    ],
    cores: { o: O, T: 'madeira' },
  },
  blocos: {
    mapa: [
      '..oooo......',
      '..oRRo.oooo.',
      '.oooooooBBo.',
      '.oYYooGGoBBo',
      '.oYYoooooooo',
      '.oooo.......',
    ],
    cores: { o: O, R: 'tinta-1', B: 'tinta-2', Y: 'tinta-3', G: 'tinta-4' },
  },
  plantona: {
    mapa: [
      '..g..gg..g..',
      '.gGg.gGgggG.',
      'gGgGggGgGgGg',
      '.gGgGgggGgg.',
      'gGgggGgGgGgg',
      '.ggGgGggGgg.',
      '..gGgggGgg..',
      '...gggggg...',
      '..oooooooo..',
      '..oTTTTTTo..',
      '..oTttttTo..',
      '..oTttttTo..',
      '...oTTTTo...',
      '...oooooo...',
    ],
    cores: { o: O, g: 'folha', G: 'folha-escura', T: 'vaso', t: 'terra' },
  },
  regador: {
    mapa: ['..ooo....', '.oBBBo.oo', 'oBBBBBooB', 'oBbbbBBoo', 'oBBBBBo..', '.ooooo...'],
    cores: { o: O, B: 'regador', b: 'azul' },
  },
  banquinho: {
    mapa: ['oooooooo', 'oTTTTTTo', 'oooooooo', '.o....o.', '.o....o.', 'oo....oo'],
    cores: { o: O, T: 'madeira' },
  },
  cubo: {
    mapa: ['.ooooo.', 'oRRBBYo', 'oRRBBYo', 'oGGWWBo', 'oGGWWBo', '.ooooo.'],
    cores: { o: O, R: 'tinta-1', B: 'tinta-2', Y: 'tinta-3', G: 'tinta-4', W: 'papel' },
  },
  tela: {
    mapa: ['SSSSSSSSSS', 'SrSSSSSSbS', 'SSSSyySSSS', 'SSSSSSSSSS', 'SgSSSSSSSS'],
    cores: { S: 'fliperama-tela', r: 'tinta-1', b: 'tinta-2', y: 'tinta-3', g: 'tinta-4' },
  },
} satisfies Record<string, Desenho>

function desenho(nome: keyof typeof D) {
  const { mapa, cores }: Desenho = D[nome]
  const paleta = Object.fromEntries(Object.entries(cores).map(([l, t]) => [l, v(t)]))
  return <Sprite mapa={mapa} paleta={paleta} escala={ESCALA} data-objeto={nome} />
}

/** Coloca um filho em (x, y) do canto, em pixels. */
function Em({
  x,
  y,
  children,
  className,
  estilo,
  camada,
}: {
  x: number
  y: number
  children?: ReactNode
  className?: string
  estilo?: CSSProperties
  camada?: 'fundo' | 'frente'
}) {
  return (
    <div
      className={['esc-canto-peca', className].filter(Boolean).join(' ')}
      style={{ left: x, top: y, ...estilo }}
      {...(camada ? { 'data-camada': camada } : {})}
    >
      {children}
    </div>
  )
}

// Tamanho (largura, altura) de cada canto, em pixels do mapa.
const TAMANHO: Record<Hobby, [number, number]> = {
  xadrez: [108, 45],
  pintar: [78, 51],
  musica: [78, 42],
  cafe: [66, 54],
  fliperama: [42, 57],
  leitura: [54, 60],
  palavrasCruzadas: [48, 24],
  blocos: [36, 33],
  plantas: [60, 42],
  cubo: [24, 36],
}

// Largura (px) das pinceladas na tela do cavalete (30x18) e o token de cada cor.
const PINCELADAS = [
  { y: 0, w: 30, cor: 'tinta-1' },
  { y: 4, w: 22, cor: 'tinta-2' },
  { y: 8, w: 26, cor: 'tinta-3' },
  { y: 12, w: 14, cor: 'tinta-4' },
]

function Objetos({ hobby }: { hobby: Hobby }) {
  switch (hobby) {
    case 'xadrez':
      return (
        <>
          <Em x={0} y={30}>
            {desenho('banco')}
          </Em>
          <Em x={33} y={6}>
            {desenho('xadrez')}
          </Em>
          <Em x={90} y={30}>
            {desenho('banco')}
          </Em>
          <Em x={39} y={12} className="esc-peca" />
        </>
      )
    case 'pintar':
      return (
        <>
          <Em x={24} y={0}>
            {desenho('cavalete')}
          </Em>
          {/* a tela do cavalete: 10x6 pixels da arte, recortada para a tinta nunca vazar */}
          <Em x={36} y={3} className="esc-quadro-tela">
            {PINCELADAS.map((p) => (
              <i
                key={p.cor}
                className="esc-tinta"
                style={
                  {
                    top: p.y,
                    background: v(p.cor),
                    '--w': `${p.w}px`,
                    animationDelay: `${p.y / 8}s`,
                  } as CSSProperties
                }
              />
            ))}
          </Em>
          <Em x={0} y={36}>
            {desenho('paleta')}
          </Em>
        </>
      )
    case 'musica':
      return (
        <>
          <Em x={0} y={6}>
            {desenho('vitrola')}
          </Em>
          <Em x={9} y={9} className="esc-disco" />
          <Em x={54} y={12}>
            {desenho('caixaSom')}
          </Em>
          <Em x={27} y={0} className="esc-notas">
            <b />
            <b />
            <b />
          </Em>
        </>
      )
    case 'cafe':
      return (
        <>
          <Em x={0} y={12}>
            {desenho('balcao')}
          </Em>
          <Em x={15} y={3} className="esc-canto-vapor">
            <b />
            <b />
          </Em>
        </>
      )
    case 'fliperama':
      return (
        <>
          <Em x={0} y={0}>
            {desenho('fliperama')}
          </Em>
          <Em x={6} y={12} className="esc-fliper-tela">
            {desenho('tela')}
          </Em>
        </>
      )
    case 'leitura':
      return (
        <>
          <Em x={0} y={0} camada="fundo">
            {desenho('poltronaFundo')}
          </Em>
          <Em x={0} y={36} camada="frente">
            {desenho('poltronaFrente')}
          </Em>
          <Em x={15} y={33} camada="frente" className="esc-livro">
            <i className="esc-pagina" />
          </Em>
        </>
      )
    case 'palavrasCruzadas':
      return (
        <>
          <Em x={0} y={6}>
            {desenho('pufe')}
          </Em>
          <Em x={33} y={9}>
            {desenho('revista')}
          </Em>
        </>
      )
    case 'blocos':
      return (
        <>
          <Em x={0} y={15}>
            {desenho('mesinha')}
          </Em>
          <Em x={0} y={0}>
            {desenho('blocos')}
          </Em>
        </>
      )
    case 'plantas':
      return (
        <>
          <Em x={24} y={0}>
            {desenho('plantona')}
          </Em>
          <Em x={0} y={24}>
            {desenho('regador')}
          </Em>
        </>
      )
    case 'cubo':
      return (
        <>
          <Em x={0} y={18}>
            {desenho('banquinho')}
          </Em>
          <Em x={3} y={0}>
            {desenho('cubo')}
          </Em>
        </>
      )
  }
}

/** Só os objetos do canto de um hobby. Posição no mapa e personagem ficam por conta de quem usa. */
export function CantoDoHobby({ hobby }: { hobby: Hobby }) {
  const [largura, altura] = TAMANHO[hobby]
  return (
    <div data-hobby={hobby} className="esc-canto" style={{ width: largura, height: altura }}>
      <Objetos hobby={hobby} />
    </div>
  )
}
