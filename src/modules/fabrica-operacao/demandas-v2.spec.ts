import { describe, expect, test } from 'vitest'
import { proximoPasso, type FotoDaDemandaV2 } from './demandas-v2'

const SHA1 = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)
const PR1 = 'https://github.com/PauloRhyanK/KusterTech-Flow/pull/11'
const PR2 = 'https://github.com/PauloRhyanK/KusterTech-Flow/pull/12'

function foto(extra: Partial<FotoDaDemandaV2> = {}): FotoDaDemandaV2 {
  return {
    marco: 'recebida',
    espera: null,
    encerrada: false,
    tipo: null,
    revisao: { id: 'rev1', numero: 1, triagem: null },
    etapas: [{ chave: 'a', estado: 'pendente', prUrl: null, motivo: null, tentativas: 0 }],
    merges: {},
    parte: {
      chave: 'kustertech-flow',
      repositorio: 'PauloRhyanK/KusterTech-Flow',
      estado: 'PLANEJANDO',
      chegaAoAr: 'PUBLICACAO',
      pedidoId: null,
      commitAlvo: null,
    },
    ultimaTrava: null,
    travasEmitidas: 0,
    ...extra,
  }
}

const feitas = {
  etapas: [
    { chave: 'a', estado: 'mergeada' as const, prUrl: PR1, motivo: null, tentativas: 1 },
    { chave: 'b', estado: 'concluida' as const, prUrl: null, motivo: null, tentativas: 1 },
    { chave: 'c', estado: 'mergeada' as const, prUrl: PR2, motivo: null, tentativas: 1 },
  ],
  merges: {
    [PR1]: { numero: 11, sha: SHA1, em: '2026-11-28T10:00:00Z' },
    [PR2]: { numero: 12, sha: SHA2, em: '2026-11-28T11:00:00Z' },
  },
}

describe('proximoPasso', () => {
  test('encerrada ou sem plano aprovado: nada', () => {
    expect(proximoPasso(foto({ encerrada: true }))).toBeNull()
    expect(proximoPasso(foto({ revisao: null }))).toBeNull()
  })

  test('recebida: triagem para a fila de agentes, com o que o plano trouxer', () => {
    const p = proximoPasso(
      foto({
        tipo: 'defeito',
        revisao: { id: 'rev1', numero: 1, triagem: { risco: 'medio', mexeEm: 'tela de demandas' } },
      }),
    )
    expect(p).toMatchObject({
      tipo: 'evento',
      chave: 'triagem:rev1',
      evento: {
        tipo: 'triagem',
        dados: {
          tipo: 'defeito',
          destino: 'fila_de_agentes',
          risco: 'medio',
          mexeEm: 'tela de demandas',
        },
      },
    })
  })

  test('triagem do plano com valor inválido cai no conservador', () => {
    const p = proximoPasso(
      foto({ revisao: { id: 'rev1', numero: 1, triagem: { risco: 'altíssimo' } } }),
    )
    expect(p).toMatchObject({ evento: { dados: { risco: 'baixo', destino: 'fila_de_agentes' } } })
  })

  test('planejada: plano criado apontando a revisão aprovada', () => {
    expect(proximoPasso(foto({ marco: 'planejada' }))).toMatchObject({
      chave: 'plano:rev1',
      evento: {
        tipo: 'plano_criado',
        dados: { plano: '.fabrica/planos/fabrica-2-rev1-r1.json', prUrl: null },
      },
    })
  })

  test('desenvolvida: espera todas as etapas terminarem bem', () => {
    expect(proximoPasso(foto({ marco: 'desenvolvida' }))).toBeNull()
    expect(
      proximoPasso(
        foto({
          marco: 'desenvolvida',
          ...feitas,
          etapas: [{ ...feitas.etapas[0]!, estado: 'aguardando_gates' }],
        }),
      ),
    ).toBeNull()
  })

  test('desenvolvida: espera o merge aparecer sincronizado', () => {
    expect(
      proximoPasso(
        foto({
          marco: 'desenvolvida',
          ...feitas,
          merges: { ...feitas.merges, [PR2]: { numero: 12, sha: null, em: null } },
        }),
      ),
    ).toBeNull()
  })

  test('desenvolvida: parte feita com o commit do último merge, depois conclui a etapa', () => {
    expect(proximoPasso(foto({ marco: 'desenvolvida', ...feitas }))).toEqual({
      tipo: 'evento',
      chave: 'parte_feita:rev1',
      evento: {
        tipo: 'parte_feita',
        dados: {
          parte: 'kustertech-flow',
          prs: [
            { url: PR1, numero: 11, mergeCommit: SHA1 },
            { url: PR2, numero: 12, mergeCommit: SHA2 },
          ],
          commit: SHA2,
          pendencias: [],
        },
      },
    })
    expect(
      proximoPasso(
        foto({ marco: 'desenvolvida', ...feitas, parte: { ...foto().parte, estado: 'FEITA' } }),
      ),
    ).toMatchObject({
      chave: 'desenvolvida:rev1',
      evento: { tipo: 'etapa_concluida', dados: { marco: 'desenvolvida' } },
    })
  })

  test('desenvolvida sem nenhum PR mergeado (só leitura): trava avisando que não há o que publicar', () => {
    expect(
      proximoPasso(
        foto({
          marco: 'desenvolvida',
          etapas: [{ chave: 'b', estado: 'concluida', prUrl: null, motivo: null, tentativas: 1 }],
        }),
      ),
    ).toMatchObject({
      evento: { tipo: 'travada', dados: { motivo: expect.stringMatching(/sem nenhuma mudança/) } },
    })
  })

  test('entregue: pede publicação na fila só quando a parte chega por publicação', () => {
    const parte = { ...foto().parte, estado: 'FEITA' as const, commitAlvo: SHA2 }
    expect(proximoPasso(foto({ marco: 'entregue', parte }))).toEqual({
      tipo: 'publicar',
      commit: SHA2,
    })
    expect(
      proximoPasso(foto({ marco: 'entregue', parte: { ...parte, pedidoId: 'p1' } })),
    ).toMatchObject({
      chave: 'entregue:rev1',
      evento: { tipo: 'etapa_concluida', dados: { marco: 'entregue' } },
    })
    expect(
      proximoPasso(
        foto({ marco: 'entregue', parte: { ...parte, chegaAoAr: 'VERSAO', estado: 'PUBLICANDO' } }),
      ),
    ).toMatchObject({ evento: { tipo: 'etapa_concluida' } })
  })

  test('no ar: a fila fecha sozinha', () => {
    expect(proximoPasso(foto({ marco: 'no_ar' }))).toBeNull()
  })

  test('etapa bloqueada trava a demanda para o dono; ao destravar, volta', () => {
    const bloqueada = {
      etapas: [
        {
          chave: 'a',
          estado: 'bloqueada' as const,
          prUrl: null,
          motivo: 'verificação falhou 3 vezes',
          tentativas: 4,
        },
      ],
    }
    const trava = proximoPasso(foto({ marco: 'desenvolvida', ...bloqueada }))
    expect(trava).toMatchObject({
      tipo: 'evento',
      chave: 'travada:rev1:1',
      evento: {
        tipo: 'travada',
        dados: { motivo: 'A etapa "a" travou: verificação falhou 3 vezes', url: null },
      },
    })
    expect(
      proximoPasso(foto({ marco: 'desenvolvida', ...bloqueada, espera: 'travada' })),
    ).toBeNull()
    expect(
      proximoPasso(
        foto({
          marco: 'desenvolvida',
          espera: 'travada',
          ultimaTrava: 'travada:rev1:1',
          travasEmitidas: 1,
        }),
      ),
    ).toMatchObject({ chave: 'travada:rev1:1:fim', evento: { tipo: 'destravada', dados: {} } })
  })

  test('trava de novo depois de destravar tem chave nova', () => {
    const b = {
      etapas: [
        { chave: 'a', estado: 'bloqueada' as const, prUrl: null, motivo: 'x', tentativas: 4 },
      ],
    }
    expect(proximoPasso(foto({ marco: 'desenvolvida', ...b, travasEmitidas: 1 }))).toMatchObject({
      chave: 'travada:rev1:2',
    })
  })

  test.each(['desenho', 'testada'])('marco %s (tela) trava avisando o dono', (marco) => {
    expect(proximoPasso(foto({ marco }))).toMatchObject({ evento: { tipo: 'travada' } })
  })

  test.each(['DESCARTADA', 'NAO_CHEGOU'] as const)(
    'parte %s trava em vez de parar em silêncio',
    (estado) => {
      expect(
        proximoPasso(
          foto({ marco: 'desenvolvida', ...feitas, parte: { ...foto().parte, estado } }),
        ),
      ).toMatchObject({
        evento: { tipo: 'travada' },
      })
    },
  )

  test('outra espera (do dono) segura tudo', () => {
    expect(proximoPasso(foto({ espera: 'decidir_destino' }))).toBeNull()
  })
})
