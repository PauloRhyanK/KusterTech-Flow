import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ErroDeConfiguracaoDeModulos,
  moduloAtivo,
  modulosAtivos,
  resolverModulosAtivos,
} from './modulos'

describe('catálogo de módulos', () => {
  it('por padrão ativa clientes, projetos, github, desenvolvimento, fabrica, maquinas e fila-de-publicacao; publicacao continua inativo', () => {
    expect([...resolverModulosAtivos(undefined)].sort()).toEqual([
      'clientes',
      'desenvolvimento',
      'fabrica',
      'fila-de-publicacao',
      'github',
      'maquinas',
      'projetos',
    ])
  })
  it('extras ligam módulos congelados', () => {
    expect(resolverModulosAtivos('entregas, ambientes').has('entregas')).toBe(true)
  })
  it('ligar homologacao sem entregas e ambientes é erro', () => {
    expect(() => resolverModulosAtivos('homologacao')).toThrow(ErroDeConfiguracaoDeModulos)
  })
  it('ligar publicacao exige a cadeia inteira', () => {
    expect(() => resolverModulosAtivos('entregas,ambientes,publicacao')).toThrow(/homologacao/)
    expect(resolverModulosAtivos('entregas,ambientes,homologacao,publicacao').size).toBe(11)
  })
  it('nome desconhecido em extras é erro', () => {
    expect(() => resolverModulosAtivos('alertas')).toThrow(/alertas/)
  })
  it('vazio e espaços equivalem a nenhum extra', () => {
    expect(resolverModulosAtivos('  ').size).toBe(7)
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
