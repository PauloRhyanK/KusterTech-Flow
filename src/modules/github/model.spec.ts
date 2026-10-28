import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { ErroDeIntegracao } from './erros'
import {
  apresentarEstado,
  avaliarEntregaDoWebhook,
  catalogoDevido,
  efeitoDoEvento,
  ESPERA_MAXIMA_MS,
  estadoDoProjeto,
  estadoDoRepositorio,
  issuesReferenciadas,
  limitarCorpo,
  mensagemDeFalha,
  repositorioDevido,
  verificarAssinatura,
  resumirChecks,
  resumirErroParaLog,
  type CategoriaDeFalha,
  type EstadoIntegracao,
  TAMANHO_MAXIMO_CORPO,
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
    'commit-desconhecido',
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
    expect(mensagemDeFalha('commit-desconhecido')).toBe(
      'O GitHub não encontrou um dos commits comparados.',
    )
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

describe('resumirErroParaLog', () => {
  test('erro comum vira só o tipo, sem mensagem nem stack', () => {
    const resumo = resumirErroParaLog(new TypeError('Bearer ghs_segredo-que-nao-pode-vazar'))
    expect(resumo).toEqual({ tipo: 'TypeError' })
    expect(JSON.stringify(resumo)).not.toContain('ghs_segredo')
  })

  test('ErroDeIntegracao leva a categoria; erro com code textual leva o código', () => {
    expect(resumirErroParaLog(new ErroDeIntegracao('rede'))).toEqual({
      tipo: 'ErroDeIntegracao',
      categoria: 'rede',
    })
    const comCodigo = Object.assign(new Error('Unique constraint ghs_segredo'), { code: 'P2002' })
    expect(resumirErroParaLog(comCodigo)).toEqual({ tipo: 'Error', codigo: 'P2002' })
  })

  test('valor que não é Error vira o typeof', () => {
    expect(resumirErroParaLog('ghs_segredo')).toEqual({ tipo: 'string' })
    expect(resumirErroParaLog(null)).toEqual({ tipo: 'object' })
  })
})

describe('limitarCorpo', () => {
  test('limitarCorpo: null → ""; corta no ## Prompt; 25 000 caracteres → 20 000; remove \\u0000', () => {
    expect(limitarCorpo(null)).toBe('')
    expect(limitarCorpo('## Summary\nfeito\n\n## Prompt\nsegredo interno')).toBe(
      '## Summary\nfeito\n\n',
    )
    expect(limitarCorpo('x'.repeat(25_000))).toHaveLength(20_000)
    expect(TAMANHO_MAXIMO_CORPO).toBe(20_000)
    expect(limitarCorpo('a\u0000b')).toBe('ab')
  })
})

describe('webhook do GitHub', () => {
  const segredo = 'segredo-de-teste'
  const assinar = (s: string, c: string | Uint8Array) =>
    'sha256=' + createHmac('sha256', s).update(c).digest('hex')
  const bytes = (t: string) => new TextEncoder().encode(t)
  const HEX_DOC = '757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17'
  const entrega = (evento: string, corpo: string, deliveryId: string | null = 'd-1') => ({
    corpo: bytes(corpo),
    cabecalhos: { assinatura: assinar(segredo, corpo), evento, deliveryId },
  })

  test('verificarAssinatura aceita o vetor da documentação do GitHub', () => {
    const s = "It's a Secret to Everybody"
    const corpo = bytes('Hello, World!')
    expect(verificarAssinatura(s, corpo, `sha256=${HEX_DOC}`)).toBe(true)
    expect(verificarAssinatura(s, corpo, `sha256=${HEX_DOC.toUpperCase()}`)).toBe(true)
  })

  test('verificarAssinatura recusa sem lançar', () => {
    const s = "It's a Secret to Everybody"
    const corpo = bytes('Hello, World!')
    for (const c of [
      null,
      '',
      'sha256=',
      `sha1=${HEX_DOC}`,
      `SHA256=${HEX_DOC}`,
      `sha256=${HEX_DOC.slice(0, 63)}`,
      `sha256=${HEX_DOC.slice(0, 61)}e18`,
      'sha256=' + 'zz'.repeat(32),
    ]) {
      expect(verificarAssinatura(s, corpo, c)).toBe(false)
    }
    expect(verificarAssinatura(s, bytes('Hello, World! '), `sha256=${HEX_DOC}`)).toBe(false)
    expect(verificarAssinatura('outro', corpo, `sha256=${HEX_DOC}`)).toBe(false)
  })

  test('avaliarEntregaDoWebhook: issues assinado → registrar com deliveryId "d-1", evento "issues", repositorioGitHubId BigInt(5001)', () => {
    const { corpo, cabecalhos } = entrega('issues', '{"action":"closed","repository":{"id":5001}}')
    expect(avaliarEntregaDoWebhook(segredo, corpo, cabecalhos)).toEqual({
      tipo: 'registrar',
      deliveryId: 'd-1',
      evento: 'issues',
      repositorioGitHubId: BigInt(5001),
    })
  })

  test('avaliarEntregaDoWebhook: corpo de 1_048_577 bytes assinado → 413 corpo-grande-demais; sem cabeçalho → 401 assinatura-ausente; um dígito trocado → 401 assinatura-invalida', () => {
    const grande = new Uint8Array(1_048_577).fill(32)
    expect(
      avaliarEntregaDoWebhook(segredo, grande, {
        assinatura: assinar(segredo, grande),
        evento: 'issues',
        deliveryId: 'd-1',
      }),
    ).toEqual({ tipo: 'responder', status: 413, resultado: 'corpo-grande-demais' })
    const { corpo, cabecalhos } = entrega('issues', '{}')
    expect(avaliarEntregaDoWebhook(segredo, corpo, { ...cabecalhos, assinatura: null })).toEqual({
      tipo: 'responder',
      status: 401,
      resultado: 'assinatura-ausente',
    })
    const a = cabecalhos.assinatura
    const trocada = a.slice(0, -1) + (a.endsWith('0') ? '1' : '0')
    expect(avaliarEntregaDoWebhook(segredo, corpo, { ...cabecalhos, assinatura: trocada })).toEqual(
      { tipo: 'responder', status: 401, resultado: 'assinatura-invalida' },
    )
  })

  test('avaliarEntregaDoWebhook: deliveryId nulo ou "a b" → 400; ping → 200 pong; "star" → 200 ignorado; corpo "{" assinado → 400 requisicao-invalida; installation sem repository → registrar com repositorioGitHubId null', () => {
    const invalida = { tipo: 'responder', status: 400, resultado: 'requisicao-invalida' }
    for (const id of [null, 'a b']) {
      const { corpo, cabecalhos } = entrega('issues', '{}', id)
      expect(avaliarEntregaDoWebhook(segredo, corpo, cabecalhos)).toEqual(invalida)
    }
    const ping = entrega('ping', '{"zen":"x"}')
    expect(avaliarEntregaDoWebhook(segredo, ping.corpo, ping.cabecalhos)).toEqual({
      tipo: 'responder',
      status: 200,
      resultado: 'pong',
    })
    const star = entrega('star', '{}')
    expect(avaliarEntregaDoWebhook(segredo, star.corpo, star.cabecalhos)).toEqual({
      tipo: 'responder',
      status: 200,
      resultado: 'ignorado',
    })
    const quebrado = entrega('issues', '{')
    expect(avaliarEntregaDoWebhook(segredo, quebrado.corpo, quebrado.cabecalhos)).toEqual(invalida)
    const inst = entrega('installation', '{"action":"created"}')
    expect(avaliarEntregaDoWebhook(segredo, inst.corpo, inst.cabecalhos)).toEqual({
      tipo: 'registrar',
      deliveryId: 'd-1',
      evento: 'installation',
      repositorioGitHubId: null,
    })
  })

  test('efeitoDoEvento: tabela da interface (installation_repositories → solicitar-catalogo; issues de BigInt(5001) vinculado sem falhas → solicitar-sincronizacao; com falhasConsecutivas 2 → nenhum; projetoId null → nenhum; repositório null → solicitar-catalogo; star → nenhum)', () => {
    const vinculado = { projetoId: 'p-1', falhasConsecutivas: 0 }
    expect(efeitoDoEvento('installation_repositories', null, null)).toBe('solicitar-catalogo')
    expect(efeitoDoEvento('installation', null, null)).toBe('solicitar-catalogo')
    expect(efeitoDoEvento('issues', BigInt(5001), vinculado)).toBe('solicitar-sincronizacao')
    expect(efeitoDoEvento('issues', BigInt(5001), { ...vinculado, falhasConsecutivas: 2 })).toBe(
      'nenhum',
    )
    expect(efeitoDoEvento('issues', BigInt(5001), { ...vinculado, projetoId: null })).toBe('nenhum')
    expect(efeitoDoEvento('issues', BigInt(5001), null)).toBe('solicitar-catalogo')
    expect(efeitoDoEvento('issues', null, null)).toBe('nenhum')
    expect(efeitoDoEvento('star', BigInt(5001), vinculado)).toBe('nenhum')
  })

  test('catalogoDevido: sincronizado há 5 min sem solicitação → false; solicitação depois da sincronização → true; solicitação anterior à última falha → false; nunca sincronizado → true', () => {
    const base = {
      catalogoSincronizadoEm: minutosAtras(5),
      ultimaFalhaEm: null,
      catalogoSolicitadoEm: null,
    }
    expect(catalogoDevido(base, agora, INTERVALO)).toBe(false)
    expect(
      catalogoDevido({ ...base, catalogoSolicitadoEm: minutosAtras(1) }, agora, INTERVALO),
    ).toBe(true)
    expect(
      catalogoDevido(
        { ...base, ultimaFalhaEm: minutosAtras(2), catalogoSolicitadoEm: minutosAtras(3) },
        agora,
        INTERVALO,
      ),
    ).toBe(false)
    expect(
      catalogoDevido(
        { catalogoSincronizadoEm: null, ultimaFalhaEm: null, catalogoSolicitadoEm: null },
        agora,
        INTERVALO,
      ),
    ).toBe(true)
  })
})
