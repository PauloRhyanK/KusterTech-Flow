export type Tema = 'sistema' | 'claro' | 'escuro'

export const TEMAS: readonly Tema[] = ['sistema', 'claro', 'escuro']

export const TEMA_PADRAO: Tema = 'sistema'

const MAPA_DO_BANCO: Record<'SISTEMA' | 'CLARO' | 'ESCURO', Tema> = {
  SISTEMA: 'sistema',
  CLARO: 'claro',
  ESCURO: 'escuro',
}

const MAPA_PARA_BANCO: Record<Tema, 'SISTEMA' | 'CLARO' | 'ESCURO'> = {
  sistema: 'SISTEMA',
  claro: 'CLARO',
  escuro: 'ESCURO',
}

export function ehTema(valor: unknown): valor is Tema {
  return typeof valor === 'string' && (TEMAS as readonly string[]).includes(valor)
}

export function temaDoBanco(valor: 'SISTEMA' | 'CLARO' | 'ESCURO'): Tema {
  return MAPA_DO_BANCO[valor] ?? TEMA_PADRAO
}

export function temaParaBanco(tema: Tema): 'SISTEMA' | 'CLARO' | 'ESCURO' {
  return MAPA_PARA_BANCO[tema]
}

export function resolverTema(preferencia: Tema, sistemaEscuro: boolean): 'claro' | 'escuro' {
  if (preferencia === 'sistema') {
    return sistemaEscuro ? 'escuro' : 'claro'
  }
  return preferencia
}

export const SCRIPT_APLICAR_TEMA =
  "(function(){try{var d=document.documentElement;var t=d.dataset.tema||'sistema';var e=t==='escuro'||(t==='sistema'&&typeof window.matchMedia==='function'&&window.matchMedia('(prefers-color-scheme: dark)').matches);d.classList.toggle('dark',Boolean(e));}catch(_){}})();"
