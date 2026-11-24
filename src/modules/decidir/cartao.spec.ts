import { describe, expect, it } from 'vitest'
import { ErroDeDominio } from '@/lib/erros'
import {
  ACOES_POR_TIPO,
  acoesDoItem,
  arquivosForaDoPermitido,
  avaliarMerge,
  casaGlob,
  protegidosDaConfig,
  cartaoDaRespostaRapida,
  comentarioSeguro,
  efeitoDoCartao,
  estadoDoCi,
  validarCartao,
  type Cartao,
  type ContextoDoItem,
} from './cartao'
import type { ItemDaPilha, TipoDeItem } from './model'

const HEAD = 'a41c9e2' + '0'.repeat(33)
const HEAD_NOVO = 'b52d0f3' + '1'.repeat(33)
const PR_URL = 'https://github.com/kustertech-exemplo/alfa/pull/412'

function itemDeDemanda(tipo: TipoDeItem, o: Partial<ItemDaPilha['ref']> = {}): ItemDaPilha {
  return {
    chave: 'demanda:d1:decidir_destino:1',
    tipo,
    titulo: 'Corrigir o cadastro',
    pergunta: '',
    projeto: 'Projeto Alfa',
    repositorio: 'kustertech-exemplo/alfa',
    linha: '',
    desde: null,
    fatos: [],
    relato: null,
    ref: {
      tipo: 'demanda',
      demandaId: 'd1',
      espera: 'decidir_destino',
      nivel: 'vai_sozinho',
      tipoDeDemanda: tipo === 'nao_classificada' ? null : 'defeito',
      versaoDoDesenho: 3,
      etapaAtual: 'homologacao',
      rotuloDaEtapa: 'Homologação',
      prDaTrava: null,
      ...o,
    } as ItemDaPilha['ref'],
  }
}

function itemDeIssue(tipo: 'fim_de_fase' | 'decisao_da_fabrica'): ItemDaPilha {
  return {
    chave: 'issue:https://github.com/kustertech-exemplo/alfa/issues/41',
    tipo,
    titulo: 'Fim de fase: cadastro',
    pergunta: '',
    projeto: 'Projeto Alfa',
    repositorio: 'kustertech-exemplo/alfa',
    linha: '',
    desde: null,
    fatos: [],
    relato: null,
    ref: {
      tipo: 'issue',
      url: 'https://github.com/kustertech-exemplo/alfa/issues/41',
      repositorio: 'kustertech-exemplo/alfa',
      numero: 41,
      planoId: 'p1',
      feature: 'cadastro',
    },
  }
}

const SEM_PR: ContextoDoItem = { pr: null }
const COM_PR: ContextoDoItem = {
  pr: { url: PR_URL, numero: 412, head: HEAD, fora: ['src/a.ts'], ci: 'verde' },
}

const FORMATO = 'O cartão não tem o formato esperado.'
const NAO_VALE = 'Esta ação não vale para este item.'
const LIMITE = 'O texto passou do limite.'

describe('ACOES_POR_TIPO', () => {
  it('fecha as ações por tipo de item', () => {
    expect(ACOES_POR_TIPO).toEqual({
      pedido: ['destino', 'guardar', 'recusar'],
      nao_classificada: ['destino', 'guardar', 'recusar'],
      desenho: ['aprovar_desenho', 'ajustar_desenho'],
      decisao_da_fabrica: ['responder'],
      fim_de_fase: ['aprovar_e_mergear', 'pedir_mudanca'],
      trava: ['retomar', 'encerrar', 'aprovar_e_mergear'],
      concluir_etapa: ['concluir'],
    })
  })
})

describe('acoesDoItem', () => {
  it('sem PR lido, o merge sai da lista (a trava e o fim de fase)', () => {
    expect(acoesDoItem('trava', SEM_PR)).toEqual(['retomar', 'encerrar'])
    expect(acoesDoItem('fim_de_fase', SEM_PR)).toEqual(['pedir_mudanca'])
    expect(acoesDoItem('trava', COM_PR)).toEqual(['retomar', 'encerrar', 'aprovar_e_mergear'])
    expect(acoesDoItem('pedido', SEM_PR)).toEqual(['destino', 'guardar', 'recusar'])
  })
})

describe('trava com o PR da correção', () => {
  const trava = () => itemDeDemanda('trava', { espera: 'travada' })

  it('o merge vira cartão com o PR lido; sem PR, não vale', () => {
    expect(validarCartao(trava(), COM_PR, { acao: 'aprovar_e_mergear' })).toEqual({
      ok: true,
      cartao: {
        acao: 'aprovar_e_mergear',
        pr: PR_URL,
        numero: 412,
        head: HEAD,
        protegidos: ['src/a.ts'],
      },
    })
    expect(validarCartao(trava(), SEM_PR, { acao: 'aprovar_e_mergear' })).toEqual({
      ok: false,
      motivo: 'O PR não pôde ser lido; abra no GitHub.',
    })
  })

  it('o merge de outra espera da demanda não vale', () => {
    expect(validarCartao(itemDeDemanda('desenho'), COM_PR, { acao: 'aprovar_e_mergear' }).ok).toBe(
      false,
    )
  })

  it('o efeito mergeia o PR e retoma a demanda', () => {
    expect(
      efeitoDoCartao(trava(), {
        acao: 'aprovar_e_mergear',
        pr: PR_URL,
        numero: 412,
        head: HEAD,
        protegidos: [],
      }),
    ).toEqual({
      tipo: 'mergear_pr',
      repositorio: 'kustertech-exemplo/alfa',
      feature: null,
      demandaId: 'd1',
      numero: 412,
      head: HEAD,
      protegidos: [],
    })
  })

  it('no PR da demanda, fora do permitido é só o caminho protegido da Fábrica', () => {
    expect(
      arquivosForaDoPermitido(
        [
          'front/a.ts',
          '.fabrica/config.json',
          '.claude/x.md',
          '.warren/y',
          'front/a.ts',
          '.github/ci.yml',
        ],
        null,
      ),
    ).toEqual(['.fabrica/config.json', '.claude/x.md', '.warren/y'])
  })

  it('avaliarMerge da demanda aceita CI ausente e cobra o protegido não dito', () => {
    const base = {
      repositorio: 'kustertech-exemplo/alfa',
      pr: {
        repositorio: 'kustertech-exemplo/alfa',
        estado: 'ABERTO' as const,
        head: HEAD,
        arquivos: ['front/a.ts'],
      },
      ci: 'ausente' as const,
      cartao: { head: HEAD, protegidos: [] as string[] },
      feature: null,
    }
    expect(avaliarMerge(base)).toEqual({ ok: true, jaMergeado: false })
    expect(
      avaliarMerge({ ...base, pr: { ...base.pr, arquivos: ['front/a.ts', '.claude/x.md'] } }),
    ).toEqual({ ok: false, motivo: 'O PR mexe em .claude/x.md e o cartão não disse.' })
  })
})

describe('validarCartao', () => {
  it('pedido + destino fila_de_agentes → ok, tipoDeDemanda do item, escopo e resposta null', () => {
    expect(
      validarCartao(itemDeDemanda('pedido'), SEM_PR, {
        acao: 'destino',
        destino: 'fila_de_agentes',
        nivel: 'aprovar_desenho',
      }),
    ).toEqual({
      ok: true,
      cartao: {
        acao: 'destino',
        destino: 'fila_de_agentes',
        nivel: 'aprovar_desenho',
        tipoDeDemanda: 'defeito',
        escopo: null,
        resposta: null,
      },
    })
  })

  it('pedido: tipo, escopo e resposta do agente entram aparados', () => {
    const r = validarCartao(itemDeDemanda('pedido'), SEM_PR, {
      acao: 'destino',
      destino: 'urgente',
      nivel: 'vai_sozinho',
      tipoDeDemanda: 'ajuste',
      escopo: '  só o formulário  ',
      resposta: '   ',
    })
    expect(r).toEqual({
      ok: true,
      cartao: {
        acao: 'destino',
        destino: 'urgente',
        nivel: 'vai_sozinho',
        tipoDeDemanda: 'ajuste',
        escopo: 'só o formulário',
        resposta: null,
      },
    })
  })

  it('Review Focus 2: campos que o Flow decide ou ação fora do tipo são recusados', () => {
    const desenho = itemDeDemanda('desenho')
    expect(validarCartao(desenho, SEM_PR, { acao: 'aprovar_desenho', versao: 9 })).toEqual({
      ok: false,
      motivo: FORMATO,
    })
    const fim = itemDeIssue('fim_de_fase')
    for (const extra of [{ head: HEAD_NOVO }, { pr: PR_URL }, { protegidos: ['src/b.ts'] }]) {
      expect(validarCartao(fim, COM_PR, { acao: 'aprovar_e_mergear', ...extra })).toEqual({
        ok: false,
        motivo: FORMATO,
      })
    }
    expect(
      validarCartao(itemDeDemanda('concluir_etapa'), SEM_PR, { acao: 'concluir', etapa: 'x' }),
    ).toEqual({ ok: false, motivo: FORMATO })
    expect(validarCartao(itemDeDemanda('pedido'), COM_PR, { acao: 'aprovar_e_mergear' })).toEqual({
      ok: false,
      motivo: NAO_VALE,
    })
    expect(validarCartao(itemDeDemanda('pedido'), SEM_PR, { acao: 'apagar_tudo' })).toEqual({
      ok: false,
      motivo: FORMATO,
    })
    expect(validarCartao(itemDeDemanda('pedido'), SEM_PR, 'destino')).toEqual({
      ok: false,
      motivo: FORMATO,
    })
    expect(
      validarCartao(itemDeDemanda('pedido'), SEM_PR, {
        acao: 'destino',
        destino: 'decisao_do_paulo',
        nivel: 'vai_sozinho',
      }),
    ).toEqual({ ok: false, motivo: FORMATO })
  })

  it('nao_classificada sem tipoDeDemanda → "Escolha o tipo da demanda."; com tipo → ok', () => {
    const item = itemDeDemanda('nao_classificada')
    const base = { acao: 'destino', destino: 'lote_da_noite', nivel: 'vai_sozinho' }
    expect(validarCartao(item, SEM_PR, base)).toEqual({
      ok: false,
      motivo: 'Escolha o tipo da demanda.',
    })
    const r = validarCartao(item, SEM_PR, { ...base, tipoDeDemanda: 'ideia' })
    expect(r.ok && r.cartao.acao === 'destino' && r.cartao.tipoDeDemanda).toBe('ideia')
  })

  it('preenche versao, etapa e o PR pelo item e pelo contexto', () => {
    expect(validarCartao(itemDeDemanda('desenho'), SEM_PR, { acao: 'aprovar_desenho' })).toEqual({
      ok: true,
      cartao: { acao: 'aprovar_desenho', versao: 3 },
    })
    expect(validarCartao(itemDeDemanda('concluir_etapa'), SEM_PR, { acao: 'concluir' })).toEqual({
      ok: true,
      cartao: { acao: 'concluir', etapa: 'homologacao' },
    })
    const fim = itemDeIssue('fim_de_fase')
    expect(validarCartao(fim, COM_PR, { acao: 'aprovar_e_mergear' })).toEqual({
      ok: true,
      cartao: {
        acao: 'aprovar_e_mergear',
        pr: PR_URL,
        numero: 412,
        head: HEAD,
        protegidos: ['src/a.ts'],
      },
    })
    expect(validarCartao(fim, SEM_PR, { acao: 'aprovar_e_mergear' })).toEqual({
      ok: false,
      motivo: 'O PR não pôde ser lido; abra no GitHub.',
    })
    expect(validarCartao(fim, SEM_PR, { acao: 'pedir_mudanca', texto: 'refaça a raia 2' })).toEqual(
      { ok: true, cartao: { acao: 'pedir_mudanca', texto: 'refaça a raia 2' } },
    )
  })

  it('textos fora dos limites', () => {
    const pedido = itemDeDemanda('pedido')
    const destino = { acao: 'destino', destino: 'urgente', nivel: 'vai_sozinho' }
    expect(validarCartao(pedido, SEM_PR, { ...destino, escopo: 'a'.repeat(500) }).ok).toBe(true)
    expect(validarCartao(pedido, SEM_PR, { ...destino, escopo: 'a'.repeat(501) })).toEqual({
      ok: false,
      motivo: LIMITE,
    })
    expect(validarCartao(pedido, SEM_PR, { acao: 'recusar', resposta: 'a'.repeat(1001) })).toEqual({
      ok: false,
      motivo: LIMITE,
    })
    const decisao = itemDeIssue('decisao_da_fabrica')
    expect(validarCartao(decisao, SEM_PR, { acao: 'responder', texto: '  ' })).toEqual({
      ok: false,
      motivo: LIMITE,
    })
    expect(validarCartao(decisao, SEM_PR, { acao: 'responder', texto: 'a'.repeat(2001) })).toEqual({
      ok: false,
      motivo: LIMITE,
    })
    expect(validarCartao(decisao, SEM_PR, { acao: 'responder' })).toEqual({
      ok: false,
      motivo: FORMATO,
    })
    expect(
      validarCartao(itemDeDemanda('desenho'), SEM_PR, {
        acao: 'ajustar_desenho',
        texto: 'a'.repeat(501),
      }),
    ).toEqual({ ok: false, motivo: LIMITE })
    expect(
      validarCartao(itemDeDemanda('trava'), SEM_PR, {
        acao: 'retomar',
        resposta: 'a'.repeat(1001),
      }),
    ).toEqual({ ok: false, motivo: LIMITE })
  })
})

describe('cartaoDaRespostaRapida', () => {
  it('"urgente" num pedido → cartão destino urgente com o nível do item', () => {
    expect(cartaoDaRespostaRapida(itemDeDemanda('pedido'), SEM_PR, 'urgente')).toEqual({
      cartao: {
        acao: 'destino',
        destino: 'urgente',
        nivel: 'vai_sozinho',
        tipoDeDemanda: 'defeito',
        escopo: null,
        resposta: null,
      },
    })
  })

  it('o que falta: texto no ajuste e na mudança, tipo na não classificada', () => {
    expect(cartaoDaRespostaRapida(itemDeIssue('fim_de_fase'), COM_PR, 'pedir_mudanca')).toEqual({
      faltam: ['texto'],
      base: { acao: 'pedir_mudanca' },
    })
    expect(cartaoDaRespostaRapida(itemDeDemanda('desenho'), SEM_PR, 'ajustar_desenho')).toEqual({
      faltam: ['texto'],
      base: { acao: 'ajustar_desenho', versao: 3 },
    })
    expect(
      cartaoDaRespostaRapida(itemDeDemanda('nao_classificada'), SEM_PR, 'fila_de_agentes'),
    ).toEqual({
      faltam: ['tipoDeDemanda'],
      base: {
        acao: 'destino',
        destino: 'fila_de_agentes',
        nivel: 'vai_sozinho',
        escopo: null,
        resposta: null,
      },
    })
  })

  it('demais respostas viram cartão preenchido pelo item', () => {
    expect(cartaoDaRespostaRapida(itemDeDemanda('pedido'), SEM_PR, 'guardar')).toEqual({
      cartao: { acao: 'guardar' },
    })
    expect(cartaoDaRespostaRapida(itemDeDemanda('pedido'), SEM_PR, 'recusar')).toEqual({
      cartao: { acao: 'recusar', resposta: null },
    })
    expect(cartaoDaRespostaRapida(itemDeDemanda('trava'), SEM_PR, 'retomar')).toEqual({
      cartao: { acao: 'retomar', resposta: null },
    })
    expect(cartaoDaRespostaRapida(itemDeDemanda('concluir_etapa'), SEM_PR, 'concluir')).toEqual({
      cartao: { acao: 'concluir', etapa: 'homologacao' },
    })
    expect(cartaoDaRespostaRapida(itemDeIssue('fim_de_fase'), COM_PR, 'aprovar_e_mergear')).toEqual(
      {
        cartao: {
          acao: 'aprovar_e_mergear',
          pr: PR_URL,
          numero: 412,
          head: HEAD,
          protegidos: ['src/a.ts'],
        },
      },
    )
  })

  it('chave fora das respostas do tipo → ErroDeDominio', () => {
    const tentar = () =>
      cartaoDaRespostaRapida(itemDeDemanda('pedido'), COM_PR, 'aprovar_e_mergear')
    expect(tentar).toThrow(ErroDeDominio)
    expect(tentar).toThrow('Resposta rápida inválida.')
    expect(() => cartaoDaRespostaRapida(itemDeIssue('decisao_da_fabrica'), SEM_PR, 'x')).toThrow(
      'Resposta rápida inválida.',
    )
  })

  it('aprovar_e_mergear sem o PR lido → ErroDeDominio com o motivo', () => {
    expect(() =>
      cartaoDaRespostaRapida(itemDeIssue('fim_de_fase'), SEM_PR, 'aprovar_e_mergear'),
    ).toThrow('O PR não pôde ser lido; abra no GitHub.')
  })
})

describe('efeitoDoCartao', () => {
  it('ações da demanda', () => {
    const pedido = itemDeDemanda('pedido')
    expect(
      efeitoDoCartao(pedido, {
        acao: 'destino',
        destino: 'lote_da_noite',
        nivel: 'aprovar_desenho',
        tipoDeDemanda: 'ajuste',
        escopo: 'só o formulário',
        resposta: null,
      }),
    ).toEqual({
      tipo: 'decidir_destino',
      demandaId: 'd1',
      destino: 'lote_da_noite',
      extras: { nivel: 'aprovar_desenho', tipo: 'ajuste', escopo: 'só o formulário' },
    })
    expect(
      efeitoDoCartao(pedido, {
        acao: 'destino',
        destino: 'urgente',
        nivel: 'vai_sozinho',
        tipoDeDemanda: null,
        escopo: null,
        resposta: null,
      }),
    ).toEqual({
      tipo: 'decidir_destino',
      demandaId: 'd1',
      destino: 'urgente',
      extras: { nivel: 'vai_sozinho' },
    })
    expect(efeitoDoCartao(pedido, { acao: 'guardar' })).toEqual({ tipo: 'guardar' })
    expect(efeitoDoCartao(pedido, { acao: 'recusar', resposta: null })).toEqual({
      tipo: 'encerrar_demanda',
      demandaId: 'd1',
    })
    expect(efeitoDoCartao(itemDeDemanda('trava'), { acao: 'encerrar' })).toEqual({
      tipo: 'encerrar_demanda',
      demandaId: 'd1',
    })
    expect(efeitoDoCartao(itemDeDemanda('trava'), { acao: 'retomar', resposta: 'siga' })).toEqual({
      tipo: 'retomar',
      demandaId: 'd1',
      resposta: 'siga',
    })
    expect(efeitoDoCartao(itemDeDemanda('trava'), { acao: 'retomar', resposta: null })).toEqual({
      tipo: 'retomar',
      demandaId: 'd1',
    })
    const desenho = itemDeDemanda('desenho')
    expect(efeitoDoCartao(desenho, { acao: 'aprovar_desenho', versao: 3 })).toEqual({
      tipo: 'aprovar_desenho',
      demandaId: 'd1',
      versao: 3,
    })
    expect(efeitoDoCartao(desenho, { acao: 'ajustar_desenho', versao: 3, texto: 'menor' })).toEqual(
      { tipo: 'pedir_ajuste', demandaId: 'd1', versao: 3, texto: 'menor' },
    )
    expect(
      efeitoDoCartao(itemDeDemanda('concluir_etapa'), { acao: 'concluir', etapa: 'homologacao' }),
    ).toEqual({ tipo: 'concluir_etapa', demandaId: 'd1', chave: 'homologacao' })
  })

  it('pedir_mudanca → responder_issue com o número da issue; aprovar_e_mergear → mergear_pr', () => {
    const fim = itemDeIssue('fim_de_fase')
    expect(efeitoDoCartao(fim, { acao: 'pedir_mudanca', texto: 'refaça' })).toEqual({
      tipo: 'responder_issue',
      repositorio: 'kustertech-exemplo/alfa',
      numero: 41,
      comentario: 'refaça\n\n— Resposta do Paulo pelo Flow.',
    })
    expect(
      efeitoDoCartao(fim, {
        acao: 'aprovar_e_mergear',
        pr: PR_URL,
        numero: 412,
        head: HEAD,
        protegidos: ['src/a.ts'],
      }),
    ).toEqual({
      tipo: 'mergear_pr',
      repositorio: 'kustertech-exemplo/alfa',
      feature: 'cadastro',
      numero: 412,
      head: HEAD,
      protegidos: ['src/a.ts'],
    })
    expect(
      efeitoDoCartao(itemDeIssue('decisao_da_fabrica'), {
        acao: 'responder',
        texto: '<!-- fabrica:despachante --> sim',
      }),
    ).toMatchObject({ tipo: 'responder_issue', numero: 41 })
  })

  it('cartão fora do tipo do item → ErroDeDominio', () => {
    const cartao: Cartao = { acao: 'encerrar' }
    expect(() => efeitoDoCartao(itemDeIssue('fim_de_fase'), cartao)).toThrow(NAO_VALE)
  })
})

describe('comentarioSeguro', () => {
  it('neutraliza os marcadores do kit e assina', () => {
    const c = comentarioSeguro('  <!-- fabrica:despachante --> ok  ')
    expect(c).not.toContain('<!--')
    expect(c.startsWith('&lt;!-- fabrica:despachante --> ok')).toBe(true)
    expect(c.endsWith('— Resposta do Paulo pelo Flow.')).toBe(true)
    const nonce = comentarioSeguro('a\n<!-- fabrica:nonce=' + 'f'.repeat(32) + ' -->\n<!--x')
    expect(nonce).not.toContain('<!--')
    expect(nonce).not.toContain('<!-- fabrica:nonce=')
  })
})

describe('arquivosForaDoPermitido', () => {
  it('deixa de fora só o que o orquestrador pode tocar, sem repetição e na ordem', () => {
    expect(
      arquivosForaDoPermitido(
        [
          '.fabrica/planos/cadastro.json',
          '.fabrica/pergunta.md',
          '.fabrica/planejamento/x/pacote.json',
          '.seeds/issues.jsonl',
          '.fabrica/config.json',
          'src/a.ts',
          '.fabrica/planos/Plano.json',
          'src/a.ts',
        ],
        'cadastro',
      ),
    ).toEqual(['.fabrica/config.json', 'src/a.ts', '.fabrica/planos/Plano.json'])
  })

  it('só o plano do próprio item: outro plano, o legado e plano de feature inválida ficam de fora', () => {
    expect(
      arquivosForaDoPermitido(
        [
          '.fabrica/planos/cadastro.json',
          '.fabrica/planos/outra-feature.json',
          '.fabrica/plano.json',
          '.fabrica/planos/plano.json',
        ],
        'cadastro',
      ),
    ).toEqual([
      '.fabrica/planos/outra-feature.json',
      '.fabrica/plano.json',
      '.fabrica/planos/plano.json',
    ])
    // O plano legado tem a feature `plano`; `.fabrica/planos/plano.json` nunca vale.
    expect(
      arquivosForaDoPermitido(['.fabrica/plano.json', '.fabrica/planos/plano.json'], 'plano'),
    ).toEqual(['.fabrica/planos/plano.json'])
    // Feature fora do formato (ou longa demais) não autoriza plano nenhum.
    expect(
      arquivosForaDoPermitido(
        ['.fabrica/planos/Cadastro.json', '.fabrica/planos/a.json'],
        'Cadastro',
      ),
    ).toEqual(['.fabrica/planos/Cadastro.json', '.fabrica/planos/a.json'])
    const longa = 'a'.repeat(42)
    expect(arquivosForaDoPermitido([`.fabrica/planos/${longa}.json`], longa)).toEqual([
      `.fabrica/planos/${longa}.json`,
    ])
    expect(
      arquivosForaDoPermitido([`.fabrica/planos/${'a'.repeat(41)}.json`], 'a'.repeat(41)),
    ).toEqual([])
  })

  it('caminho com ".." ou "." nunca é permitido', () => {
    expect(
      arquivosForaDoPermitido(
        [
          '.fabrica/planejamento/../../src/a.ts',
          '.seeds/../package.json',
          '.seeds/./x',
          '.fabrica/planos/a-b-2.json',
        ],
        'a-b-2',
      ),
    ).toEqual(['.fabrica/planejamento/../../src/a.ts', '.seeds/../package.json', '.seeds/./x'])
  })
})

describe('estadoDoCi', () => {
  it('falho, pendente, ausente e verde', () => {
    expect(estadoDoCi('SEM_CHECKS', null)).toBe('ausente')
    expect(estadoDoCi('SUCESSO', 'pending')).toBe('pendente')
    expect(estadoDoCi('PENDENTE', 'success')).toBe('pendente')
    expect(estadoDoCi('SEM_CHECKS', 'failure')).toBe('vermelho')
    expect(estadoDoCi('PENDENTE', 'error')).toBe('vermelho')
    expect(estadoDoCi('FALHA', null)).toBe('vermelho')
    expect(estadoDoCi('SUCESSO', 'success')).toBe('verde')
    expect(estadoDoCi('SEM_CHECKS', 'success')).toBe('verde')
    expect(estadoDoCi('SUCESSO', null)).toBe('verde')
  })
})

describe('avaliarMerge', () => {
  const base = {
    repositorio: 'kustertech-exemplo/alfa',
    pr: {
      repositorio: 'kustertech-exemplo/alfa',
      estado: 'ABERTO' as const,
      head: HEAD,
      arquivos: ['.fabrica/planos/cadastro.json', '.seeds/issues.jsonl'],
    },
    ci: 'verde' as const,
    cartao: { head: HEAD, protegidos: [] as string[] },
    feature: 'cadastro',
  }

  it('Review Focus 1: head diferente → motivo com os 7 primeiros do novo e headNovo', () => {
    expect(avaliarMerge({ ...base, pr: { ...base.pr, head: HEAD_NOVO } })).toEqual({
      ok: false,
      motivo: 'O PR mudou desde a conferência (head b52d0f3). Confira de novo.',
      headNovo: HEAD_NOVO,
    })
  })

  it('repositório, estado e CI', () => {
    expect(avaliarMerge(base)).toEqual({ ok: true, jaMergeado: false })
    expect(
      avaliarMerge({ ...base, pr: { ...base.pr, repositorio: 'kustertech-exemplo/beta' } }),
    ).toEqual({ ok: false, motivo: 'O PR é de outro repositório.' })
    expect(
      avaliarMerge({ ...base, pr: { ...base.pr, estado: 'MERGEADO' }, ci: 'vermelho' }),
    ).toEqual({ ok: true, jaMergeado: true })
    expect(
      avaliarMerge({ ...base, pr: { ...base.pr, estado: 'MERGEADO', head: HEAD_NOVO } }),
    ).toEqual({ ok: false, motivo: 'O PR não está mais aberto.' })
    expect(avaliarMerge({ ...base, pr: { ...base.pr, estado: 'FECHADO' } })).toEqual({
      ok: false,
      motivo: 'O PR não está mais aberto.',
    })
    expect(avaliarMerge({ ...base, ci: 'pendente' })).toEqual({
      ok: false,
      motivo: 'O CI ainda está rodando no head a41c9e2.',
    })
    expect(avaliarMerge({ ...base, ci: 'vermelho' })).toEqual({
      ok: false,
      motivo: 'O CI falhou no head a41c9e2.',
    })
    expect(avaliarMerge({ ...base, ci: 'ausente' })).toEqual({ ok: true, jaMergeado: false })
  })

  it('caminhos protegidos só com a lista no cartão', () => {
    const pr = { ...base.pr, arquivos: [...base.pr.arquivos, 'src/a.ts'] }
    expect(avaliarMerge({ ...base, pr, cartao: { head: HEAD, protegidos: ['src/a.ts'] } })).toEqual(
      { ok: true, jaMergeado: false },
    )
    expect(avaliarMerge({ ...base, pr })).toEqual({
      ok: false,
      motivo: 'O PR mexe em src/a.ts e o cartão não disse.',
    })
    const muitos = { ...base.pr, arquivos: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }
    expect(
      avaliarMerge({ ...base, pr: muitos, cartao: { head: HEAD, protegidos: ['a'] } }),
    ).toEqual({ ok: false, motivo: 'O PR mexe em b, c, d, e, f e o cartão não disse.' })
  })

  it('outro plano é caminho protegido: só passa com o cartão dizendo', () => {
    const pr = { ...base.pr, arquivos: [...base.pr.arquivos, '.fabrica/planos/outra-feature.json'] }
    expect(avaliarMerge({ ...base, pr })).toEqual({
      ok: false,
      motivo: 'O PR mexe em .fabrica/planos/outra-feature.json e o cartão não disse.',
    })
    expect(
      avaliarMerge({
        ...base,
        pr,
        cartao: { head: HEAD, protegidos: ['.fabrica/planos/outra-feature.json'] },
      }),
    ).toEqual({ ok: true, jaMergeado: false })
  })
})

describe('casaGlob (como globs.casa_glob da Fábrica)', () => {
  it.each([
    ['src/a/b.ts', 'src/**', true],
    ['src/a/b.ts', 'src/*.ts', false],
    ['src/b.ts', 'src/*.ts', true],
    ['src/a/b.ts', 'src/a/', true],
    ['src/ab/b.ts', 'src/a/', false],
    ['.env.local', '.env*', true],
    ['a.ts', '?.ts', true],
    ['ab.ts', '?.ts', false],
    ['a/b', 'a?b', false],
    ['a.ts', 'a.ts', true],
    ['axts', 'a.ts', false],
    ['src/a.tsx', 'src/*.ts', false],
    ['xsrc/a.ts', 'src/*.ts', false],
    ['a.ts.bak', 'a.ts', false],
    ['xsrc/a/b.ts', 'src/a/', false],
    ['src/a/x.ts', 'src/*/', true],
    ['src/a/b/x.ts', 'src/*/', true],
    ['src/x.ts', 'src/*/', false],
    ['src/clientes/x.ts', '**/clientes/', true],
    ['a/b/clientes/x.ts', '**/clientes/', true],
    ['a(b)+c.ts', 'a(b)+c.ts', true],
  ])('%s em %s → %s', (caminho, glob, esperado) => {
    expect(casaGlob(caminho, glob)).toBe(esperado)
  })
})

describe('protegidos do repositório no PR da trava', () => {
  it('arquivosForaDoPermitido soma os fixos da Fábrica e os da config do repositório', () => {
    expect(
      arquivosForaDoPermitido(['front/a.ts', 'infra/deploy.sh', '.claude/x.md'], null, ['infra/']),
    ).toEqual(['infra/deploy.sh', '.claude/x.md'])
  })

  it('avaliarMerge cobra o protegido da config que o cartão não disse', () => {
    const base = {
      repositorio: 'kustertech-exemplo/alfa',
      pr: {
        repositorio: 'kustertech-exemplo/alfa',
        estado: 'ABERTO' as const,
        head: HEAD,
        arquivos: ['front/a.ts', 'infra/deploy.sh'],
      },
      ci: 'ausente' as const,
      cartao: { head: HEAD, protegidos: [] as string[] },
      feature: null,
      protegidosDoRepo: ['infra/**'],
    }
    expect(avaliarMerge(base)).toEqual({
      ok: false,
      motivo: 'O PR mexe em infra/deploy.sh e o cartão não disse.',
    })
    expect(
      avaliarMerge({ ...base, cartao: { head: HEAD, protegidos: ['infra/deploy.sh'] } }),
    ).toEqual({ ok: true, jaMergeado: false })
  })
})

describe('protegidosDaConfig (como config_do_repo da Fábrica)', () => {
  it('ausente: nenhum extra; válida: a lista; ilegível: null', () => {
    expect(protegidosDaConfig(null)).toEqual([])
    expect(protegidosDaConfig('{}')).toEqual([])
    expect(protegidosDaConfig('{"protegidos": ["infra/", "*.sql"]}')).toEqual(['infra/', '*.sql'])
    expect(protegidosDaConfig('{')).toBeNull()
    expect(protegidosDaConfig('[]')).toBeNull()
    expect(protegidosDaConfig('{"protegidos": "infra/"}')).toBeNull()
    expect(protegidosDaConfig('{"protegidos": ["", "a"]}')).toBeNull()
  })
})
