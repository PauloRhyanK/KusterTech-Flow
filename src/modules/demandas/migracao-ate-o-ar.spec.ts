import { describe, expect, test } from 'vitest'
import { MODELO_PADRAO } from './model'
import {
  etapasComNoAr,
  MOTIVO_DA_REABERTURA,
  planoDaMigracao,
  type EntradaDaMigracao,
} from './migracao-ate-o-ar'

const ENTREGUE = new Date('2026-11-10T12:00:00.000Z')
const PUBLICADO_EM = new Date('2026-11-10T13:00:00.000Z')
const C1 = '1'.repeat(40)
const C2 = '2'.repeat(40)

function base(extra: Partial<EntradaDaMigracao> = {}): EntradaDaMigracao {
  return {
    id: 'd1',
    repositorio: 'exemplo/alfa-back',
    encerrada: 'entregue',
    entregueEm: ENTREGUE,
    prs: [],
    temPartes: false,
    pedidos: [],
    ...extra,
  }
}

const pedido = (extra: Record<string, unknown> = {}) => ({
  commit: C1,
  estado: 'PUBLICADO',
  conferidoContendo: false,
  criadoEm: new Date('2026-11-10T12:30:00.000Z'),
  concluidoEm: PUBLICADO_EM,
  ...extra,
})

describe('planoDaMigracao', () => {
  test('demanda que já tem partes não muda (idempotência)', () => {
    expect(planoDaMigracao(base({ temPartes: true }))).toBeNull()
  })

  test('entregue com pedido PUBLICADO (mesmo sem conferência) vai a no_ar', () => {
    const plano = planoDaMigracao(base({ pedidos: [pedido({ conferidoContendo: true })] }))!
    expect(plano.partes).toHaveLength(1)
    expect(plano.partes[0]).toMatchObject({
      chave: 'alfa-back',
      repositorio: 'exemplo/alfa-back',
      estado: 'no_ar',
      commitAlvo: C1,
      noArEm: PUBLICADO_EM,
    })
    expect(plano.demanda).toMatchObject({
      encerrada: 'no_ar',
      naoChegouDesde: null,
      espera: null,
      noArEm: PUBLICADO_EM,
    })
    expect(plano.acao).toBe('no_ar')
    expect(plano.historico).toBe('migrada: no ar')
  })

  test('pedido PUBLICADO antes da conferência leva o histórico próprio', () => {
    const plano = planoDaMigracao(base({ pedidos: [pedido({ conferidoContendo: false })] }))!
    expect(plano.historico).toBe('migrada: no ar (publicada antes da conferência)')
    expect(plano.partes[0]!.antesDaConferencia).toBe(true)
  })

  test('pedido PUBLICADO conferido não é "antes da conferência"', () => {
    const plano = planoDaMigracao(base({ pedidos: [pedido({ conferidoContendo: true })] }))!
    expect(plano.partes[0]!.antesDaConferencia).toBe(false)
  })

  test('sem pedido a demanda reabre, travada para o Paulo, com o motivo exato', () => {
    const plano = planoDaMigracao(base())!
    expect(plano.partes[0]).toMatchObject({
      estado: 'nao_chegou',
      motivo: 'Nunca foi publicada',
      commitAlvo: null,
    })
    expect(plano.demanda).toEqual({
      encerrada: null,
      naoChegouDesde: ENTREGUE,
      espera: 'travada',
      esperaMotivo:
        "Entregue antes da regra 'até o ar'. Retomar planeja o que falta; Encerrar fecha sem ir ao ar.",
      noArEm: null,
    })
    expect(MOTIVO_DA_REABERTURA).toBe(plano.demanda.esperaMotivo)
    expect(plano.acao).toBe('reaberta')
  })

  test('uma parte sem publicar reabre a demanda e a publicada já fica no ar', () => {
    const plano = planoDaMigracao(
      base({
        prs: [
          'https://github.com/exemplo/alfa-back/pull/3',
          'https://github.com/exemplo/alfa-crm/pull/9',
        ],
        pedidos: [pedido({ repositorio: 'exemplo/alfa-back' })],
      }),
    )!
    expect(plano.partes.map((p) => [p.chave, p.estado, p.ordem])).toEqual([
      ['alfa-back', 'no_ar', 1],
      ['alfa-crm', 'nao_chegou', 2],
    ])
    expect(plano.acao).toBe('reaberta')
    expect(plano.partes[1]!.prs).toEqual([
      {
        url: 'https://github.com/exemplo/alfa-crm/pull/9',
        repositorio: 'exemplo/alfa-crm',
        numero: 9,
        estado: 'mergeado',
        mergeCommit: null,
      },
    ])
  })

  test('commitAlvo vem do pedido mais recente da parte', () => {
    const plano = planoDaMigracao(
      base({
        pedidos: [
          pedido({ estado: 'FALHOU', commit: C1, criadoEm: new Date('2026-11-10T10:00:00Z') }),
          pedido({ estado: 'RECUSADO', commit: C2, criadoEm: new Date('2026-11-10T11:00:00Z') }),
        ],
      }),
    )!
    expect(plano.partes[0]).toMatchObject({ commitAlvo: C2, estado: 'nao_chegou' })
    expect(plano.acao).toBe('reaberta')
  })

  test('pedido ainda andando deixa a parte publicando', () => {
    const plano = planoDaMigracao(base({ pedidos: [pedido({ estado: 'NA_FILA' })] }))!
    expect(plano.partes[0]).toMatchObject({ estado: 'publicando', motivo: null })
  })

  test('dispensado sem versão conferida não chegou; com versão conferida está no ar', () => {
    const sem = planoDaMigracao(
      base({ pedidos: [pedido({ estado: 'DISPENSADO', conferidoContendo: false })] }),
    )!
    expect(sem.partes[0]).toMatchObject({ estado: 'nao_chegou', motivo: 'Publicação dispensada' })
    const com = planoDaMigracao(
      base({ pedidos: [pedido({ estado: 'DISPENSADO', conferidoContendo: true })] }),
    )!
    expect(com.partes[0]!.estado).toBe('no_ar')
  })

  test('URL de repositório fora do cadastro vai para a parte de entrada', () => {
    const plano = planoDaMigracao(
      base({
        prs: ['https://github.com/exemplo/fora/pull/1'],
        repositoriosCadastrados: ['exemplo/alfa-back'],
      }),
    )!
    expect(plano.partes).toHaveLength(1)
    expect(plano.partes[0]!.prs.map((p) => p.numero)).toEqual([1])
    expect(plano.partes[0]!.prs[0]!.repositorio).toBe('exemplo/fora')
  })

  test('URL do mesmo repositório da entrada e URL inválida não criam parte', () => {
    const plano = planoDaMigracao(
      base({
        prs: ['https://github.com/Exemplo/Alfa-Back/pull/4', 'https://exemplo.com/x'],
      }),
    )!
    expect(plano.partes).toHaveLength(1)
    expect(plano.partes[0]!.prs).toHaveLength(1)
  })

  test('chave repetida ganha o dono no sufixo', () => {
    const plano = planoDaMigracao(base({ prs: ['https://github.com/outro/alfa-back/pull/2'] }))!
    expect(plano.partes.map((p) => p.chave)).toEqual(['alfa-back', 'alfa-back-outro'])
  })

  test.each(['descartada', 'orientada'] as const)(
    '%s só ganha a parte, descartada',
    (encerrada) => {
      const plano = planoDaMigracao(base({ encerrada }))!
      expect(plano.partes).toHaveLength(1)
      expect(plano.partes[0]!.estado).toBe('descartada')
      expect(plano.acao).toBe('so_partes')
      expect(plano.demanda).toMatchObject({ encerrada, espera: null, naoChegouDesde: null })
    },
  )

  test('demanda em andamento ganha a parte de entrada e segue', () => {
    const a = planoDaMigracao(base({ encerrada: null, entregueEm: null }))!
    expect(a.partes[0]!.estado).toBe('planejando')
    const b = planoDaMigracao(base({ encerrada: null, entregueEm: null, temPlano: true }))!
    expect(b.partes[0]!.estado).toBe('em_curso')
    expect(b.acao).toBe('so_partes')
    expect(b.demanda).toMatchObject({ encerrada: null, espera: null })
  })
})

describe('etapasComNoAr', () => {
  const antigas = MODELO_PADRAO.filter((e) => e.marco !== 'no_ar')

  test('acrescenta a etapa no fim', () => {
    const r = etapasComNoAr(antigas)
    expect(r).toHaveLength(antigas.length + 1)
    expect(r[r.length - 1]).toMatchObject({ chave: 'no_ar', marco: 'no_ar', quemConclui: 'flow' })
  })

  test('é idempotente', () => {
    const uma = etapasComNoAr(antigas)
    expect(etapasComNoAr(uma)).toEqual(uma)
  })
})
