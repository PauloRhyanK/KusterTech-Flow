import { describe, expect, it } from 'vitest'
import { ENTRADAS_SECUNDARIAS, MODULOS, itemAtivo } from './navegacao'
import { Bot, Building2, FolderKanban, LayoutDashboard, Server, Settings } from 'lucide-react'

describe('navegacao', () => {
  it('MODULOS tem exatamente os cinco módulos de D49 na ordem', () => {
    expect(MODULOS).toHaveLength(5)
    expect(MODULOS.map((m) => m.rotulo)).toEqual([
      'Visão Geral',
      'Clientes',
      'Projetos',
      'Infraestrutura',
      'Central de Desenvolvimento',
    ])
    expect(MODULOS.map((m) => m.href)).toEqual([
      '/',
      '/clientes',
      '/projetos',
      '/infraestrutura',
      '/desenvolvimento',
    ])
    expect(MODULOS.map((m) => m.icone)).toEqual([
      LayoutDashboard,
      Building2,
      FolderKanban,
      Server,
      Bot,
    ])
    for (const modulo of MODULOS) {
      expect(modulo.descricao).toBeTruthy()
    }
  })

  it('Configurações não está no menu principal e é a entrada secundária', () => {
    expect(MODULOS.some((m) => m.href === '/configuracoes')).toBe(false)
    expect(ENTRADAS_SECUNDARIAS).toHaveLength(1)
    const config = ENTRADAS_SECUNDARIAS[0]
    expect(config).toBeDefined()
    if (!config) return
    expect(config.rotulo).toBe('Configurações')
    expect(config.href).toBe('/configuracoes')
    expect(config.icone).toBe(Settings)
    expect(config.descricao).toBeTruthy()
  })

  it('itemAtivo: / só casa exato; /projetos/abc casa Projetos; /configuracoes/usuarios casa Configurações; /x não casa', () => {
    expect(itemAtivo('/')?.rotulo).toBe('Visão Geral')
    expect(itemAtivo('/clientes')?.rotulo).toBe('Clientes')
    expect(itemAtivo('/clientes/acme')?.rotulo).toBe('Clientes')
    expect(itemAtivo('/projetos')?.rotulo).toBe('Projetos')
    expect(itemAtivo('/projetos/abc')?.rotulo).toBe('Projetos')
    expect(itemAtivo('/infraestrutura')?.rotulo).toBe('Infraestrutura')
    expect(itemAtivo('/infraestrutura/servidores')?.rotulo).toBe('Infraestrutura')
    expect(itemAtivo('/desenvolvimento')?.rotulo).toBe('Central de Desenvolvimento')
    expect(itemAtivo('/desenvolvimento/execucoes')?.rotulo).toBe('Central de Desenvolvimento')
    expect(itemAtivo('/configuracoes')?.rotulo).toBe('Configurações')
    expect(itemAtivo('/configuracoes/usuarios')?.rotulo).toBe('Configurações')
    expect(itemAtivo('/configuracoes/aparencia')?.rotulo).toBe('Configurações')

    // Casos que não devem casar
    expect(itemAtivo('/x')).toBeUndefined()
    expect(itemAtivo('/projetoss')).toBeUndefined()
    expect(itemAtivo('/configuracao')).toBeUndefined()
    expect(itemAtivo('/outro')).toBeUndefined()
  })
})
