import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CATALOGO_DE_MODULOS,
  ErroDeConfiguracaoDeModulos,
  moduloAtivo,
  modulosAtivos,
  resolverModulosAtivos,
} from './modulos'

describe('catálogo de módulos', () => {
  it('por padrão ativa atividade, clientes, projetos, github, desenvolvimento, fabrica, maquinas fila-de-publicacao e demandas; publicacao continua inativo', () => {
    expect([...resolverModulosAtivos(undefined)].sort()).toEqual([
      'atividade',
      'clientes',
      'decidir',
      'demandas',
      'desenvolvimento',
      'erros',
      'fabrica',
      'fila-de-publicacao',
      'github',
      'maquinas',
      'projetos',
      'relatos',
      'tickets',
    ])
  })
  it('FLOW_MODULOS_EXTRAS sem fabrica não desliga demandas porque fabrica é ativo', () => {
    expect(resolverModulosAtivos('entregas').has('demandas')).toBe(true)
  })
  it('decidir está ativo e depende de demandas, fabrica e github', () => {
    expect(CATALOGO_DE_MODULOS.decidir).toEqual({
      ativo: true,
      dependeDe: ['demandas', 'fabrica', 'github'],
    })
    expect(resolverModulosAtivos(undefined).has('decidir')).toBe(true)
  })
  it('erros está ativo e depende de demandas', () => {
    expect(CATALOGO_DE_MODULOS.erros).toEqual({ ativo: true, dependeDe: ['demandas'] })
  })
  it('relatos está ativo e depende de demandas e decidir', () => {
    expect(CATALOGO_DE_MODULOS.relatos).toEqual({ ativo: true, dependeDe: ['demandas', 'decidir'] })
  })
  it('tickets está ativo e depende de relatos', () => {
    expect(CATALOGO_DE_MODULOS.tickets).toEqual({ ativo: true, dependeDe: ['relatos'] })
  })
  it('extras ligam módulos congelados', () => {
    expect(resolverModulosAtivos('entregas, ambientes').has('entregas')).toBe(true)
  })
  it('ligar homologacao sem entregas e ambientes é erro', () => {
    expect(() => resolverModulosAtivos('homologacao')).toThrow(ErroDeConfiguracaoDeModulos)
  })
  it('ligar publicacao exige a cadeia inteira', () => {
    expect(() => resolverModulosAtivos('entregas,ambientes,publicacao')).toThrow(/homologacao/)
    expect(resolverModulosAtivos('entregas,ambientes,homologacao,publicacao').size).toBe(17)
  })
  it('nome desconhecido em extras é erro', () => {
    expect(() => resolverModulosAtivos('alertas')).toThrow(/alertas/)
  })
  it('vazio e espaços equivalem a nenhum extra', () => {
    expect(resolverModulosAtivos('  ').size).toBe(13)
  })
})

describe('módulos ativos do processo', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })
  it('lê FLOW_MODULOS_EXTRAS e guarda o resultado', async () => {
    vi.stubEnv('FLOW_MODULOS_EXTRAS', 'entregas')
    vi.resetModules()
    const m = await import('./modulos')
    expect(m.moduloAtivo('entregas')).toBe(true)
    expect(m.moduloAtivo('ambientes')).toBe(false)
    expect(m.modulosAtivos()).toBe(m.modulosAtivos())
  })
  it('sem extras, módulo congelado fica inativo', () => {
    expect(moduloAtivo('publicacao')).toBe(false)
    expect(modulosAtivos().has('clientes')).toBe(true)
  })
})
