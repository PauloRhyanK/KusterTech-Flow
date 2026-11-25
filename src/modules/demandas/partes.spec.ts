import { describe, expect, test } from 'vitest'
import {
  MOTIVOS,
  acumularPrs,
  fraseDaDemanda,
  grupoAteOAr,
  trilhoAteOAr,
  nuncaPublicada,
  planejarMudancas,
  podeComecar,
  podePublicar,
  resultadoDoPedido,
  todasNoAr,
  validarPartes,
  type EstadoDaParte,
  type Parte,
  type ParteDeclarada,
  type PrDaParte,
} from './partes'

function decl(chave: string, extra: Partial<ParteDeclarada> = {}): ParteDeclarada {
  return {
    chave,
    repositorio: 'exemplo/alfa-' + chave,
    objetivo: 'Objetivo ' + chave,
    ordem: 1,
    dependeDe: [],
    chegaAoAr: 'publicacao',
    ...extra,
  }
}

function parte(chave: string, extra: Partial<Parte> = {}): Parte {
  return {
    ...decl(chave),
    estado: 'em_curso',
    prs: [],
    commitAlvo: null,
    commitNoAr: null,
    motivo: null,
    feitaEm: null,
    noArEm: null,
    temPedido: false,
    ...extra,
  }
}

function pr(
  url: string,
  estado: PrDaParte['estado'],
  mergeCommit: string | null = null,
): PrDaParte {
  return { url, repositorio: 'exemplo/alfa-back', numero: 1, estado, mergeCommit }
}

describe('validarPartes', () => {
  test('chave repetida', () => {
    expect(validarPartes([decl('back'), decl('back'), decl('alfa-crm')], 'alfa-crm')).toEqual([
      'chave repetida: back',
    ])
  })
  test('ciclo', () => {
    const erros = validarPartes(
      [decl('back', { dependeDe: ['front'] }), decl('front', { dependeDe: ['back'] })],
      'back',
    )
    expect(erros.some((e) => e.includes('ciclo'))).toBe(true)
  })
  test('dependência desconhecida', () => {
    expect(validarPartes([decl('back', { dependeDe: ['x'] })], 'back')).toEqual([
      'dependência desconhecida: x',
    ])
  })
  test('falta a parte de entrada', () => {
    expect(validarPartes([decl('back')], 'alfa-crm')).toEqual([
      'falta a parte de entrada: alfa-crm',
    ])
  })
  test('lista válida', () => {
    expect(
      validarPartes([decl('alfa-crm'), decl('back', { dependeDe: ['alfa-crm'] })], 'alfa-crm'),
    ).toEqual([])
  })
})

describe('planejarMudancas', () => {
  test('cria a nova', () => {
    const r = planejarMudancas([parte('back')], [decl('back'), decl('front')])
    expect(r).toEqual({ ok: true, criar: [decl('front')], atualizar: [], remover: [] })
  })
  test('atualiza objetivo, ordem e dependeDe', () => {
    const novo = decl('back', { objetivo: 'Outro', ordem: 2, dependeDe: ['nucleo'] })
    const r = planejarMudancas([parte('back'), parte('nucleo')], [novo, decl('nucleo')])
    expect(r).toEqual({ ok: true, criar: [], atualizar: [novo], remover: [] })
  })
  test('remove a ausente sem PR mergeado', () => {
    const r = planejarMudancas(
      [parte('back'), parte('front', { prs: [pr('u', 'aberto')] })],
      [decl('back')],
    )
    expect(r).toEqual({ ok: true, criar: [], atualizar: [], remover: ['front'] })
  })
  test('mudar de repositório é recusado', () => {
    const r = planejarMudancas([parte('back')], [decl('back', { repositorio: 'exemplo/outro' })])
    expect(r).toEqual({
      ok: false,
      motivo: 'a parte back não pode mudar de repositório nem de tipo; use outra chave',
    })
  })
  test('mudar de tipo é recusado', () => {
    const r = planejarMudancas([parte('back')], [decl('back', { chegaAoAr: 'versao' })])
    expect(r).toEqual({
      ok: false,
      motivo: 'a parte back não pode mudar de repositório nem de tipo; use outra chave',
    })
  })
  test('só o objetivo mudou', () => {
    const novo = decl('back', { objetivo: 'Novo' })
    expect(planejarMudancas([parte('back')], [novo])).toEqual({
      ok: true,
      criar: [],
      atualizar: [novo],
      remover: [],
    })
  })
  test('ausente com PR mergeado é recusada', () => {
    const r = planejarMudancas(
      [parte('back', { prs: [pr('u', 'mergeado', 'abc')] }), parte('front')],
      [decl('front')],
    )
    expect(r).toEqual({ ok: false, motivo: 'a parte back já tem código em main' })
  })
})

describe('acumularPrs', () => {
  test('mesma url substitui', () => {
    const r = acumularPrs([pr('a', 'aberto')], [pr('a', 'mergeado', 'c1')])
    expect(r).toEqual([pr('a', 'mergeado', 'c1')])
  })
  test('urls novas somam e a ordem é estável', () => {
    const r = acumularPrs(
      [pr('a', 'aberto'), pr('b', 'aberto')],
      [pr('c', 'aberto'), pr('a', 'fechado')],
    )
    expect(r.map((p) => p.url)).toEqual(['a', 'b', 'c'])
    expect(r[0]?.estado).toBe('fechado')
  })
})

describe('podeComecar e podePublicar', () => {
  const com = (estado: EstadoDaParte) => [
    parte('back', { estado }),
    parte('front', { dependeDe: ['back'] }),
  ]
  test.each(['feita', 'publicando', 'no_ar'] as const)('dependência %s permite começar', (e) => {
    const t = com(e)
    expect(podeComecar(t[1]!, t)).toBe(true)
  })
  test('dependência em_curso não permite', () => {
    const t = com('em_curso')
    expect(podeComecar(t[1]!, t)).toBe(false)
  })
  test('publicar só com todas no_ar', () => {
    expect(podePublicar(com('no_ar')[1]!, com('no_ar'))).toBe(true)
    expect(podePublicar(com('publicando')[1]!, com('publicando'))).toBe(false)
  })
})

describe('resultadoDoPedido', () => {
  const base = { motivo: null, conserto: null, conferidoContendo: false } as const
  test('RECUSADO traz o motivo da fila', () => {
    expect(resultadoDoPedido({ ...base, estado: 'RECUSADO', motivo: 'base antiga' })).toEqual({
      estado: 'nao_chegou',
      motivo: 'base antiga',
    })
  })
  test('FALHOU com conserto em curso', () => {
    expect(resultadoDoPedido({ ...base, estado: 'FALHOU', conserto: 'em_curso' })).toEqual({
      estado: 'publicando',
      motivo: 'Consertando a publicação',
    })
  })
  test('FALHOU com conserto desistido', () => {
    expect(resultadoDoPedido({ ...base, estado: 'FALHOU', conserto: 'desistiu' })).toEqual({
      estado: 'nao_chegou',
      motivo: 'Publicação falhou',
    })
  })
  test('DISPENSADO sem conter', () => {
    expect(resultadoDoPedido({ ...base, estado: 'DISPENSADO' })).toEqual({
      estado: 'nao_chegou',
      motivo: 'Publicação dispensada',
    })
  })
  test('DISPENSADO contendo', () => {
    expect(resultadoDoPedido({ ...base, estado: 'DISPENSADO', conferidoContendo: true })).toEqual({
      estado: 'no_ar',
      motivo: null,
    })
  })
  test('PUBLICADO sem conferência', () => {
    expect(resultadoDoPedido({ ...base, estado: 'PUBLICADO' })).toEqual({
      estado: 'nao_chegou',
      motivo: 'Publicada sem conferir o site',
    })
  })
  test('CANCELADO', () => {
    expect(resultadoDoPedido({ ...base, estado: 'CANCELADO' })).toEqual({
      estado: 'nao_chegou',
      motivo: 'Publicação falhou',
    })
  })
})

describe('nuncaPublicada', () => {
  const feitaEm = new Date('2026-11-25T10:00:00Z')
  const feita = parte('back', { estado: 'feita', feitaEm })
  const apos = (min: number) => new Date(feitaEm.getTime() + min * 60_000)
  test('imediato 2h01 sem pedido', () => {
    expect(nuncaPublicada(feita, { agora: apos(121), modo: 'imediato', proximoLote: null })).toBe(
      true,
    )
  })
  test('imediato 1h59', () => {
    expect(nuncaPublicada(feita, { agora: apos(119), modo: 'imediato', proximoLote: null })).toBe(
      false,
    )
  })
  test('lote: só depois de 2h do lote', () => {
    const lote = new Date('2026-11-25T23:00:00Z')
    const f = parte('back', { estado: 'feita', feitaEm })
    expect(
      nuncaPublicada(f, {
        agora: new Date('2026-11-26T00:59:00Z'),
        modo: 'lote',
        proximoLote: lote,
      }),
    ).toBe(false)
    expect(
      nuncaPublicada(f, {
        agora: new Date('2026-11-26T01:01:00Z'),
        modo: 'lote',
        proximoLote: lote,
      }),
    ).toBe(true)
  })
  test('lote sem proximoLote usa a regra imediata', () => {
    expect(nuncaPublicada(feita, { agora: apos(121), modo: 'lote', proximoLote: null })).toBe(true)
    expect(nuncaPublicada(feita, { agora: apos(119), modo: 'lote', proximoLote: null })).toBe(false)
  })
  test('com pedido', () => {
    expect(
      nuncaPublicada(
        { ...feita, temPedido: true },
        { agora: apos(500), modo: 'imediato', proximoLote: null },
      ),
    ).toBe(false)
  })
})

describe('todasNoAr', () => {
  test('vazia é falso', () => expect(todasNoAr([])).toBe(false))
  test('uma descartada é falso', () =>
    expect(todasNoAr([parte('a', { estado: 'no_ar' }), parte('b', { estado: 'descartada' })])).toBe(
      false,
    ))
  test('todas no ar', () => expect(todasNoAr([parte('a', { estado: 'no_ar' })])).toBe(true))
})

describe('MOTIVOS', () => {
  test('textos', () => {
    expect(MOTIVOS.prAberto(3)).toBe('PR aberto há 3 d')
    expect(MOTIVOS.noAr('abcdef0123')).toBe('No ar · abcdef0')
    expect(MOTIVOS.falta('back')).toBe('Falta a parte do back')
  })
})

describe('grupoAteOAr', () => {
  const agora = new Date('2026-11-25T12:00:00Z')
  const diasAtras = (n: number) => new Date(agora.getTime() - n * 86_400_000)
  const d = (o: Partial<Parameters<typeof grupoAteOAr>[0]> = {}) => ({
    espera: null,
    naoChegouDesde: null,
    encerrada: null,
    noArEm: null,
    ...o,
  })

  test('espera vence naoChegouDesde, que vence a caminho', () => {
    expect(grupoAteOAr(d({ espera: 'travada', naoChegouDesde: diasAtras(1) }), agora)).toBe(
      'espera_voce',
    )
    expect(grupoAteOAr(d({ naoChegouDesde: diasAtras(1) }), agora)).toBe('nao_chegou')
    expect(grupoAteOAr(d(), agora)).toBe('a_caminho')
  })

  test('no_ar entra por 30 dias; orientada e descartada ficam fora', () => {
    expect(grupoAteOAr(d({ encerrada: 'no_ar', noArEm: diasAtras(29) }), agora)).toBe('no_ar')
    expect(grupoAteOAr(d({ encerrada: 'no_ar', noArEm: diasAtras(31) }), agora)).toBeNull()
    expect(grupoAteOAr(d({ encerrada: 'orientada' }), agora)).toBeNull()
    expect(
      grupoAteOAr(d({ encerrada: 'descartada', naoChegouDesde: diasAtras(2) }), agora),
    ).toBeNull()
  })
})

describe('trilhoAteOAr', () => {
  const base = { triada: true, temTela: false, desenhoAprovado: false, testePassou: false }

  test('exemplo do desenho: back planejando, front feita', () => {
    const partes = [
      parte('back', { estado: 'planejando' }),
      parte('front', { estado: 'feita', motivo: MOTIVOS.publicacaoDispensada }),
    ]
    expect(trilhoAteOAr(base, partes)).toEqual(['cheio', 'cheio', 'andando', 'vazio'])
  })

  test('todas no ar: último ponto verde', () => {
    const partes = [parte('back', { estado: 'no_ar' }), parte('front', { estado: 'no_ar' })]
    expect(trilhoAteOAr(base, partes)).toEqual(['cheio', 'cheio', 'cheio', 'verde'])
  })

  test('uma nao_chegou: último ponto vermelho', () => {
    const partes = [parte('back', { estado: 'no_ar' }), parte('front', { estado: 'nao_chegou' })]
    expect(trilhoAteOAr(base, partes)[3]).toBe('vermelho')
  })

  test('uma publicando e as demais no ar: último ponto andando', () => {
    const partes = [parte('back', { estado: 'no_ar' }), parte('front', { estado: 'publicando' })]
    expect(trilhoAteOAr(base, partes)).toEqual(['cheio', 'cheio', 'cheio', 'andando'])
  })

  test('demanda com tela espera desenho aprovado e teste passado', () => {
    const partes = [parte('back', { estado: 'feita' })]
    const tela = { ...base, temTela: true }
    expect(trilhoAteOAr(tela, partes)).toEqual(['cheio', 'andando', 'vazio', 'vazio'])
    expect(trilhoAteOAr({ ...tela, desenhoAprovado: true }, partes)).toEqual([
      'cheio',
      'cheio',
      'andando',
      'vazio',
    ])
    expect(trilhoAteOAr({ ...tela, desenhoAprovado: true, testePassou: true }, partes)).toEqual([
      'cheio',
      'cheio',
      'cheio',
      'vazio',
    ])
  })

  test('antes da triagem: pedida andando e o resto vazio', () => {
    expect(trilhoAteOAr({ ...base, triada: false }, [])).toEqual([
      'andando',
      'vazio',
      'vazio',
      'vazio',
    ])
  })
})

describe('fraseDaDemanda', () => {
  test('a parte mais atrasada manda: falta a parte do back', () => {
    const partes = [
      parte('back', { estado: 'planejando' }),
      parte('front', { estado: 'nao_chegou', motivo: MOTIVOS.prAberto(1) }),
    ]
    expect(fraseDaDemanda(partes)).toEqual({ texto: 'Falta a parte do back', tom: 'erro' })
  })

  test('usa o motivo da parte e a execução como tom', () => {
    const partes = [parte('back', { estado: 'publicando', motivo: MOTIVOS.conferindo })]
    expect(fraseDaDemanda(partes)).toEqual({ texto: 'Conferindo o site', tom: 'execucao' })
  })

  test('tudo no ar mostra a versão de 7 caracteres', () => {
    const partes = [
      parte('back', { estado: 'no_ar', commitNoAr: 'aaaaaaa1', noArEm: new Date('2026-11-24') }),
      parte('front', {
        estado: 'no_ar',
        commitNoAr: 'c5c01ba1234567890',
        commitAlvo: 'bbbbbbb2',
        noArEm: new Date('2026-11-25'),
        ordem: 2,
      }),
    ]
    expect(fraseDaDemanda(partes)).toEqual({ texto: 'No ar · c5c01ba', tom: 'sucesso' })
    expect(fraseDaDemanda([parte('a', { estado: 'no_ar', commitAlvo: 'd4d4d4d9' })]).texto).toBe(
      'No ar · d4d4d4d',
    )
    expect(fraseDaDemanda([parte('a', { estado: 'no_ar' })])).toEqual({
      texto: 'No ar',
      tom: 'sucesso',
    })
  })
})
