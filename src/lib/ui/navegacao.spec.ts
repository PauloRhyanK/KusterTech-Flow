import { describe, expect, it } from 'vitest'
import { ENTRADAS_SECUNDARIAS, GRUPOS_DE_NAVEGACAO, itemAtivo } from './navegacao'
import {
  Bot,
  Building2,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  MessageSquareMore,
  Rocket,
  Server,
  Settings,
  Ticket,
} from 'lucide-react'

describe('navegacao', () => {
  it('grupo Trabalho: Início, Decidir, Demandas, Tickets, Publicação, Fábrica; Cadastro com os itens e hrefs na ordem', () => {
    expect(
      GRUPOS_DE_NAVEGACAO.map((g) => [g.rotulo, g.itens.map((i) => [i.rotulo, i.href])]),
    ).toEqual([
      [
        'Trabalho',
        [
          ['Início', '/'],
          ['Decidir', '/decidir'],
          ['Demandas', '/demandas'],
          ['Tickets', '/tickets'],
          ['Publicação', '/publicacao'],
          ['Fábrica', '/fabrica'],
        ],
      ],
      [
        'Cadastro',
        [
          ['Clientes', '/clientes'],
          ['Projetos', '/projetos'],
          ['Máquinas', '/maquinas'],
        ],
      ],
    ])
    const itens = GRUPOS_DE_NAVEGACAO.flatMap((g) => g.itens)
    expect(itens.map((i) => i.icone)).toEqual([
      LayoutDashboard,
      MessageSquareMore,
      Inbox,
      Ticket,
      Rocket,
      Bot,
      Building2,
      FolderKanban,
      Server,
    ])
    for (const item of itens) {
      expect(item.descricao).toBeTruthy()
    }
  })

  it('Configurações não está nos grupos e é a entrada secundária', () => {
    expect(GRUPOS_DE_NAVEGACAO.some((g) => g.itens.some((i) => i.href === '/configuracoes'))).toBe(
      false,
    )
    expect(ENTRADAS_SECUNDARIAS).toHaveLength(1)
    const config = ENTRADAS_SECUNDARIAS[0]
    expect(config).toBeDefined()
    if (!config) return
    expect(config.rotulo).toBe('Configurações')
    expect(config.href).toBe('/configuracoes')
    expect(config.icone).toBe(Settings)
    expect(config.descricao).toBeTruthy()
  })

  it('itemAtivo: / só casa exato; /fabrica/avisos casa Fábrica; /maquinas/x casa Máquinas; /desenvolvimento/execucoes/x não casa', () => {
    expect(itemAtivo('/')?.rotulo).toBe('Início')
    expect(itemAtivo('/publicacao')?.rotulo).toBe('Publicação')
    expect(itemAtivo('/demandas')?.rotulo).toBe('Demandas')
    expect(itemAtivo('/demandas/x')?.rotulo).toBe('Demandas')
    expect(itemAtivo('/demandasx')).toBeUndefined()
    expect(itemAtivo('/tickets/abc')?.rotulo).toBe('Tickets')
    expect(itemAtivo('/fabrica')?.rotulo).toBe('Fábrica')
    expect(itemAtivo('/fabrica/avisos')?.rotulo).toBe('Fábrica')
    expect(itemAtivo('/clientes')?.rotulo).toBe('Clientes')
    expect(itemAtivo('/clientes/acme')?.rotulo).toBe('Clientes')
    expect(itemAtivo('/projetos')?.rotulo).toBe('Projetos')
    expect(itemAtivo('/projetos/abc')?.rotulo).toBe('Projetos')
    expect(itemAtivo('/maquinas')?.rotulo).toBe('Máquinas')
    expect(itemAtivo('/maquinas/x')?.rotulo).toBe('Máquinas')
    expect(itemAtivo('/configuracoes')?.rotulo).toBe('Configurações')
    expect(itemAtivo('/configuracoes/usuarios')?.rotulo).toBe('Configurações')

    expect(itemAtivo('/desenvolvimento')).toBeUndefined()
    expect(itemAtivo('/desenvolvimento/execucoes/x')).toBeUndefined()
    expect(itemAtivo('/x')).toBeUndefined()
    expect(itemAtivo('/projetoss')).toBeUndefined()
    expect(itemAtivo('/fabricas')).toBeUndefined()
    expect(itemAtivo('/projetos/p/publicacoes')?.rotulo).toBe('Projetos')
    expect(itemAtivo('/configuracao')).toBeUndefined()
  })
})
