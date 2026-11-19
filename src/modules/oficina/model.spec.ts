import { describe, expect, it } from 'vitest'
import type { Amostra, Limpeza } from './contrato'
import {
  avisosDaMaquina,
  formatarBytes,
  leituraVelha,
  reduzirHistorico,
  type LeituraDaMaquina,
} from './model'

const agora = new Date('2026-11-18T12:00:00-03:00')
const hora = 3_600_000

function amostra(em: Date, extra: Partial<Amostra> = {}): Amostra {
  return {
    em: em.toISOString(),
    memTotalMb: 7840,
    memDisponivelMb: 6000,
    swapUsadaMb: 0,
    carga1: 0.4,
    discoUsoPct: 40,
    jobsCi: 0,
    vagas: 5,
    raias: 2,
    ...extra,
  }
}

function limpeza(horasAtras: number, ok = true): Limpeza {
  return {
    em: new Date(agora.getTime() - horasAtras * hora).toISOString(),
    ok,
    livreAntesBytes: 1,
    livreDepoisBytes: 2,
    liberadoBytes: 1,
  }
}

function leitura(
  extra: Partial<Amostra> = {},
  limpezas: Limpeza[] = [limpeza(2)],
  semAmostra = false,
): LeituraDaMaquina {
  return {
    lidaEm: agora,
    amostra: semAmostra ? null : amostra(agora, extra),
    retrato: null,
    discoPorDono: null,
    limpezas,
    historico: [],
    avisos: [],
    linhasIgnoradas: 0,
  }
}

const tipos = (l: LeituraDaMaquina, ram: number | null = 2048) =>
  avisosDaMaquina(l, ram, agora).map((a) => a.tipo)

describe('leituraVelha', () => {
  it('leitura de 5 min e 1 s é velha; de 5 min exatos não', () => {
    expect(leituraVelha(new Date(agora.getTime() - 301_000), agora)).toBe(true)
    expect(leituraVelha(new Date(agora.getTime() - 300_000), agora)).toBe(false)
  })
})

describe('reduzirHistorico', () => {
  it('histórico tem um ponto a cada 10 min e só os últimos 7 dias', () => {
    const fim = new Date('2026-11-18T12:00:00-03:00')
    const minuto = 60_000
    const amostras: Amostra[] = [amostra(new Date(fim.getTime() - 8 * 24 * hora))]
    for (let i = 3 * 24 * 60; i >= 1; i--) {
      amostras.push(amostra(new Date(fim.getTime() - i * minuto)))
    }
    const pontos = reduzirHistorico(amostras, fim)
    expect(pontos).toHaveLength(432)
    expect(pontos[0]?.em.getTime()).toBeGreaterThanOrEqual(fim.getTime() - 7 * 24 * hora)
    expect(pontos[0]?.em.getTime()).toBeLessThan(pontos[1]?.em.getTime() ?? 0)
  })

  it('leva a memória disponível e o disco livre (nulo quando ausente)', () => {
    const [ponto] = reduzirHistorico([amostra(agora, { memDisponivelMb: 1234 })], agora)
    expect(ponto?.memDisponivelMb).toBe(1234)
    expect(ponto?.discoLivreBytes).toBeNull()
    const [comDisco] = reduzirHistorico([amostra(agora, { discoLivreBytes: 99 })], agora)
    expect(comDisco?.discoLivreBytes).toBe(99)
  })
})

describe('avisosDaMaquina', () => {
  it('memória disponível abaixo do mínimo gera aviso de memória', () => {
    expect(tipos(leitura({ memDisponivelMb: 1100 }))).toContain('memoria')
  })

  it('sem ramMinimaMb não há aviso de memória', () => {
    expect(tipos(leitura({ memDisponivelMb: 100 }), null)).not.toContain('memoria')
  })

  it('disco em 81% gera aviso; em 80% não', () => {
    expect(tipos(leitura({ discoUsoPct: 81 }))).toContain('disco')
    expect(tipos(leitura({ discoUsoPct: 80 }))).not.toContain('disco')
  })

  it('limpeza de 37 h atrás gera aviso; de 35 h não', () => {
    expect(tipos(leitura({}, [limpeza(37)]))).toContain('limpeza')
    expect(tipos(leitura({}, [limpeza(35)]))).not.toContain('limpeza')
  })

  it('nenhuma limpeza gera aviso quando a máquina está informando', () => {
    expect(tipos(leitura({}, []))).toContain('limpeza')
  })

  it('leitura totalmente vazia não gera aviso algum', () => {
    expect(avisosDaMaquina(leitura({}, [], true), 2048, agora)).toEqual([])
  })

  it('limpeza mais recente com ok=false gera aviso', () => {
    expect(tipos(leitura({}, [limpeza(2, false), limpeza(26)]))).toContain('limpeza')
  })

  it('cada aviso registrado vira um aviso com a mensagem dele', () => {
    const l = leitura()
    l.avisos = [
      {
        em: agora.toISOString(),
        origem: 'oficina',
        tipo: 'backup',
        severidade: 'media',
        mensagem: 'Backup da noite não terminou',
      },
    ]
    const resultado = avisosDaMaquina(l, 2048, agora)
    expect(resultado.map((a) => a.mensagem)).toContain('Backup da noite não terminou')
  })
})

describe('formatarBytes', () => {
  it('formata em GB e MB', () => {
    expect(formatarBytes(52613349376)).toBe('49,0 GB')
    expect(formatarBytes(222298112)).toBe('212 MB')
  })
})
