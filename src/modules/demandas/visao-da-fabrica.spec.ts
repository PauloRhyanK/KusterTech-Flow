import { describe, expect, test } from 'vitest'
import {
  demandaParaAFabrica,
  type LinhaParaAFabrica,
  type ParteParaAFabrica,
} from './visao-da-fabrica'

const linha = (o: Partial<LinhaParaAFabrica> = {}): LinhaParaAFabrica => ({
  id: 'd1',
  repositorio: 'exemplo/alfa-back',
  projeto: 'Projeto Alfa',
  titulo: 'Titulo',
  descricao: null,
  tipo: 'ajuste',
  destino: 'fila_de_agentes',
  escopo: null,
  nivel: 'vai_sozinho',
  temTela: false,
  origem: 'flow',
  criadaEm: '2026-11-25T10:00:00Z',
  etapas: [
    { chave: 'entrega', rotulo: 'Entrega', marco: 'entregue' },
    { chave: 'no_ar', rotulo: 'No ar', marco: 'no_ar' },
  ],
  etapaAtual: { chave: 'entrega', marco: 'entregue' },
  espera: null,
  encerrada: null,
  naoChegouDesde: null,
  eventos: [],
  ...o,
})

const parte: ParteParaAFabrica = {
  chave: 'back',
  repositorio: 'exemplo/alfa-back',
  objetivo: 'API',
  ordem: 0,
  dependeDe: [],
  chegaAoAr: 'publicacao',
  estado: 'em_curso',
  motivo: null,
  plano: { caminho: '.fabrica/planos/x.json', prUrl: null },
  prs: [],
  commitAlvo: null,
  publicacao: null,
}

describe('demandaParaAFabrica', () => {
  test('v1 com etapa no_ar vira encerrada entregue, marco entregue, sem partes', () => {
    const l = linha({ etapaAtual: { chave: 'no_ar', marco: 'no_ar' } })
    const v1 = demandaParaAFabrica(l, [parte], 1) as Record<string, unknown>
    expect(v1.encerrada).toBe('entregue')
    expect(v1.etapaAtual).toEqual({ chave: 'no_ar', marco: 'entregue' })
    expect(v1).not.toHaveProperty('partes')
    expect(v1).not.toHaveProperty('naoChegouDesde')
  })

  test('v1 com encerrada no_ar também aparece como entregue', () => {
    const v1 = demandaParaAFabrica(linha({ encerrada: 'no_ar' }), [], 1) as Record<string, unknown>
    expect(v1.encerrada).toBe('entregue')
  })

  test('v1 antes do no ar não muda nada', () => {
    const v1 = demandaParaAFabrica(linha(), [], 1) as Record<string, unknown>
    expect(v1.encerrada).toBeNull()
    expect(v1.etapaAtual).toEqual({ chave: 'entrega', marco: 'entregue' })
  })

  test('v2 traz partes e naoChegouDesde e não troca nada', () => {
    const l = linha({
      etapaAtual: { chave: 'no_ar', marco: 'no_ar' },
      encerrada: 'no_ar',
      naoChegouDesde: '2026-11-25T11:00:00Z',
    })
    const v2 = demandaParaAFabrica(l, [parte], 2) as Record<string, unknown>
    expect(v2.partes).toEqual([parte])
    expect(v2.naoChegouDesde).toBe('2026-11-25T11:00:00Z')
    expect(v2.encerrada).toBe('no_ar')
    expect(v2.etapaAtual).toEqual({ chave: 'no_ar', marco: 'no_ar' })
  })
})
