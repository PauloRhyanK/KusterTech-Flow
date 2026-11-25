import { describe, expect, test } from 'vitest'
import {
  MODELO_PADRAO,
  LIMITE_DA_DESCRICAO,
  LIMITE_DO_TITULO,
  compararNaFila,
  concluirEtapaAtual,
  descricaoDaFilha,
  tituloDaFilha,
  trechoQueNaoFuncionou,
  esperaOPaulo,
  estadoInicial,
  etapasAplicaveis,
  modoDePublicacao,
  podeConcluir,
  validarModelo,
  type EtapaDefinida,
} from './model'

const etapa = (chave: string): EtapaDefinida => {
  const e = MODELO_PADRAO.find((x) => x.chave === chave)
  if (!e) throw new Error(chave)
  return e
}
const chaves = (l: readonly EtapaDefinida[]) => l.map((e) => e.chave)
const extra: EtapaDefinida = {
  chave: 'revisao-paulo',
  nome: 'Revisão do Paulo',
  rotulo: 'Revisão',
  marco: null,
  quemConclui: 'paulo',
  puladaSemTela: false,
  esperaEm: [],
}

describe('modelo de etapas', () => {
  test('MODELO_PADRAO passa em validarModelo e tem as seis etapas na ordem do spec', () => {
    expect(validarModelo(MODELO_PADRAO)).toEqual([])
    expect(chaves(MODELO_PADRAO)).toEqual([
      'recebida',
      'planejada',
      'desenho',
      'desenvolvida',
      'testada',
      'entregue',
    ])
  })

  test('validarModelo aponta os defeitos e aceita etapa extra com marco null', () => {
    const [rec, pla, des, dev, tes, ent] = MODELO_PADRAO.map((e) => e)
    if (!rec || !pla || !des || !dev || !tes || !ent) throw new Error('modelo')
    expect(validarModelo([rec, pla, pla, ent]).length).toBeGreaterThan(0)
    expect(validarModelo([rec, { ...pla, chave: 'Ruim Chave' }, ent]).length).toBeGreaterThan(0)
    expect(validarModelo([rec, { ...pla, chave: 'x'.repeat(41) }, ent]).length).toBeGreaterThan(0)
    expect(
      validarModelo([rec, pla, { ...des, chave: 'outra', marco: 'planejada' }, ent]),
    ).not.toEqual([])
    expect(validarModelo([rec, des, pla, dev, tes, ent])).not.toEqual([])
    expect(validarModelo([pla, ent])).not.toEqual([])
    expect(validarModelo([rec, pla])).not.toEqual([])
    expect(validarModelo([rec, extra, pla, ent])).toEqual([])
  })

  test('etapasAplicaveis pula desenho e testada sem tela', () => {
    expect(chaves(etapasAplicaveis(MODELO_PADRAO, false))).toEqual([
      'recebida',
      'planejada',
      'desenvolvida',
      'entregue',
    ])
    expect(etapasAplicaveis(MODELO_PADRAO, true)).toHaveLength(6)
  })

  test('esperaOPaulo por nível', () => {
    expect(esperaOPaulo(etapa('planejada'), 'planejar_comigo')).toBe(true)
    expect(esperaOPaulo(etapa('planejada'), 'aprovar_desenho')).toBe(false)
    expect(esperaOPaulo(etapa('desenho'), 'planejar_comigo')).toBe(true)
    expect(esperaOPaulo(etapa('desenho'), 'aprovar_desenho')).toBe(true)
    for (const e of MODELO_PADRAO) expect(esperaOPaulo(e, 'vai_sozinho')).toBe(false)
  })

  test('podeConcluir', () => {
    const d = etapa('desenho')
    expect(podeConcluir(d, 'aprovar_desenho', 'fabrica')).toBe(false)
    expect(podeConcluir(d, 'aprovar_desenho', 'paulo')).toBe(true)
    expect(podeConcluir(d, 'aprovar_desenho', 'sessao')).toBe(false)
    expect(podeConcluir(d, 'vai_sozinho', 'fabrica')).toBe(true)
    const p = etapa('planejada')
    expect(podeConcluir(p, 'planejar_comigo', 'fabrica')).toBe(false)
    expect(podeConcluir(p, 'planejar_comigo', 'sessao')).toBe(true)
    expect(podeConcluir(p, 'aprovar_desenho', 'fabrica')).toBe(true)
  })

  test('estadoInicial', () => {
    expect(estadoInicial(MODELO_PADRAO, true, 'aprovar_desenho')).toEqual({
      etapaAtual: 'recebida',
      concluidas: [],
      nivel: 'aprovar_desenho',
      destino: null,
      espera: null,
      esperaMotivo: null,
      recusasDoDesenho: 0,
      falhasDoTeste: 0,
      versaoDoDesenho: 0,
      desenhoAprovado: null,
      encerrada: null,
      antesDaTrava: null,
    })
  })

  test('concluirEtapaAtual entra na próxima e calcula a espera', () => {
    const a = concluirEtapaAtual(
      estadoInicial(MODELO_PADRAO, true, 'planejar_comigo'),
      MODELO_PADRAO,
      true,
    )
    expect(a.etapaAtual).toBe('planejada')
    expect(a.concluidas).toEqual(['recebida'])
    expect(a.espera).toBe('planejar_comigo')
    const b = concluirEtapaAtual(
      estadoInicial(MODELO_PADRAO, true, 'vai_sozinho'),
      MODELO_PADRAO,
      true,
    )
    expect(b.espera).toBeNull()
  })

  test('concluirEtapaAtual sem tela pula etapas', () => {
    const base = estadoInicial(MODELO_PADRAO, false, 'vai_sozinho')
    const a = concluirEtapaAtual({ ...base, etapaAtual: 'planejada' }, MODELO_PADRAO, false)
    expect(a.etapaAtual).toBe('desenvolvida')
    const b = concluirEtapaAtual({ ...base, etapaAtual: 'desenvolvida' }, MODELO_PADRAO, false)
    expect(b.etapaAtual).toBe('entregue')
  })

  test('concluirEtapaAtual: etapa extra do Paulo espera concluir_etapa', () => {
    const modelo = [etapa('recebida'), extra, ...MODELO_PADRAO.slice(1)]
    const a = concluirEtapaAtual(estadoInicial(modelo, true, 'vai_sozinho'), modelo, true)
    expect(a.etapaAtual).toBe('revisao-paulo')
    expect(a.espera).toBe('concluir_etapa')
  })

  test('concluirEtapaAtual da última etapa encerra como entregue', () => {
    const base = estadoInicial(MODELO_PADRAO, true, 'vai_sozinho')
    const a = concluirEtapaAtual({ ...base, etapaAtual: 'entregue' }, MODELO_PADRAO, true)
    expect(a.encerrada).toBe('entregue')
    expect(a.concluidas).toContain('entregue')
  })

  test('concluirEtapaAtual não avança demanda encerrada nem etapa fora do modelo', () => {
    const base = estadoInicial(MODELO_PADRAO, true, 'vai_sozinho')
    const encerrada = { ...base, etapaAtual: 'entregue', encerrada: 'orientada' as const }
    expect(concluirEtapaAtual(encerrada, MODELO_PADRAO, true)).toEqual(encerrada)
    const fora = { ...base, etapaAtual: 'inexistente' }
    expect(concluirEtapaAtual(fora, MODELO_PADRAO, true)).toEqual(fora)
  })

  test('podeConcluir: etapa do Paulo (marco null) não é concluída pela Fábrica nem pela sessão', () => {
    expect(podeConcluir(extra, 'vai_sozinho', 'fabrica')).toBe(false)
    expect(podeConcluir(extra, 'vai_sozinho', 'sessao')).toBe(false)
    expect(podeConcluir(extra, 'vai_sozinho', 'paulo')).toBe(true)
  })

  test('modoDePublicacao', () => {
    expect(modoDePublicacao('urgente')).toBe('imediato')
    expect(modoDePublicacao('lote_da_noite')).toBe('lote')
    expect(modoDePublicacao('fila_de_agentes')).toBeNull()
    expect(modoDePublicacao(null)).toBeNull()
  })

  test('compararNaFila', () => {
    const velha = { destino: 'fila_de_agentes' as const, criadaEm: new Date('2026-01-01') }
    const nova = { destino: 'urgente' as const, criadaEm: new Date('2026-02-01') }
    expect(compararNaFila(nova, velha)).toBeLessThan(0)
    const outra = { destino: 'fila_de_agentes' as const, criadaEm: new Date('2026-03-01') }
    expect(compararNaFila(velha, outra)).toBeLessThan(0)
    expect(compararNaFila(outra, velha)).toBeGreaterThan(0)
  })
})

describe('demanda filha da entrega parcial', () => {
  const RESUMO =
    'Quase tudo funciona, mas o tutorial guiado não.\n' +
    'Funcionou:\n- o chat responde\n- o histórico aparece\n' +
    'Não funcionou:\n- o tutorial guiado não abre\n- o botão de fechar some no celular'

  test('o título ganha " — o que faltou" e cabe no limite', () => {
    expect(tituloDaFilha('Suporte por IA')).toBe('Suporte por IA — o que faltou')
    const longo = 'x'.repeat(LIMITE_DO_TITULO)
    const t = tituloDaFilha(longo)
    expect(t).toHaveLength(LIMITE_DO_TITULO)
    expect(t.endsWith('… — o que faltou')).toBe(true)
    expect(tituloDaFilha('  Suporte  ')).toBe('Suporte — o que faltou')
  })

  test('o trecho "Não funcionou" do resumo, sem o que funcionou', () => {
    expect(trechoQueNaoFuncionou(RESUMO)).toBe(
      '- o tutorial guiado não abre\n- o botão de fechar some no celular',
    )
    // na mesma linha, sem acento, e com o "Funcionou:" depois
    expect(trechoQueNaoFuncionou('Veredito. Nao funcionou: o login.\nFuncionou:\n- o resto')).toBe(
      'o login.',
    )
    expect(trechoQueNaoFuncionou('Quase tudo funciona.\nFuncionou:\n- tudo')).toBeNull()
    expect(trechoQueNaoFuncionou('Não funcionou:   \n')).toBeNull()
  })

  test('a descrição: o que faltou e o link para a demanda original', () => {
    expect(descricaoDaFilha(RESUMO, 'd1')).toBe(
      '- o tutorial guiado não abre\n- o botão de fechar some no celular\n\n' +
        'Demanda original: /demandas/d1',
    )
    // sem o trecho, o resumo inteiro; sem resumo, um texto padrão
    expect(descricaoDaFilha('  O cadastro não salva.  ', 'd1')).toBe(
      'O cadastro não salva.\n\nDemanda original: /demandas/d1',
    )
    expect(descricaoDaFilha(null, 'd1')).toBe(
      'O teste no navegador falhou.\n\nDemanda original: /demandas/d1',
    )
  })

  test('a descrição cabe no limite, com o link inteiro', () => {
    const d = descricaoDaFilha('y'.repeat(LIMITE_DA_DESCRICAO), 'd1')
    expect(d).toHaveLength(LIMITE_DA_DESCRICAO)
    expect(d.endsWith('…\n\nDemanda original: /demandas/d1')).toBe(true)
  })
})
