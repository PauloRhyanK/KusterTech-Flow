import { describe, expect, test } from 'vitest'
import {
  contasEsgotadas,
  decidirGravacaoDoRetrato,
  extrairTokenDaFabrica,
  hashDoTokenDaFabrica,
  LIMITE_DO_CORPO_DO_RETRATO,
  minutosDeAtraso,
  planosEmCurso,
  PREFIXO_DO_TOKEN_DA_FABRICA,
  resolvidasNaSemana,
  resumirPlano,
  retratoDesatualizado,
  rotuloDoExecutor,
  validarNomeDaFonteDaFabrica,
} from './model'
import type { ExecucaoV2, RetratoV1, RetratoV2 } from './contrato'

const AGORA = new Date('2026-11-03T12:00:00Z')
const em = (iso: string): Date => new Date(iso)

describe('fabrica / model', () => {
  test('o limite do corpo é 256 KB e o prefixo do token é ff_', () => {
    expect(LIMITE_DO_CORPO_DO_RETRATO).toBe(262_144)
    expect(PREFIXO_DO_TOKEN_DA_FABRICA).toBe('ff_')
  })

  test('hash do token é SHA-256 em hexadecimal, estável e diferente do token', () => {
    const h = hashDoTokenDaFabrica('ff_abc')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).toBe(hashDoTokenDaFabrica('ff_abc'))
    expect(h).not.toBe(hashDoTokenDaFabrica('ff_abd'))
  })

  test('extrai o token do cabeçalho Bearer', () => {
    expect(extrairTokenDaFabrica('Bearer ff_x')).toBe('ff_x')
    expect(extrairTokenDaFabrica('bearer ff_x')).toBe('ff_x')
    expect(extrairTokenDaFabrica(null)).toBeNull()
    expect(extrairTokenDaFabrica('')).toBeNull()
    expect(extrairTokenDaFabrica('Basic ff_x')).toBeNull()
    expect(extrairTokenDaFabrica('Bearer a b')).toBeNull()
  })

  test('sem retrato guardado, grava', () => {
    expect(decidirGravacaoDoRetrato(null, em('2026-11-03T11:59:00Z'), AGORA)).toBe('gravar')
  })

  test('retrato mais novo ou igual ao guardado, grava', () => {
    const guardado = em('2026-11-03T11:00:00Z')
    expect(decidirGravacaoDoRetrato(guardado, em('2026-11-03T11:01:00Z'), AGORA)).toBe('gravar')
    expect(decidirGravacaoDoRetrato(guardado, guardado, AGORA)).toBe('gravar')
  })

  test('retrato mais antigo que o guardado é descartado', () => {
    const guardado = em('2026-11-03T11:00:00Z')
    expect(decidirGravacaoDoRetrato(guardado, em('2026-11-03T10:59:59Z'), AGORA)).toBe('descartar')
  })

  test('geradoEm até 5 min no futuro é aceito; além disso é recusado', () => {
    expect(decidirGravacaoDoRetrato(null, em('2026-11-03T12:05:00Z'), AGORA)).toBe('gravar')
    expect(decidirGravacaoDoRetrato(null, em('2026-11-03T12:05:01Z'), AGORA)).toBe('futuro')
  })

  test('o futuro é recusado mesmo quando seria descartado por ser antigo', () => {
    const guardado = em('2026-11-03T13:00:00Z')
    expect(decidirGravacaoDoRetrato(guardado, em('2026-11-03T12:10:00Z'), AGORA)).toBe('futuro')
  })

  test('valida o nome da fonte', () => {
    expect(validarNomeDaFonteDaFabrica('  Máquina de agentes ')).toEqual({
      ok: true,
      nome: 'Máquina de agentes',
    })
    expect(validarNomeDaFonteDaFabrica('   ').ok).toBe(false)
    expect(validarNomeDaFonteDaFabrica('x'.repeat(81)).ok).toBe(false)
    expect(validarNomeDaFonteDaFabrica('x'.repeat(80)).ok).toBe(true)
  })

  test('o retrato fica desatualizado só depois de 5 min desde o recebimento', () => {
    expect(retratoDesatualizado(em('2026-11-03T11:56:00Z'), AGORA)).toBe(false)
    expect(retratoDesatualizado(em('2026-11-03T11:55:00Z'), AGORA)).toBe(false)
    expect(retratoDesatualizado(em('2026-11-03T11:54:59Z'), AGORA)).toBe(true)
  })

  test('a idade do retrato é contada em minutos inteiros e nunca fica negativa', () => {
    expect(minutosDeAtraso(em('2026-11-03T11:58:30Z'), AGORA)).toBe(1)
    expect(minutosDeAtraso(em('2026-11-03T11:53:00Z'), AGORA)).toBe(7)
    expect(minutosDeAtraso(em('2026-11-03T12:01:00Z'), AGORA)).toBe(0)
  })
})

type PlanoDoRetrato = RetratoV1['planos'][number]
type EstadoDaRaia = PlanoDoRetrato['fases'][number]['raias'][number]['estado']

const fase = (id: string, raias: EstadoDaRaia[]): PlanoDoRetrato['fases'][number] => ({
  id,
  raias: raias.map((estado, i) => ({ id: `${id}-r${i}`, estado })),
})

function plano(sobrepor: Partial<PlanoDoRetrato> = {}): PlanoDoRetrato {
  return {
    id: 'p1',
    repo: 'kustertech-exemplo/automacao',
    feature: 'Exemplo',
    estado: 'ativo',
    entrouEm: '2026-11-03T10:00:00Z',
    faseAtual: null,
    fases: [],
    pausado: null,
    decisoes: [],
    orquestradorAtivo: true,
    ...sobrepor,
  }
}

describe('fabrica / resumo dos planos', () => {
  test('resumirPlano soma as raias de todas as fases', () => {
    const r = resumirPlano(
      plano({
        fases: [
          fase('f1', ['concluida', 'concluida']),
          fase('f2', ['executando', 'falhou', 'planejada']),
        ],
        faseAtual: 'f2',
        decisoes: [{ titulo: 'a', url: 'https://github.com/x/y/issues/1' }],
        pausado: 'sem vaga',
      }),
    )
    expect(r.raias).toEqual({ concluidas: 2, executando: 1, falharam: 1, planejadas: 1, total: 5 })
    expect(r.indiceDaFase).toBe(2)
    expect(r.totalDeFases).toBe(2)
    expect(r.decisoes).toBe(1)
    expect(r.pausado).toBe('sem vaga')
    expect(r.id).toBe('p1')
    expect(r.estado).toBe('ativo')
  })

  test('faseAtual que não existe nas fases dá índice nulo', () => {
    expect(
      resumirPlano(plano({ fases: [fase('f1', [])], faseAtual: 'zzz' })).indiceDaFase,
    ).toBeNull()
    expect(
      resumirPlano(plano({ fases: [fase('f1', [])], faseAtual: null })).indiceDaFase,
    ).toBeNull()
  })

  test('planosEmCurso deixa de fora concluido e removido, e ordena ativo, admitindo, pausado, aguardando', () => {
    const retrato = {
      planos: [
        plano({ id: 'a', estado: 'aguardando', entrouEm: '2026-11-03T09:00:00Z' }),
        plano({ id: 'c', estado: 'concluido' }),
        plano({ id: 'p', estado: 'pausado' }),
        plano({ id: 'r', estado: 'removido' }),
        plano({ id: 'x2', estado: 'ativo', entrouEm: '2026-11-03T11:00:00Z' }),
        plano({ id: 'd', estado: 'admitindo' }),
        plano({ id: 'x1', estado: 'ativo', entrouEm: '2026-11-03T08:00:00Z' }),
      ],
    } as RetratoV1
    expect(planosEmCurso(retrato).map((p) => p.id)).toEqual(['x1', 'x2', 'd', 'p', 'a'])
  })
})

describe('fabrica / executor e contas', () => {
  const exec = (agente: string | null, conta: string | null) => ({ agente, conta }) as ExecucaoV2

  test('rotuloDoExecutor nomeia o executor e marca a conta reserva', () => {
    expect(rotuloDoExecutor(exec('claude-code', 'claude-principal'))).toBe('Claude')
    expect(rotuloDoExecutor(exec('claude-code', null))).toBe('Claude')
    expect(rotuloDoExecutor(exec('claude-code', 'claude-reserva'))).toBe('Claude · reserva')
    expect(rotuloDoExecutor(exec('codex', 'codex-principal'))).toBe('Codex')
    expect(rotuloDoExecutor(exec('antigravity', null))).toBe('Antigravity')
  })

  test('rotuloDoExecutor devolve null sem agente', () => {
    expect(rotuloDoExecutor(exec(null, 'claude-principal'))).toBeNull()
    expect(rotuloDoExecutor({} as ExecucaoV2)).toBeNull()
  })

  test('contasEsgotadas lista só as contas com prazo no futuro', () => {
    const r = {
      contas: [
        { agente: 'claude-code', conta: 'claude-principal', esgotadaAte: '2026-11-03T13:00:00Z' },
        { agente: 'claude-code', conta: 'claude-reserva', esgotadaAte: '2026-11-03T11:59:00Z' },
        { agente: 'codex', conta: 'codex-principal', esgotadaAte: null },
      ],
    } as RetratoV2
    expect(contasEsgotadas(r, AGORA)).toEqual([
      { rotulo: 'Claude', ate: new Date('2026-11-03T13:00:00Z') },
    ])
  })

  test('contasEsgotadas sem o campo contas devolve vazio', () => {
    expect(contasEsgotadas({} as RetratoV2, AGORA)).toEqual([])
  })
})

describe('resolvidasNaSemana', () => {
  const agora = new Date('2026-11-26T12:00:00Z')
  const em = (iso: string) => ({ em: iso })

  test('conta só as arbitragens dos últimos 7 dias; sem o campo, zero', () => {
    expect(resolvidasNaSemana(undefined, agora)).toBe(0)
    expect(
      resolvidasNaSemana(
        [em('2026-11-26T11:00:00Z'), em('2026-11-19T12:00:01Z'), em('2026-11-19T11:59:59Z')],
        agora,
      ),
    ).toBe(2)
  })
})
