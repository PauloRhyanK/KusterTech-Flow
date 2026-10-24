/**
 * Fonte única e tipada dos tokens semânticos de cor dos temas claro e escuro,
 * cores funcionais e cores institucionais da marca (docs/identidade-visual.md).
 *
 * Regras de uso e restrições de contraste WCAG 2.x:
 * - `text-tertiary` (#8290A1 no claro = 3,25:1 sobre surface; #7E8DA6 no escuro = 5,16:1):
 *   usar exclusivamente em texto desabilitado, placeholder ou texto grande (≥ 24 px).
 *   Conflito documentado entre Identidade §4 ("Informações auxiliares") e §6 (texto normal ≥ 4,5:1).
 * - `text-secondary` (#607083 no claro = 5,06:1 sobre surface, mas 4,49:1 sobre surface-subtle)
 *   e cores funcionais nunca devem ser aplicados sobre `surface-subtle` no tema claro.
 *   `surface-subtle` serve para agrupar áreas, não para receber texto secundário ou funcional direto.
 * - Badges de estado (`BadgeDeEstado`) devem ser renderizados apenas sobre `surface`,
 *   com fundo misturado via `TINT_BADGE` (5% no claro, 22% no escuro), garantindo contraste ≥ 4,5:1.
 * - Pares conhecidos abaixo do mínimo da Identidade (preservados sem alterar os hex originais):
 *   1. `border-strong` sobre `surface` (1,53:1 no claro, 1,76:1 no escuro; mínimo gráfico 3:1).
 *   2. `action-foreground` (#FFFFFF) sobre `action-hover` no tema escuro (#3D7AF0 = 4,00:1; mínimo 4,5:1).
 * - `text-link` (#2D6BE4 no claro, #78A4FF no escuro) garante ≥ 4,5:1 para links textuais nos dois temas.
 */

import { compor } from './contraste'

export type NomeDoTema = 'claro' | 'escuro'

export interface TokensSemanticos {
  background: string
  surface: string
  surfaceSubtle: string
  surfaceElevated: string
  textPrimary: string
  textSecondary: string
  textTertiary: string
  textLink: string
  border: string
  borderStrong: string
  actionPrimary: string
  actionHover: string
  actionForeground: string
  contextActive: string
  focusRing: string
  marcaKuster: string
  marcaTech: string
  marcaFlow: string
}

export interface CoresFuncionais {
  sucesso: string
  informacao: string
  atencao: string
  erro: string
  neutro: string
  execucao: string
}

export const MARCA = {
  midnight: '#0B1120',
  ink: '#172033',
  signalBlue: '#2D6BE4',
  skyBlue: '#5B8FF9',
  flowTeal: '#138D82',
  flowMint: '#72D9C3',
  successMint: '#C8F5E0',
  ice: '#E8EFFF',
  cloud: '#F5F7FA',
} as const

export const TOKENS: Record<NomeDoTema, TokensSemanticos> = {
  claro: {
    background: '#F5F7FA',
    surface: '#FFFFFF',
    surfaceSubtle: '#EDF2F5',
    surfaceElevated: '#FFFFFF',
    textPrimary: '#172033',
    textSecondary: '#607083',
    textTertiary: '#8290A1',
    textLink: '#2D6BE4',
    border: '#DCE4EA',
    borderStrong: '#C6D2DC',
    actionPrimary: '#2D6BE4',
    actionHover: '#2358BE',
    actionForeground: '#FFFFFF',
    contextActive: '#138D82',
    focusRing: '#5B8FF9',
    marcaKuster: '#172033',
    marcaTech: '#2D6BE4',
    marcaFlow: '#138D82',
  },
  escuro: {
    background: '#0B1120',
    surface: '#121A2C',
    surfaceSubtle: '#0F1728',
    surfaceElevated: '#1A2338',
    textPrimary: '#E8EFFF',
    textSecondary: '#A7B4C9',
    textTertiary: '#7E8DA6',
    textLink: '#78A4FF',
    border: '#26334A',
    borderStrong: '#34445F',
    actionPrimary: '#2D6BE4',
    actionHover: '#3D7AF0',
    actionForeground: '#FFFFFF',
    contextActive: '#72D9C3',
    focusRing: '#5B8FF9',
    marcaKuster: '#E8EFFF',
    marcaTech: '#5B8FF9',
    marcaFlow: '#72D9C3',
  },
}

export const FUNCIONAIS: Record<NomeDoTema, CoresFuncionais> = {
  claro: {
    sucesso: '#287A50',
    informacao: '#2D6BE4',
    atencao: '#A96011',
    erro: '#B34343',
    neutro: '#607083',
    execucao: '#7157A6',
  },
  escuro: {
    sucesso: '#72D9A2',
    informacao: '#78A4FF',
    atencao: '#F2B85B',
    erro: '#FF8585',
    neutro: '#A7B4C9',
    execucao: '#B49AE8',
  },
}

export const TINT_BADGE: Record<NomeDoTema, number> = {
  claro: 0.05,
  escuro: 0.22,
}

export interface ParDeContraste {
  nome: string
  frente: string
  fundo: string
  minimo: 4.5 | 3
  tema: NomeDoTema
  conhecido?: boolean
}

export function paresDeContraste(): ParDeContraste[] {
  const pares: ParDeContraste[] = []

  for (const tema of ['claro', 'escuro'] as const) {
    const t = TOKENS[tema]
    const f = FUNCIONAIS[tema]
    const tint = TINT_BADGE[tema]

    pares.push(
      {
        nome: 'textPrimary/background',
        frente: t.textPrimary,
        fundo: t.background,
        minimo: 4.5,
        tema,
      },
      { nome: 'textPrimary/surface', frente: t.textPrimary, fundo: t.surface, minimo: 4.5, tema },
      {
        nome: 'textPrimary/surfaceSubtle',
        frente: t.textPrimary,
        fundo: t.surfaceSubtle,
        minimo: 4.5,
        tema,
      },
      {
        nome: 'textSecondary/surface',
        frente: t.textSecondary,
        fundo: t.surface,
        minimo: 4.5,
        tema,
      },
      { nome: 'textLink/surface', frente: t.textLink, fundo: t.surface, minimo: 4.5, tema },
      {
        nome: 'actionForeground/actionPrimary',
        frente: t.actionForeground,
        fundo: t.actionPrimary,
        minimo: 4.5,
        tema,
      },
    )

    for (const [nomeFuncional, corFuncional] of Object.entries(f)) {
      pares.push(
        {
          nome: `funcional:${nomeFuncional}/surface`,
          frente: corFuncional,
          fundo: t.surface,
          minimo: 4.5,
          tema,
        },
        {
          nome: `funcional:${nomeFuncional}/badge`,
          frente: corFuncional,
          fundo: compor(corFuncional, tint, t.surface),
          minimo: 4.5,
          tema,
        },
      )
    }

    pares.push(
      { nome: 'textTertiary/surface', frente: t.textTertiary, fundo: t.surface, minimo: 3, tema },
      { nome: 'actionPrimary/surface', frente: t.actionPrimary, fundo: t.surface, minimo: 3, tema },
      { nome: 'contextActive/surface', frente: t.contextActive, fundo: t.surface, minimo: 3, tema },
      { nome: 'focusRing/surface', frente: t.focusRing, fundo: t.surface, minimo: 3, tema },
      {
        nome: 'borderStrong/surface',
        frente: t.borderStrong,
        fundo: t.surface,
        minimo: 3,
        tema,
        conhecido: true,
      },
      {
        nome: 'actionForeground/actionHover',
        frente: t.actionForeground,
        fundo: t.actionHover,
        minimo: 4.5,
        tema,
        ...(tema === 'escuro' ? { conhecido: true } : {}),
      },
    )
  }

  return pares
}
