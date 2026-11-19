import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  arquivoDeCadastroSchema,
  AVISO_DE_IMPORTACAO_INTERROMPIDA,
  planejarImportacao,
  relatorioDaImportacao,
  type ArquivoDeCadastro,
  type EstadoAtual,
} from './model'

const vazio: EstadoAtual = { clientes: [], projetos: [], maquinas: [], repositoriosCatalogados: [] }

function arquivo(parcial: z.input<typeof arquivoDeCadastroSchema>): ArquivoDeCadastro {
  return arquivoDeCadastroSchema.parse(parcial)
}

const completo = arquivo({
  clientes: [{ nome: 'Cliente Um' }],
  projetos: [
    {
      nome: 'Projeto Alfa',
      clientes: ['Cliente Um'],
      repositorios: ['dono/alfa'],
      descricao: null,
    },
  ],
  maquinas: [
    {
      nome: 'Container A',
      tipo: 'CONTAINER',
      hospedadaEm: 'Servidor A',
      projetos: ['Projeto Alfa'],
    },
    { nome: 'Servidor A', tipo: 'SERVIDOR', projetos: [] },
  ],
})

const comCatalogo: EstadoAtual = {
  ...vazio,
  repositoriosCatalogados: [{ id: 'r1', nomeCompleto: 'dono/alfa', projetoId: null }],
}

describe('planejarImportacao', () => {
  it('banco vazio: cria tudo e associa, na ordem clientes, projetos, vínculos, máquinas', () => {
    const plano = planejarImportacao(completo, comCatalogo)
    expect(plano.erros).toEqual([])
    expect(plano.acoes.map((a) => a.tipo)).toEqual([
      'criar-cliente',
      'criar-projeto',
      'associar-cliente',
      'vincular-repositorio',
      'criar-maquina',
      'criar-maquina',
      'associar-maquina',
    ])
    const maquinas = plano.acoes.filter((a) => a.tipo === 'criar-maquina')
    expect(maquinas.map((a) => ('nome' in a ? a.nome : null))).toEqual([
      'Servidor A',
      'Container A',
    ])
  })

  it('rodar sobre o próprio resultado dá só ações de atualizar e nenhum vínculo novo', () => {
    const depois: EstadoAtual = {
      clientes: [{ id: 'c1', nomeNormalizado: 'cliente um' }],
      projetos: [
        {
          id: 'p1',
          nomeNormalizado: 'projeto alfa',
          clientes: ['c1'],
          repositorios: ['dono/alfa'],
        },
      ],
      maquinas: [
        { id: 'm1', nomeNormalizado: 'servidor a', projetos: [] },
        { id: 'm2', nomeNormalizado: 'container a', projetos: ['p1'] },
      ],
      repositoriosCatalogados: [{ id: 'r1', nomeCompleto: 'dono/alfa', projetoId: 'p1' }],
    }
    const plano = planejarImportacao(completo, depois)
    expect(plano.erros).toEqual([])
    expect(plano.acoes.length).toBe(4)
    expect(plano.acoes.every((a) => a.tipo.startsWith('atualizar'))).toBe(true)
  })

  it('"Projéto  ALFA" casa com "projeto alfa" já existente e vira atualizar', () => {
    const plano = planejarImportacao(arquivo({ projetos: [{ nome: 'Projéto  ALFA' }] }), {
      ...vazio,
      projetos: [{ id: 'p1', nomeNormalizado: 'projeto alfa', clientes: [], repositorios: [] }],
    })
    expect(plano.acoes).toEqual([{ tipo: 'atualizar-projeto', nome: 'Projéto  ALFA' }])
  })

  it('repositório não catalogado entra em repositoriosPendentes e não gera ação', () => {
    const plano = planejarImportacao(
      arquivo({ projetos: [{ nome: 'P', repositorios: ['dono/novo'] }] }),
      vazio,
    )
    expect(plano.repositoriosPendentes).toEqual(['dono/novo'])
    expect(plano.acoes.map((a) => a.tipo)).toEqual(['criar-projeto'])
  })

  it('repositório vinculado a outro projeto é erro', () => {
    const plano = planejarImportacao(
      arquivo({ projetos: [{ nome: 'P', repositorios: ['dono/alfa'] }] }),
      {
        ...vazio,
        repositoriosCatalogados: [{ id: 'r1', nomeCompleto: 'dono/alfa', projetoId: 'outro' }],
      },
    )
    expect(plano.erros).toHaveLength(1)
  })

  it('projeto que cita cliente inexistente é erro', () => {
    const plano = planejarImportacao(
      arquivo({ projetos: [{ nome: 'P', clientes: ['Fantasma'] }] }),
      vazio,
    )
    expect(plano.erros).toHaveLength(1)
  })

  it('dois clientes do arquivo com o mesmo nome normalizado é erro', () => {
    const plano = planejarImportacao(
      arquivo({ clientes: [{ nome: 'Acme' }, { nome: ' ACMÉ ' }] }),
      vazio,
    )
    expect(plano.erros).toHaveLength(1)
  })

  it('máquina hospedada em máquina que não existe é erro', () => {
    const plano = planejarImportacao(
      arquivo({ maquinas: [{ nome: 'M', tipo: 'CONTAINER', hospedadaEm: 'Nada' }] }),
      vazio,
    )
    expect(plano.erros).toHaveLength(1)
  })

  it('máquina que cita projeto inexistente é erro', () => {
    const plano = planejarImportacao(
      arquivo({ maquinas: [{ nome: 'M', tipo: 'SERVIDOR', projetos: ['Nada'] }] }),
      vazio,
    )
    expect(plano.erros).toHaveLength(1)
  })

  it('o que está no banco e fora do arquivo não gera ação', () => {
    const plano = planejarImportacao(arquivo({}), {
      clientes: [{ id: 'c1', nomeNormalizado: 'velho' }],
      projetos: [{ id: 'p1', nomeNormalizado: 'velho', clientes: [], repositorios: [] }],
      maquinas: [{ id: 'm1', nomeNormalizado: 'velha', projetos: [] }],
      repositoriosCatalogados: [],
    })
    expect(plano).toEqual({ acoes: [], repositoriosPendentes: [], erros: [] })
  })
})

describe('arquivoDeCadastroSchema', () => {
  it.each([
    ['cliente', { clientes: [{ nome: '   ' }] }],
    ['projeto', { projetos: [{ nome: ' \t ' }] }],
    ['máquina', { maquinas: [{ nome: '  ', tipo: 'SERVIDOR' }] }],
    ['cliente do projeto', { projetos: [{ nome: 'P', clientes: ['  '] }] }],
    ['repositório do projeto', { projetos: [{ nome: 'P', repositorios: [' '] }] }],
    ['projeto da máquina', { maquinas: [{ nome: 'M', tipo: 'SERVIDOR', projetos: ['   '] }] }],
  ])('recusa nome só com espaços: %s', (_rotulo, entrada) => {
    expect(arquivoDeCadastroSchema.safeParse(entrada).success).toBe(false)
  })

  it('aceita nomes com espaços nas pontas e os apara', () => {
    const lido = arquivoDeCadastroSchema.parse({
      clientes: [{ nome: '  Cliente Um ' }],
      projetos: [{ nome: ' P ', clientes: [' Cliente Um'] }],
    })
    expect(lido.clientes[0]?.nome).toBe('Cliente Um')
    expect(lido.projetos[0]).toMatchObject({ nome: 'P', clientes: ['Cliente Um'] })
  })
})

describe('relatorioDaImportacao', () => {
  it('sem erros: contagens por tipo de ação e repositórios pendentes', () => {
    const plano = planejarImportacao(completo, vazio)
    const { saida, erros } = relatorioDaImportacao(plano, false)
    expect(saida[0]).toBe('Importação:')
    expect(saida).toContain('  Clientes a criar: 1')
    expect(saida).toContain('Ainda não visíveis para a GitHub App:')
    expect(saida).toContain('  - dono/alfa')
    expect(erros).toEqual([])
  })

  it('simulação avisa que nada foi gravado', () => {
    const plano = planejarImportacao(completo, comCatalogo)
    expect(relatorioDaImportacao(plano, true).saida[0]).toBe('Simulação (nada foi gravado):')
  })

  it('com erros: só os erros, sem contagens de ações', () => {
    const plano = planejarImportacao(
      arquivo({ clientes: [{ nome: 'Um' }], projetos: [{ nome: 'P', clientes: ['Fantasma'] }] }),
      vazio,
    )
    expect(plano.acoes.length).toBeGreaterThan(0)
    const { saida, erros } = relatorioDaImportacao(plano, false)
    expect(saida).toEqual([])
    expect(erros[0]).toBe('Erros (nada foi gravado):')
    expect(erros.slice(1)).toEqual(plano.erros.map((e) => `  - ${e}`))
  })

  it('o aviso de interrupção diz que parte pode ter sido gravada', () => {
    expect(AVISO_DE_IMPORTACAO_INTERROMPIDA).toBe(
      'Importação interrompida; parte pode ter sido gravada. Rode de novo para completar.',
    )
  })
})
