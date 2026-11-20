export type ModuloId =
  | 'clientes'
  | 'projetos'
  | 'github'
  | 'desenvolvimento'
  | 'fabrica'
  | 'maquinas'
  | 'fila-de-publicacao'
  | 'entregas'
  | 'ambientes'
  | 'homologacao'
  | 'publicacao'
  | 'demandas'

export const CATALOGO_DE_MODULOS: Record<
  ModuloId,
  { ativo: boolean; dependeDe: readonly ModuloId[] }
> = {
  clientes: { ativo: true, dependeDe: [] },
  projetos: { ativo: true, dependeDe: [] },
  github: { ativo: true, dependeDe: ['projetos'] },
  desenvolvimento: { ativo: true, dependeDe: ['github'] },
  fabrica: { ativo: true, dependeDe: [] },
  maquinas: { ativo: true, dependeDe: [] },
  'fila-de-publicacao': { ativo: true, dependeDe: ['github'] },
  entregas: { ativo: false, dependeDe: ['github'] },
  ambientes: { ativo: false, dependeDe: ['github'] },
  homologacao: { ativo: false, dependeDe: ['entregas', 'ambientes'] },
  publicacao: { ativo: false, dependeDe: ['homologacao'] },
  demandas: { ativo: true, dependeDe: ['projetos', 'fabrica'] },
}

export class ErroDeConfiguracaoDeModulos extends Error {}

function ehModuloId(nome: string): nome is ModuloId {
  return Object.hasOwn(CATALOGO_DE_MODULOS, nome)
}

export function resolverModulosAtivos(extras: string | undefined): ReadonlySet<ModuloId> {
  const ativos = new Set<ModuloId>()
  for (const [id, modulo] of Object.entries(CATALOGO_DE_MODULOS)) {
    if (modulo.ativo) ativos.add(id as ModuloId)
  }
  const nomes = (extras ?? '')
    .split(',')
    .map((nome) => nome.trim())
    .filter((nome) => nome !== '')
  for (const nome of nomes) {
    if (!ehModuloId(nome)) {
      throw new ErroDeConfiguracaoDeModulos(`Módulo desconhecido em FLOW_MODULOS_EXTRAS: ${nome}`)
    }
    ativos.add(nome)
  }
  for (const id of ativos) {
    for (const dependencia of CATALOGO_DE_MODULOS[id].dependeDe) {
      if (!ativos.has(dependencia)) {
        throw new ErroDeConfiguracaoDeModulos(
          `O módulo ${id} depende de ${dependencia}, que não está ativo`,
        )
      }
    }
  }
  return ativos
}

let memoria: ReadonlySet<ModuloId> | undefined

export function modulosAtivos(): ReadonlySet<ModuloId> {
  memoria ??= resolverModulosAtivos(process.env.FLOW_MODULOS_EXTRAS)
  return memoria
}

export function moduloAtivo(id: ModuloId): boolean {
  return modulosAtivos().has(id)
}
