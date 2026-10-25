import { describe, expect, test } from 'vitest'
import { ErroDeDominio } from '@/lib/erros'
import {
  abasDoContexto,
  calcularChecklist,
  type ContagensDoProjeto,
  validarNomeDeProjeto,
} from './model'

describe('projetos / model (unitário)', () => {
  test('calcularChecklist: sem clientes → clientes pendente com ação para o href; com clientes → concluido; href null → pendente sem ação; github/ambientes/milestones sempre indisponivel; nunca concluido sem contagem; ordem fixa', () => {
    const contagensSemClientes: ContagensDoProjeto = {
      clientes: 0,
      repositorios: 0,
      ambientes: 0,
      milestones: 0,
    }

    const checklistComHref = calcularChecklist(contagensSemClientes, '/projetos/p-1/configuracao')

    // Ordem fixa: clientes, github, ambientes, milestones
    expect(checklistComHref.map((item) => item.chave)).toEqual([
      'clientes',
      'github',
      'ambientes',
      'milestones',
    ])

    // Clientes pendente com ação quando hrefConfiguracao não é null
    expect(checklistComHref[0]).toEqual({
      chave: 'clientes',
      titulo: 'Clientes',
      descricao: 'Nenhum cliente associado',
      estado: 'pendente',
      acao: {
        rotulo: 'Associar clientes',
        href: '/projetos/p-1/configuracao',
      },
    })

    // GitHub, Ambientes, Milestones sempre indisponíveis com suas mensagens específicas
    expect(checklistComHref[1]).toEqual({
      chave: 'github',
      titulo: 'GitHub',
      descricao: 'A integração com o GitHub chega no Incremento 2.',
      estado: 'indisponivel',
    })
    expect(checklistComHref[2]).toEqual({
      chave: 'ambientes',
      titulo: 'Ambientes',
      descricao: 'Ambientes e evidências de deploy chegam no Incremento 4.',
      estado: 'indisponivel',
    })
    expect(checklistComHref[3]).toEqual({
      chave: 'milestones',
      titulo: 'Milestones',
      descricao: 'Milestones e entregas chegam no Incremento 3.',
      estado: 'indisponivel',
    })

    // Sem clientes e com href null → pendente sem ação
    const checklistSemHref = calcularChecklist(contagensSemClientes, null)
    expect(checklistSemHref[0]).toEqual({
      chave: 'clientes',
      titulo: 'Clientes',
      descricao: 'Nenhum cliente associado',
      estado: 'pendente',
    })
    expect(checklistSemHref[0]?.acao).toBeUndefined()

    // Com clientes (> 0) → concluido ("Clientes associados"), sem ação
    const contagensComClientes: ContagensDoProjeto = {
      clientes: 2,
      repositorios: 0,
      ambientes: 0,
      milestones: 0,
    }
    const checklistConcluido = calcularChecklist(contagensComClientes, '/projetos/p-1/configuracao')
    expect(checklistConcluido[0]).toEqual({
      chave: 'clientes',
      titulo: 'Clientes',
      descricao: 'Clientes associados',
      estado: 'concluido',
    })
    expect(checklistConcluido[0]?.acao).toBeUndefined()

    // Mesmo com contagens altas em repos/ambientes/milestones, continuam indisponíveis (sem fonte)
    const contagensAltas: ContagensDoProjeto = {
      clientes: 1,
      repositorios: 5,
      ambientes: 3,
      milestones: 2,
    }
    const checklistAltas = calcularChecklist(contagensAltas, null)
    expect(checklistAltas[1]?.estado).toBe('indisponivel')
    expect(checklistAltas[2]?.estado).toBe('indisponivel')
    expect(checklistAltas[3]?.estado).toBe('indisponivel')
  })

  test('abasDoContexto: global tem 5 abas com hrefs /projetos/[p]/...; cliente tem 3 com /clientes/[c]/projetos/[p]/...; só Resumo disponivel', () => {
    const projetoId = 'proj-123'

    // Contexto global
    const abasGlobal = abasDoContexto(projetoId, { tipo: 'global' })
    expect(abasGlobal).toEqual([
      { rotulo: 'Resumo', href: '/projetos/proj-123', disponivel: true },
      { rotulo: 'Entregas', href: '/projetos/proj-123/entregas', disponivel: false },
      { rotulo: 'Homologação', href: '/projetos/proj-123/homologacao', disponivel: false },
      { rotulo: 'Saúde e Erros', href: '/projetos/proj-123/saude', disponivel: false },
      { rotulo: 'Recursos', href: '/projetos/proj-123/recursos', disponivel: false },
    ])

    // Contexto cliente
    const abasCliente = abasDoContexto(projetoId, { tipo: 'cliente', clienteId: 'cli-456' })
    expect(abasCliente).toEqual([
      { rotulo: 'Resumo', href: '/clientes/cli-456/projetos/proj-123', disponivel: true },
      {
        rotulo: 'Entregas',
        href: '/clientes/cli-456/projetos/proj-123/entregas',
        disponivel: false,
      },
      {
        rotulo: 'Homologação',
        href: '/clientes/cli-456/projetos/proj-123/homologacao',
        disponivel: false,
      },
    ])
  })

  test('validarNomeDeProjeto: vazio, 121 caracteres, aparado', () => {
    // Vazio
    expect(() => validarNomeDeProjeto('')).toThrow(ErroDeDominio)
    expect(() => validarNomeDeProjeto('')).toThrow('O nome é obrigatório.')

    // Só espaços
    expect(() => validarNomeDeProjeto('    ')).toThrow(ErroDeDominio)
    expect(() => validarNomeDeProjeto('    ')).toThrow('O nome é obrigatório.')

    // 120 caracteres é aceito
    const nome120 = 'p'.repeat(120)
    expect(validarNomeDeProjeto(nome120)).toBe(nome120)

    // 121 caracteres lança
    const nome121 = 'p'.repeat(121)
    expect(() => validarNomeDeProjeto(nome121)).toThrow(ErroDeDominio)
    expect(() => validarNomeDeProjeto(nome121)).toThrow(
      'O nome não pode ter mais de 120 caracteres.',
    )

    // Aparado
    expect(validarNomeDeProjeto('  Projeto Alpha  ')).toBe('Projeto Alpha')

    // 121 caracteres após aparar lança erro
    const nome121ComEspacos = `  ${'x'.repeat(121)}  `
    expect(() => validarNomeDeProjeto(nome121ComEspacos)).toThrow(
      'O nome não pode ter mais de 120 caracteres.',
    )
  })
})
