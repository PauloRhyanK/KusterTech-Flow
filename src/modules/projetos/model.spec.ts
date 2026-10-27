import { describe, expect, test } from 'vitest'
import { ErroDeDominio } from '@/lib/erros'
import type { EstadoIntegracao } from '@/modules/github/model'
import {
  abasDoContexto,
  calcularChecklist,
  type ContagensDoProjeto,
  rotasDoProjeto,
  trilhasDoProjeto,
  validarNomeDeProjeto,
} from './model'

describe('projetos / model (unitário)', () => {
  test('calcularChecklist: sem clientes → clientes pendente com ação para o href; com clientes → concluido; href null → pendente sem ação; github pelo estado real; ambientes pela contagem; nunca concluido sem contagem; ordem fixa', () => {
    const contagensSemClientes: ContagensDoProjeto = {
      clientes: 0,
      repositorios: 0,
      ambientes: 0,
      milestones: 0,
    }

    const checklistComHref = calcularChecklist(
      contagensSemClientes,
      '/projetos/p-1/configuracao',
      'nao-configurada',
    )

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

    // GitHub sem repositórios e Ambientes sem nenhum são pendentes
    expect(checklistComHref[1]).toEqual({
      chave: 'github',
      titulo: 'GitHub',
      descricao: 'Nenhum repositório vinculado',
      estado: 'pendente',
      acao: {
        rotulo: 'Vincular repositórios',
        href: '/projetos/p-1/configuracao#repositorios',
      },
    })
    expect(checklistComHref[2]).toEqual({
      chave: 'ambientes',
      titulo: 'Ambientes',
      descricao: 'Nenhum ambiente configurado',
      estado: 'pendente',
      acao: {
        rotulo: 'Configurar ambientes',
        href: '/projetos/p-1/configuracao#ambientes',
      },
    })
    expect(checklistComHref[3]).toEqual({
      chave: 'milestones',
      titulo: 'Milestones',
      descricao: 'Nenhuma milestone criada',
      estado: 'pendente',
    })

    // Sem clientes e com href null → pendente sem ação
    const checklistSemHref = calcularChecklist(contagensSemClientes, null, 'nao-configurada')
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
    const checklistConcluido = calcularChecklist(
      contagensComClientes,
      '/projetos/p-1/configuracao',
      'nao-configurada',
    )
    expect(checklistConcluido[0]).toEqual({
      chave: 'clientes',
      titulo: 'Clientes',
      descricao: 'Clientes associados',
      estado: 'concluido',
    })
    expect(checklistConcluido[0]?.acao).toBeUndefined()

    // Com contagens altas, repositórios, ambientes e milestones ficam concluídos
    const contagensAltas: ContagensDoProjeto = {
      clientes: 1,
      repositorios: 5,
      ambientes: 3,
      milestones: 2,
    }
    const checklistAltas = calcularChecklist(contagensAltas, null, 'conectada')
    expect(checklistAltas[1]?.estado).toBe('concluido')
    expect(checklistAltas[2]?.estado).toBe('concluido')
    expect(checklistAltas[3]?.estado).toBe('concluido')
  })

  test('checklist: 0 → pendente "Nenhum ambiente configurado" com href #ambientes; 2 → "2 de 3 ambientes configurados"; 3 → concluido "DEV, QA e PROD configurados"; href null → sem acao', () => {
    const base: ContagensDoProjeto = { clientes: 1, repositorios: 1, ambientes: 0, milestones: 1 }
    const ambientes = (ambientesConfigurados: number, href: string | null) =>
      calcularChecklist({ ...base, ambientes: ambientesConfigurados }, href, 'conectada').find(
        (i) => i.chave === 'ambientes',
      )
    const acao = {
      rotulo: 'Configurar ambientes',
      href: '/projetos/p-1/configuracao#ambientes',
    }

    expect(ambientes(0, '/projetos/p-1/configuracao')).toEqual({
      chave: 'ambientes',
      titulo: 'Ambientes',
      descricao: 'Nenhum ambiente configurado',
      estado: 'pendente',
      acao,
    })
    expect(ambientes(1, '/projetos/p-1/configuracao')?.descricao).toBe(
      '1 de 3 ambientes configurados',
    )
    expect(ambientes(2, '/projetos/p-1/configuracao')).toEqual({
      chave: 'ambientes',
      titulo: 'Ambientes',
      descricao: '2 de 3 ambientes configurados',
      estado: 'pendente',
      acao,
    })
    expect(ambientes(3, '/projetos/p-1/configuracao')).toEqual({
      chave: 'ambientes',
      titulo: 'Ambientes',
      descricao: 'DEV, QA e PROD configurados',
      estado: 'concluido',
    })
    expect(ambientes(0, null)).toEqual({
      chave: 'ambientes',
      titulo: 'Ambientes',
      descricao: 'Nenhum ambiente configurado',
      estado: 'pendente',
    })
  })

  test('calcularChecklist milestones: 0 com hrefEntregas → acao Criar milestone para /projetos/p-1/entregas?nova=1#nova-milestone; 1 → "1 milestone ativa"; 2 → "2 milestones ativas"', () => {
    const base: ContagensDoProjeto = { clientes: 1, repositorios: 1, ambientes: 0, milestones: 0 }
    const milestones = (c: ContagensDoProjeto, hrefEntregas?: string | null) =>
      calcularChecklist(c, null, 'conectada', hrefEntregas).find((i) => i.chave === 'milestones')

    expect(milestones(base, '/projetos/p-1/entregas')).toEqual({
      chave: 'milestones',
      titulo: 'Milestones',
      descricao: 'Nenhuma milestone criada',
      estado: 'pendente',
      acao: { rotulo: 'Criar milestone', href: '/projetos/p-1/entregas?nova=1#nova-milestone' },
    })
    expect(milestones(base, null)?.acao).toBeUndefined()
    expect(milestones({ ...base, milestones: 1 }, '/projetos/p-1/entregas')).toEqual({
      chave: 'milestones',
      titulo: 'Milestones',
      descricao: '1 milestone ativa',
      estado: 'concluido',
    })
    expect(milestones({ ...base, milestones: 2 })?.descricao).toBe('2 milestones ativas')
  })

  test('calcularChecklist github: pendente sem repositórios com ação #repositorios; falha com indisponível; concluído com "2 repositórios vinculados"; sem href não há ação', () => {
    const base: ContagensDoProjeto = { clientes: 1, repositorios: 0, ambientes: 0, milestones: 0 }
    const href = '/projetos/p-1/configuracao'
    const github = (c: ContagensDoProjeto, h: string | null, e: EstadoIntegracao) =>
      calcularChecklist(c, h, e).find((i) => i.chave === 'github')

    expect(github(base, href, 'nao-configurada')).toEqual({
      chave: 'github',
      titulo: 'GitHub',
      descricao: 'Nenhum repositório vinculado',
      estado: 'pendente',
      acao: { rotulo: 'Vincular repositórios', href: `${href}#repositorios` },
    })
    expect(github(base, null, 'nao-configurada')?.acao).toBeUndefined()

    const falha = github({ ...base, repositorios: 2 }, href, 'indisponivel')
    expect(falha).toEqual({
      chave: 'github',
      titulo: 'GitHub',
      descricao: 'Integração indisponível; os dados podem estar desatualizados.',
      estado: 'falha',
      acao: { rotulo: 'Ver repositórios', href: `${href}#repositorios` },
    })

    expect(github({ ...base, repositorios: 2 }, href, 'conectada')).toEqual({
      chave: 'github',
      titulo: 'GitHub',
      descricao: '2 repositórios vinculados',
      estado: 'concluido',
    })
    expect(github({ ...base, repositorios: 1 }, href, 'sem-dados-recentes')?.descricao).toBe(
      '1 repositório vinculado',
    )
    expect(github({ ...base, repositorios: 1 }, null, 'indisponivel')?.acao).toBeUndefined()
  })

  test('abasDoContexto: global tem 5 abas com hrefs /projetos/[p]/... e Entregas e Homologação disponíveis; cliente tem 3 com /clientes/[c]/projetos/[p]/... e Entregas e Homologação disponíveis', () => {
    const projetoId = 'proj-123'

    // Contexto global
    const abasGlobal = abasDoContexto(projetoId, { tipo: 'global' })
    expect(abasGlobal).toEqual([
      { rotulo: 'Resumo', href: '/projetos/proj-123', disponivel: true },
      { rotulo: 'Entregas', href: '/projetos/proj-123/entregas', disponivel: true },
      { rotulo: 'Homologação', href: '/projetos/proj-123/homologacao', disponivel: true },
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
        disponivel: true,
      },
      {
        rotulo: 'Homologação',
        href: '/clientes/cli-456/projetos/proj-123/homologacao',
        disponivel: true,
      },
    ])
  })

  test('rotasDoProjeto: global e cliente para entregas, milestone com aba homologacao e issue com ?milestone=m-1', () => {
    const global = rotasDoProjeto('p-1', { tipo: 'global' })
    expect(global.resumo).toBe('/projetos/p-1')
    expect(global.entregas).toBe('/projetos/p-1/entregas')
    expect(global.milestone('m-1')).toBe('/projetos/p-1/entregas/milestones/m-1')
    expect(global.milestone('m-1', 'issues')).toBe('/projetos/p-1/entregas/milestones/m-1')
    expect(global.milestone('m-1', 'homologacao')).toBe(
      '/projetos/p-1/entregas/milestones/m-1?aba=homologacao',
    )
    expect(global.issue('i-1')).toBe('/projetos/p-1/entregas/issues/i-1')
    expect(global.issue('i-1', 'm-1')).toBe('/projetos/p-1/entregas/issues/i-1?milestone=m-1')

    const cliente = rotasDoProjeto('p-1', { tipo: 'cliente', clienteId: 'c-1' })
    expect(cliente.resumo).toBe('/clientes/c-1/projetos/p-1')
    expect(cliente.entregas).toBe('/clientes/c-1/projetos/p-1/entregas')
    expect(cliente.milestone('m-1', 'homologacao')).toBe(
      '/clientes/c-1/projetos/p-1/entregas/milestones/m-1?aba=homologacao',
    )
    expect(cliente.issue('i-1', 'm-1')).toBe(
      '/clientes/c-1/projetos/p-1/entregas/issues/i-1?milestone=m-1',
    )
  })

  test('trilhasDoProjeto: global com complemento → Projetos › P (/projetos/p-1) › …; cliente → Clientes › Acme › Portal › …', () => {
    const projeto = { id: 'p-1', nome: 'Portal' }
    expect(trilhasDoProjeto(projeto, { tipo: 'global' }, null, { rotulo: 'Configuração' })).toEqual(
      [
        { rotulo: 'Projetos', href: '/projetos' },
        { rotulo: 'Portal', href: '/projetos/p-1' },
        { rotulo: 'Configuração' },
      ],
    )
    expect(
      trilhasDoProjeto(
        projeto,
        { tipo: 'cliente', clienteId: 'c-1' },
        { id: 'c-1', nome: 'Acme' },
        { rotulo: 'Entregas', href: '/clientes/c-1/projetos/p-1/entregas' },
      ),
    ).toEqual([
      { rotulo: 'Clientes', href: '/clientes' },
      { rotulo: 'Acme', href: '/clientes/c-1' },
      { rotulo: 'Portal', href: '/clientes/c-1/projetos/p-1' },
      { rotulo: 'Entregas', href: '/clientes/c-1/projetos/p-1/entregas' },
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
