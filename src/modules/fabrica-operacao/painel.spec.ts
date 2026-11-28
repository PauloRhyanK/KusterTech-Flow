import { describe, expect, test } from 'vitest'
import { montarPainel, type DadosDoPainel, type EtapaNoPainel } from './painel'

const AGORA = new Date('2026-11-28T19:00:00.000Z') // 16:00 em Brasília
const minAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000)
const minDepois = (m: number) => new Date(AGORA.getTime() + m * 60_000)

const etapa = (chave: string, extra: Partial<EtapaNoPainel> = {}): EtapaNoPainel => ({
  chave,
  papel: 'engenheiro',
  estado: 'pendente',
  motivo: null,
  proximaTentativaEm: null,
  execucaoDesde: null,
  ...extra,
})

const dados = (extra: Partial<DadosDoPainel> = {}): DadosDoPainel => ({
  demandas: [],
  maquinas: [],
  noArHoje: [],
  ...extra,
})

describe('situação', () => {
  test('sem nada no motor novo', () => {
    expect(montarPainel(dados(), AGORA).situacao).toEqual({
      tipo: 'vazia',
      titulo: 'Nenhuma demanda no motor novo',
      frase: 'As demandas continuam no motor atual até o piloto começar.',
    })
  })

  test('tudo andando', () => {
    const p = montarPainel(
      dados({
        demandas: [
          {
            id: 'd1',
            titulo: 'Busca',
            projeto: 'Flow',
            etapas: [etapa('a', { estado: 'executando', execucaoDesde: minAtras(6) })],
          },
        ],
      }),
      AGORA,
    )
    expect(p.situacao).toMatchObject({ tipo: 'andando', titulo: 'Tudo andando' })
  })

  test('uma ou mais travadas', () => {
    const demanda = (id: string) => ({
      id,
      titulo: id,
      projeto: 'Flow',
      etapas: [etapa('a', { estado: 'bloqueada', motivo: 'x' })],
    })
    expect(montarPainel(dados({ demandas: [demanda('d1')] }), AGORA).situacao.titulo).toBe(
      'Uma coisa travou',
    )
    expect(
      montarPainel(dados({ demandas: [demanda('d1'), demanda('d2')] }), AGORA).situacao.titulo,
    ).toBe('2 coisas travaram')
  })
})

describe('contadores', () => {
  test('trabalhando, conferindo e no ar hoje', () => {
    const p = montarPainel(
      dados({
        demandas: [
          {
            id: 'd1',
            titulo: 'Busca',
            projeto: 'Flow',
            etapas: [
              etapa('a', { estado: 'executando', execucaoDesde: minAtras(1) }),
              etapa('b', { estado: 'aguardando_gates' }),
              etapa('c', { papel: 'revisor', estado: 'executando', execucaoDesde: minAtras(1) }),
            ],
          },
        ],
        noArHoje: [{ titulo: 'Filtro' }, { titulo: 'Login' }],
      }),
      AGORA,
    )
    expect(p.contadores).toEqual({ trabalhando: 1, conferindo: 2, noArHoje: 2 })
  })
})

describe('travadas', () => {
  test('em recuo mostra a hora da próxima tentativa em Brasília; bloqueada pede atenção', () => {
    const p = montarPainel(
      dados({
        demandas: [
          {
            id: 'd1',
            titulo: 'Aviso de versão',
            projeto: 'Flow',
            etapas: [
              etapa('rodape', {
                motivo: 'o teste não instala',
                proximaTentativaEm: minDepois(40),
              }),
            ],
          },
          {
            id: 'd2',
            titulo: 'Exportar',
            projeto: 'Flow',
            etapas: [etapa('botao', { estado: 'bloqueada', motivo: 'escalar: CI vermelho' })],
          },
        ],
      }),
      AGORA,
    )
    expect(p.travadas).toEqual([
      {
        demandaId: 'd2',
        titulo: 'Exportar',
        etapa: 'botao',
        motivo: 'escalar: CI vermelho',
        proximaTentativa: null,
      },
      {
        demandaId: 'd1',
        titulo: 'Aviso de versão',
        etapa: 'rodape',
        motivo: 'o teste não instala',
        proximaTentativa: '16:40',
      },
    ])
  })

  test('pendente sem recuo não é travada', () => {
    const p = montarPainel(
      dados({ demandas: [{ id: 'd', titulo: 't', projeto: 'p', etapas: [etapa('a')] }] }),
      AGORA,
    )
    expect(p.travadas).toEqual([])
  })
})

describe('em andamento', () => {
  test('progresso, cor, o que acontece agora e passos', () => {
    const p = montarPainel(
      dados({
        demandas: [
          {
            id: 'd1',
            titulo: 'Busca',
            projeto: 'Flow',
            etapas: [
              etapa('pesquisa', { estado: 'concluida' }),
              etapa('banco', { estado: 'mergeada' }),
              etapa('tela', { estado: 'mergeada' }),
              etapa('revisao', {
                papel: 'revisor',
                estado: 'executando',
                execucaoDesde: minAtras(6),
              }),
              etapa('teste'),
            ],
          },
        ],
      }),
      AGORA,
    )
    expect(p.emAndamento).toEqual([
      {
        demandaId: 'd1',
        titulo: 'Busca',
        projeto: 'Flow',
        progresso: 60,
        cor: 'conferindo',
        agora: { texto: 'Revisor conferindo o código', desde: 'há 6 min', icone: 'lupa' },
        passos: [
          { nome: 'pesquisa', estado: 'feito' },
          { nome: 'banco', estado: 'feito' },
          { nome: 'tela', estado: 'feito' },
          { nome: 'revisao', estado: 'atual' },
          { nome: 'teste', estado: 'futuro' },
        ],
      },
    ])
  })

  test('engenheiro trabalhando é roxo; PR esperando os gates é azul', () => {
    const base = { id: 'd', titulo: 't', projeto: 'p' }
    const trabalhando = montarPainel(
      dados({
        demandas: [
          {
            ...base,
            etapas: [etapa('tela', { estado: 'executando', execucaoDesde: minAtras(90) })],
          },
        ],
      }),
      AGORA,
    ).emAndamento[0]!
    expect(trabalhando).toMatchObject({
      cor: 'trabalhando',
      agora: { texto: 'Engenheiro fazendo tela', desde: 'há 1 h 30 min', icone: 'codigo' },
    })
    const esperando = montarPainel(
      dados({ demandas: [{ ...base, etapas: [etapa('tela', { estado: 'aguardando_gates' })] }] }),
      AGORA,
    ).emAndamento[0]!
    expect(esperando).toMatchObject({
      cor: 'conferindo',
      agora: { texto: 'Esperando revisão e testes do PR', desde: null, icone: 'lupa' },
    })
  })

  test('demanda só com etapas pendentes ou travadas não aparece em andamento', () => {
    const p = montarPainel(
      dados({
        demandas: [
          {
            id: 'd',
            titulo: 't',
            projeto: 'p',
            etapas: [etapa('a'), etapa('b', { estado: 'bloqueada' })],
          },
        ],
      }),
      AGORA,
    )
    expect(p.emAndamento).toEqual([])
  })
})

describe('máquinas', () => {
  test('ocupada, livre e sem sinal', () => {
    const p = montarPainel(
      dados({
        maquinas: [
          { nome: 'Oficina 1', ultimoSinalEm: minAtras(0.5), tarefa: 'Revisando a busca' },
          { nome: 'Oficina 2', ultimoSinalEm: minAtras(1), tarefa: null },
          { nome: 'Oficina 3', ultimoSinalEm: minAtras(30), tarefa: null },
          { nome: 'Oficina 4', ultimoSinalEm: null, tarefa: null },
        ],
      }),
      AGORA,
    )
    expect(p.maquinas).toEqual([
      { nome: 'Oficina 1', estado: 'ocupada', texto: 'Revisando a busca' },
      { nome: 'Oficina 2', estado: 'livre', texto: 'Livre' },
      { nome: 'Oficina 3', estado: 'sem_sinal', texto: 'Sem sinal há 30 min' },
      { nome: 'Oficina 4', estado: 'sem_sinal', texto: 'Nunca se conectou' },
    ])
  })
})
