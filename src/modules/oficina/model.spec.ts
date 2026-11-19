import { describe, expect, it } from 'vitest'
import type { Amostra, Limpeza, RetratoDaMaquina } from './contrato'
import {
  apresentarContainer,
  avisosDaMaquina,
  diaEHora,
  fatiasDoDisco,
  formatarBytes,
  idadeCurta,
  leituraVelha,
  ordenarContainers,
  pontosDoGrafico,
  reduzirHistorico,
  servicoDoFlow,
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

type Container = RetratoDaMaquina['containers'][number]

function container(nome: string, extra: Partial<Container> = {}): Container {
  return {
    nome,
    estado: 'rodando',
    codigoDeSaida: null,
    memoriaBytes: 100,
    cpuPct: 1,
    desde: '2026-11-18T09:00:00-03:00',
    ...extra,
  }
}

describe('ordenarContainers', () => {
  it('contêiner que parou com erro vem antes dos que rodam', () => {
    const ordem = ordenarContainers([
      container('web', { memoriaBytes: 900 }),
      container('runner', { estado: 'parado', codigoDeSaida: 1, memoriaBytes: null }),
    ]).map((c) => c.nome)
    expect(ordem).toEqual(['runner', 'web'])
  })

  it('entre os que rodam, o de maior memória vem primeiro', () => {
    const ordem = ordenarContainers([
      container('pequeno', { memoriaBytes: 10 }),
      container('sem-medida', { memoriaBytes: null }),
      container('grande', { memoriaBytes: 900 }),
      container('parado-ok', { estado: 'parado', codigoDeSaida: 0, memoriaBytes: null }),
    ]).map((c) => c.nome)
    expect(ordem).toEqual(['grande', 'pequeno', 'sem-medida', 'parado-ok'])
  })

  it('não altera a lista recebida', () => {
    const lista = [container('a', { memoriaBytes: 1 }), container('b', { memoriaBytes: 2 })]
    ordenarContainers(lista)
    expect(lista.map((c) => c.nome)).toEqual(['a', 'b'])
  })
})

describe('apresentarContainer', () => {
  it('rodando é "No ar"; parado sem erro é "Parado"; parado com código é "Parou com erro"', () => {
    expect(apresentarContainer(container('a'))).toEqual({ texto: 'No ar', tom: 'neutro' })
    expect(apresentarContainer(container('b', { estado: 'parado', codigoDeSaida: 0 }))).toEqual({
      texto: 'Parado',
      tom: 'neutro',
    })
    expect(apresentarContainer(container('c', { estado: 'parado', codigoDeSaida: null }))).toEqual({
      texto: 'Parado',
      tom: 'neutro',
    })
    expect(apresentarContainer(container('d', { estado: 'parado', codigoDeSaida: 137 }))).toEqual({
      texto: 'Parou com erro',
      tom: 'erro',
    })
  })

  it('apresentarContainer nunca devolve o tom sucesso', () => {
    const casos = [
      container('a'),
      container('b', { estado: 'parado', codigoDeSaida: 0 }),
      container('c', { estado: 'parado', codigoDeSaida: 1 }),
    ]
    for (const c of casos) expect(apresentarContainer(c).tom).not.toBe('sucesso')
  })
})

describe('fatiasDoDisco', () => {
  const GB = 1024 ** 3
  const disco = {
    em: '2026-11-18T10:00:00-03:00',
    donos: [
      { nome: 'docker' as const, bytes: 31 * GB },
      { nome: 'fabrica' as const, bytes: 17 * GB },
      { nome: 'runners' as const, bytes: 11 * GB },
      { nome: 'backups' as const, bytes: 6 * GB },
      { nome: 'outros' as const, bytes: 6 * GB },
    ],
  }

  it('fatiasDoDisco somam 100% com a fatia livre', () => {
    const fatias = fatiasDoDisco(disco, 120 * GB, 49 * GB)
    expect(fatias.map((f) => f.nome)).toEqual([
      'docker',
      'fabrica',
      'runners',
      'backups',
      'outros',
      'livre',
    ])
    expect(fatias.reduce((s, f) => s + f.pct, 0)).toBeCloseTo(100)
    expect(fatias[0]).toMatchObject({ rotulo: 'Docker (imagens e volumes)', bytes: 31 * GB })
    expect(fatias.at(-1)).toMatchObject({ rotulo: 'Livre', bytes: 49 * GB })
  })

  it('o espaço sem dono informado entra em "Sistema e outros"', () => {
    const fatias = fatiasDoDisco(disco, 130 * GB, 49 * GB)
    expect(fatias.find((f) => f.nome === 'outros')?.bytes).toBe(16 * GB)
    expect(fatias.reduce((s, f) => s + f.pct, 0)).toBeCloseTo(100)
  })

  it('medidas que passam do total ainda somam 100%', () => {
    const fatias = fatiasDoDisco(disco, 100 * GB, 49 * GB)
    expect(fatias.reduce((s, f) => s + f.pct, 0)).toBeCloseTo(100)
  })
})

describe('pontosDoGrafico', () => {
  it('pontosDoGrafico de um valor só desenha uma linha reta', () => {
    const pontos = pontosDoGrafico([5], 300, 70).split(' ')
    expect(pontos).toHaveLength(2)
    const [a, b] = pontos.map((p) => p.split(',').map(Number))
    expect(a![0]).toBe(0)
    expect(b![0]).toBe(300)
    expect(a![1]).toBe(b![1])
  })

  it('o maior valor fica no alto e o menor embaixo, da esquerda para a direita', () => {
    const pontos = pontosDoGrafico([0, 10, 5], 300, 70)
      .split(' ')
      .map((p) => p.split(',').map(Number))
    expect(pontos.map((p) => p[0])).toEqual([0, 150, 300])
    expect(pontos[1]![1]).toBeLessThan(pontos[2]![1]!)
    expect(pontos[2]![1]).toBeLessThan(pontos[0]![1]!)
    for (const [, y] of pontos) {
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(70)
    }
  })

  it('sem valores não há pontos', () => {
    expect(pontosDoGrafico([], 300, 70)).toBe('')
  })
})

describe('idadeCurta', () => {
  const base = new Date('2026-11-18T12:00:00-03:00')
  const antes = (ms: number) => new Date(base.getTime() - ms)
  it('segundos, minutos, horas e dias', () => {
    expect(idadeCurta(antes(35_000), base)).toBe('35 s')
    expect(idadeCurta(antes(6 * 60_000), base)).toBe('6 min')
    expect(idadeCurta(antes(3 * hora), base)).toBe('3 h')
    expect(idadeCurta(antes(12 * 24 * hora), base)).toBe('12 dias')
    expect(idadeCurta(antes(30 * hora), base)).toBe('1 dia')
  })
  it('data no futuro conta como agora', () => {
    expect(idadeCurta(new Date(base.getTime() + 5000), base)).toBe('0 s')
  })
})

describe('diaEHora', () => {
  const base = new Date('2026-11-18T12:00:00-03:00')
  it('hoje, ontem e data curta, no fuso de São Paulo', () => {
    expect(diaEHora(new Date('2026-11-18T04:00:00-03:00'), base)).toEqual({
      dia: 'hoje',
      hora: '04:00',
    })
    expect(diaEHora(new Date('2026-11-17T23:30:00-03:00'), base)).toEqual({
      dia: 'ontem',
      hora: '23:30',
    })
    expect(diaEHora(new Date('2026-11-16T04:00:00-03:00'), base)).toEqual({
      dia: '16/11',
      hora: '04:00',
    })
  })
})

describe('servicoDoFlow', () => {
  it('soma a memória dos contêineres do Flow e diz quantos estão no ar', () => {
    const r = servicoDoFlow([
      container('flow-web', { memoriaBytes: 300 * 1024 ** 2 }),
      container('flow-worker', { memoriaBytes: 200 * 1024 ** 2 }),
      container('fabrica-x', { memoriaBytes: 900 * 1024 ** 2 }),
    ])
    expect(r).toEqual({ total: 2, noAr: 2, memoriaBytes: 500 * 1024 ** 2 })
  })

  it('sem contêiner do Flow devolve null', () => {
    expect(servicoDoFlow([container('fabrica-x')])).toBeNull()
  })
})
