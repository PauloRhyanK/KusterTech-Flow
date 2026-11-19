import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  arquivoDeCadastroSchema,
  planejarImportacao,
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
