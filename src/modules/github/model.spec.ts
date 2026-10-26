import { describe, expect, test } from 'vitest'
import { ErroDeIntegracao } from './erros'
import {
  apresentarEstado,
  ESPERA_MAXIMA_MS,
  estadoDoProjeto,
  estadoDoRepositorio,
  issuesReferenciadas,
  mensagemDeFalha,
  repositorioDevido,
  resumirChecks,
  type CategoriaDeFalha,
  type EstadoIntegracao,
  type SituacaoDoRepositorio,
} from './model'

const INTERVALO = 600_000
const agora = new Date('2026-10-26T15:00:00.000Z')
const minutosAtras = (m: number) => new Date(agora.getTime() - m * 60_000)

const situacao = (parcial: Partial<SituacaoDoRepositorio> = {}): SituacaoDoRepositorio => ({
  sincronizadoEm: minutosAtras(5),
  ultimaFalhaEm: null,
  removidoDaInstalacaoEm: null,
  ...parcial,
})

describe('estadoDoRepositorio', () => {
  test('sincronizado há 5 min → conectada', () => {
    expect(estadoDoRepositorio(situacao(), agora, INTERVALO)).toBe('conectada')
  })

  test('sincronizado há 31 min → sem-dados-recentes', () => {
    expect(
      estadoDoRepositorio(situacao({ sincronizadoEm: minutosAtras(31) }), agora, INTERVALO),
    ).toBe('sem-dados-recentes')
  })

  test('sincronizado há exatamente 30 min ainda é conectada', () => {
    expect(
      estadoDoRepositorio(situacao({ sincronizadoEm: minutosAtras(30) }), agora, INTERVALO),
    ).toBe('conectada')
  })

  test('falha depois do sucesso → indisponivel', () => {
    expect(
      estadoDoRepositorio(
        situacao({ sincronizadoEm: minutosAtras(10), ultimaFalhaEm: minutosAtras(2) }),
        agora,
        INTERVALO,
      ),
    ).toBe('indisponivel')
  })

  test('falha antiga, anterior ao último sucesso → não conta', () => {
    expect(
      estadoDoRepositorio(
        situacao({ sincronizadoEm: minutosAtras(2), ultimaFalhaEm: minutosAtras(10) }),
        agora,
        INTERVALO,
      ),
    ).toBe('conectada')
  })

  test('nunca sincronizado com falha → indisponivel', () => {
    expect(
      estadoDoRepositorio(
        situacao({ sincronizadoEm: null, ultimaFalhaEm: minutosAtras(1) }),
        agora,
        INTERVALO,
      ),
    ).toBe('indisponivel')
  })

  test('removido da instalação → indisponivel', () => {
    expect(
      estadoDoRepositorio(situacao({ removidoDaInstalacaoEm: minutosAtras(1) }), agora, INTERVALO),
    ).toBe('indisponivel')
  })

  test('nunca sincronizado e sem falha → sem-dados-recentes', () => {
    expect(estadoDoRepositorio(situacao({ sincronizadoEm: null }), agora, INTERVALO)).toBe(
      'sem-dados-recentes',
    )
  })
})

describe('estadoDoProjeto', () => {
  test('sem repositórios ou integração não configurada → nao-configurada', () => {
    expect(estadoDoProjeto([], true, agora, INTERVALO)).toBe('nao-configurada')
    expect(estadoDoProjeto([situacao()], false, agora, INTERVALO)).toBe('nao-configurada')
  })

  test('um conectado e um indisponível → indisponivel', () => {
    expect(
      estadoDoProjeto(
        [situacao(), situacao({ removidoDaInstalacaoEm: minutosAtras(1) })],
        true,
        agora,
        INTERVALO,
      ),
    ).toBe('indisponivel')
  })

  test('conectado e sem dados recentes → sem-dados-recentes; todos conectados → conectada', () => {
    expect(
      estadoDoProjeto(
        [situacao(), situacao({ sincronizadoEm: minutosAtras(40) })],
        true,
        agora,
        INTERVALO,
      ),
    ).toBe('sem-dados-recentes')
    expect(estadoDoProjeto([situacao(), situacao()], true, agora, INTERVALO)).toBe('conectada')
  })
})

describe('apresentarEstado', () => {
  test('textos e tons; nao-configurada e sem-dados-recentes nunca têm tom sucesso', () => {
    expect(apresentarEstado('conectada')).toEqual({ texto: 'Conectada', tom: 'sucesso' })
    expect(apresentarEstado('indisponivel')).toEqual({ texto: 'Indisponível', tom: 'erro' })
    const demais: EstadoIntegracao[] = ['nao-configurada', 'sem-dados-recentes']
    for (const e of demais) {
      expect(apresentarEstado(e).tom).not.toBe('sucesso')
    }
    expect(apresentarEstado('nao-configurada')).toEqual({ texto: 'Não configurada', tom: 'neutro' })
    expect(apresentarEstado('sem-dados-recentes')).toEqual({
      texto: 'Sem dados recentes',
      tom: 'atencao',
    })
  })
})

describe('resumirChecks', () => {
  const ok = { status: 'completed', conclusao: 'success' }

  test('[] → SEM_CHECKS', () => {
    expect(resumirChecks([])).toBe('SEM_CHECKS')
  })

  test('success + skipped (+ neutral) → SUCESSO', () => {
    expect(
      resumirChecks([
        ok,
        { status: 'completed', conclusao: 'skipped' },
        { status: 'completed', conclusao: 'neutral' },
      ]),
    ).toBe('SUCESSO')
  })

  test('um in_progress → PENDENTE', () => {
    expect(resumirChecks([ok, { status: 'in_progress', conclusao: null }])).toBe('PENDENTE')
  })

  test('um timed_out entre successes → FALHA', () => {
    expect(resumirChecks([ok, { status: 'completed', conclusao: 'timed_out' }, ok])).toBe('FALHA')
  })

  test('falha prevalece sobre pendente', () => {
    expect(
      resumirChecks([
        { status: 'queued', conclusao: null },
        { status: 'completed', conclusao: 'failure' },
      ]),
    ).toBe('FALHA')
  })

  test.each(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'])(
    'conclusão %s → FALHA',
    (conclusao) => {
      expect(resumirChecks([{ status: 'completed', conclusao }])).toBe('FALHA')
    },
  )
})

describe('issuesReferenciadas', () => {
  test('"Closes #2, fixes #10 e resolve #2" → [2, 10]', () => {
    expect(issuesReferenciadas('Closes #2, fixes #10 e resolve #2')).toEqual([2, 10])
  })

  test('outro repositório e número sem palavra-chave são ignorados', () => {
    expect(issuesReferenciadas('fixes outro/repo#3')).toEqual([])
    expect(issuesReferenciadas('#4 sem palavra')).toEqual([])
  })

  test('null e vazio → []', () => {
    expect(issuesReferenciadas(null)).toEqual([])
    expect(issuesReferenciadas('')).toEqual([])
  })

  test('variações de palavra-chave, sem diferenciar maiúsculas, em ordem crescente', () => {
    expect(
      issuesReferenciadas(
        'FIXED #9\nResolved #3\ncloses #7\nfix #1\nresolves #5\nclose #8\nfixes #6\nclosed #4',
      ),
    ).toEqual([1, 3, 4, 5, 6, 7, 8, 9])
  })

  test('palavra-chave embutida em outra palavra não conta', () => {
    expect(issuesReferenciadas('prefixes #3 e disclose #4')).toEqual([])
  })
})

describe('repositorioDevido', () => {
  const base = {
    sincronizadoEm: minutosAtras(1) as Date | null,
    ultimaFalhaEm: null as Date | null,
    sincronizacaoSolicitadaEm: null as Date | null,
    falhasConsecutivas: 0,
  }

  test('nunca sincronizado → true', () => {
    expect(repositorioDevido({ ...base, sincronizadoEm: null }, agora, INTERVALO)).toBe(true)
  })

  test('em dia → false; passado o intervalo → true', () => {
    expect(repositorioDevido(base, agora, INTERVALO)).toBe(false)
    expect(repositorioDevido({ ...base, sincronizadoEm: minutosAtras(10) }, agora, INTERVALO)).toBe(
      true,
    )
  })

  test('solicitação posterior à sincronização → true; anterior → false', () => {
    expect(
      repositorioDevido(
        { ...base, sincronizacaoSolicitadaEm: minutosAtras(0.5) },
        agora,
        INTERVALO,
      ),
    ).toBe(true)
    expect(
      repositorioDevido({ ...base, sincronizacaoSolicitadaEm: minutosAtras(2) }, agora, INTERVALO),
    ).toBe(false)
  })

  test('solicitação anterior à última falha não fura a espera', () => {
    expect(
      repositorioDevido(
        {
          ...base,
          sincronizadoEm: minutosAtras(60),
          ultimaFalhaEm: minutosAtras(1),
          sincronizacaoSolicitadaEm: minutosAtras(2),
          falhasConsecutivas: 1,
        },
        agora,
        INTERVALO,
      ),
    ).toBe(false)
  })

  test('3 falhas → espera 4 × intervalo (40 min)', () => {
    const f = { ...base, sincronizadoEm: minutosAtras(120), falhasConsecutivas: 3 }
    expect(repositorioDevido({ ...f, ultimaFalhaEm: minutosAtras(39) }, agora, INTERVALO)).toBe(
      false,
    )
    expect(repositorioDevido({ ...f, ultimaFalhaEm: minutosAtras(40) }, agora, INTERVALO)).toBe(
      true,
    )
  })

  test('1ª falha espera 1 × intervalo', () => {
    const f = { ...base, sincronizadoEm: minutosAtras(120), falhasConsecutivas: 1 }
    expect(repositorioDevido({ ...f, ultimaFalhaEm: minutosAtras(9) }, agora, INTERVALO)).toBe(
      false,
    )
    expect(repositorioDevido({ ...f, ultimaFalhaEm: minutosAtras(10) }, agora, INTERVALO)).toBe(
      true,
    )
  })

  test('espera limitada a 6 h', () => {
    expect(ESPERA_MAXIMA_MS).toBe(6 * 60 * 60_000)
    const f = { ...base, sincronizadoEm: minutosAtras(2000), falhasConsecutivas: 30 }
    expect(repositorioDevido({ ...f, ultimaFalhaEm: minutosAtras(359) }, agora, INTERVALO)).toBe(
      false,
    )
    expect(repositorioDevido({ ...f, ultimaFalhaEm: minutosAtras(360) }, agora, INTERVALO)).toBe(
      true,
    )
  })

  test('falha sem sincronização anterior respeita a espera', () => {
    expect(
      repositorioDevido(
        { ...base, sincronizadoEm: null, ultimaFalhaEm: minutosAtras(1), falhasConsecutivas: 1 },
        agora,
        INTERVALO,
      ),
    ).toBe(false)
  })
})

describe('mensagemDeFalha e ErroDeIntegracao', () => {
  const categorias: CategoriaDeFalha[] = [
    'autenticacao',
    'limite',
    'rede',
    'sem-acesso',
    'resposta-invalida',
    'desconhecida',
  ]

  test('textos fixos', () => {
    expect(mensagemDeFalha('autenticacao')).toBe('A GitHub App recusou as credenciais.')
    expect(mensagemDeFalha('limite')).toBe(
      'Limite de requisições do GitHub atingido; nova tentativa automática.',
    )
    expect(mensagemDeFalha('rede')).toBe('Não foi possível falar com o GitHub.')
    expect(mensagemDeFalha('sem-acesso')).toBe('A Central não tem mais acesso a este repositório.')
    expect(mensagemDeFalha('resposta-invalida')).toBe('O GitHub respondeu em formato inesperado.')
    expect(mensagemDeFalha('desconhecida')).toBe('Falha inesperada na sincronização.')
  })

  test('ErroDeIntegracao.message nunca repete o texto do erro original', () => {
    for (const c of categorias) {
      const erro = new ErroDeIntegracao(c)
      expect(erro.message).toBe(mensagemDeFalha(c))
      expect(erro.categoria).toBe(c)
      expect(erro.message).not.toContain('ghs_segredo')
    }
  })

  test('tentarApos é preservado', () => {
    const quando = new Date('2026-10-26T16:00:00.000Z')
    expect(new ErroDeIntegracao('limite', quando).tentarApos).toBe(quando)
    expect(new ErroDeIntegracao('rede').tentarApos).toBeUndefined()
  })
})
