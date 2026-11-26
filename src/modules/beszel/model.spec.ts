import { describe, expect, it } from 'vitest'
import type { AmostraBruta, ContainerBruto, SistemaBruto } from './contrato'
import {
  apresentarMaquina,
  avisosDoBeszel,
  desdeDoStatus,
  formatarTaxa,
  ligarAoCadastro,
  ordenarMaquinas,
  paraDetalhe,
  paraMaquina,
  seloDeMetricas,
  temSeloDeMetricas,
  type MaquinaNoBeszel,
} from './model'

const agora = new Date('2026-11-26T17:06:00Z')
const GB = 1024 ** 3
const MB = 1024 ** 2

function sistema(parcial: Partial<SistemaBruto> = {}): SistemaBruto {
  return {
    id: 'abcdefghijklmno',
    name: 'vps-alfa',
    status: 'up',
    updated: '2026-11-26 17:05:26.648Z',
    info: { cpu: 3.08, mp: 62.55, dp: 86.2, la: [0.09, 0.06, 0.01], u: 1125562, t: 2, bb: 4251 },
    ...parcial,
  }
}

function maquina(parcial: Partial<MaquinaNoBeszel> = {}): MaquinaNoBeszel {
  return {
    sistemaId: 'abcdefghijklmno',
    nome: 'vps-beta',
    noAr: true,
    lidaEm: new Date('2026-11-26T17:05:30Z'),
    ligadaHaS: 1000,
    nucleos: 2,
    cpuPct: 10,
    memPct: 50,
    discoPct: 30,
    carga: [0.1, 0.1, 0.1],
    redeBytesS: 1000,
    containers: 3,
    ...parcial,
  }
}

describe('paraMaquina', () => {
  it('lê o resumo do sistema', () => {
    const m = paraMaquina(sistema(), 6, agora)
    expect(m).toMatchObject({
      sistemaId: 'abcdefghijklmno',
      nome: 'vps-alfa',
      noAr: true,
      discoPct: 86.2,
      memPct: 62.55,
      cpuPct: 3.08,
      nucleos: 2,
      carga: [0.09, 0.06, 0.01],
      ligadaHaS: 1125562,
      redeBytesS: 4251,
      containers: 6,
    })
    expect(m.lidaEm.toISOString()).toBe('2026-11-26T17:05:26.648Z')
  })

  it('sistema pendente e sem informações fica sem resposta e sem números', () => {
    const m = paraMaquina(sistema({ status: 'pending', info: {} }), 0, agora)
    expect(m.noAr).toBe(false)
    expect(m).toMatchObject({
      cpuPct: null,
      memPct: null,
      discoPct: null,
      carga: null,
      ligadaHaS: null,
      nucleos: null,
      redeBytesS: null,
    })
  })

  it('leitura com mais de 5 min não está no ar', () => {
    const m = paraMaquina(sistema({ updated: '2026-11-26 17:00:00.000Z' }), 0, agora)
    expect(m.noAr).toBe(false)
  })
})

describe('apresentarMaquina', () => {
  it('disco acima de 80% é atenção', () => {
    expect(apresentarMaquina(maquina({ discoPct: 86.2 }), agora).tom).toBe('atencao')
  })
  it('memória acima de 90% é atenção', () => {
    expect(apresentarMaquina(maquina({ memPct: 93 }), agora).tom).toBe('atencao')
  })
  it('nos limites é neutro', () => {
    expect(apresentarMaquina(maquina({ discoPct: 80, memPct: 90 }), agora)).toEqual({
      tom: 'neutro',
      texto: null,
    })
  })
  it('sem resposta diz há quanto tempo', () => {
    const m = maquina({ noAr: false, lidaEm: new Date('2026-11-26T16:54:00Z') })
    expect(apresentarMaquina(m, agora)).toEqual({
      tom: 'sem_resposta',
      texto: 'Sem resposta há 12 min',
    })
  })
})

describe('paraDetalhe', () => {
  const amostra: AmostraBruta = {
    created: '2026-11-26 17:05:26.648Z',
    stats: {
      cpu: 13.08,
      m: 1.92,
      mu: 0.96,
      mp: 50.23,
      s: 2,
      su: 0.14,
      d: 56.79,
      du: 16.82,
      dp: 30.93,
      b: [158, 64500],
    },
  }
  const cs: ContainerBruto[] = [
    {
      system: 'abcdefghijklmno',
      name: 'app-caddy-1',
      cpu: 0.01,
      memory: 18.03,
      health: 0,
      status: 'Up 2 weeks',
    },
    {
      system: 'abcdefghijklmno',
      name: 'app-postgres-1',
      cpu: 2.3,
      memory: 116.14,
      health: 2,
      status: 'Up 2 weeks',
    },
  ]

  it('converte memória, disco, rede e contêineres', () => {
    const d = paraDetalhe(maquina(), amostra, cs, [amostra])
    expect(d.memoria).toEqual({
      usadaBytes: 0.96 * GB,
      totalBytes: 1.92 * GB,
      swapUsadaBytes: 0.14 * GB,
      swapTotalBytes: 2 * GB,
    })
    expect(d.disco).toEqual({ usadoBytes: 16.82 * GB, totalBytes: 56.79 * GB })
    expect(d.rede).toEqual({ enviandoBytesS: 158, recebendoBytesS: 64500 })
    expect(d.containersDetalhe.map((c) => c.nome)).toEqual(['app-postgres-1', 'app-caddy-1'])
    expect(d.containersDetalhe[0]).toEqual({
      nome: 'app-postgres-1',
      cpuPct: 2.3,
      memoriaBytes: 116.14 * MB,
      desde: '2 semanas',
      saude: 'saudavel',
    })
    expect(d.containersDetalhe[1]!.saude).toBe('sem_checagem')
    expect(d.historico).toEqual([
      {
        em: new Date('2026-11-26T17:05:26.648Z'),
        cpuPct: 13.08,
        memPct: 50.23,
        discoPct: 30.93,
        recebendoBytesS: 64500,
      },
    ])
  })

  it('sem amostra não inventa números', () => {
    const d = paraDetalhe(maquina(), null, [], [])
    expect(d.memoria).toBeNull()
    expect(d.disco).toBeNull()
    expect(d.rede).toBeNull()
    expect(d.historico).toEqual([])
  })
})

describe('avisosDoBeszel', () => {
  it('avisa disco e memória acima do limite', () => {
    expect(avisosDoBeszel(maquina({ discoPct: 86.2, memPct: 93.4 }))).toEqual([
      expect.objectContaining({
        tipo: 'disco',
        mensagem: 'Disco em 86%, acima do limite de 80%.',
      }),
      expect.objectContaining({
        tipo: 'memoria',
        mensagem: 'Memória em 93%, acima do limite de 90%.',
      }),
    ])
  })
  it('sem resposta não avisa nada', () => {
    expect(avisosDoBeszel(maquina({ noAr: false, discoPct: 99 }))).toEqual([])
  })
})

describe('ligarAoCadastro e seloDeMetricas', () => {
  it('liga pelo identificador externo', () => {
    const r = ligarAoCadastro(
      [maquina({ nome: 'vps-alfa' }), maquina({ nome: 'vps-gama' })],
      [{ id: 'r1', identificadorExterno: 'vps-alfa' }],
    )
    expect(r.map((m) => m.recursoId)).toEqual(['r1', null])
  })
  it('selo do inventário', () => {
    const nomes = new Set(['vps-alfa'])
    expect(seloDeMetricas('vps-alfa', nomes)).toBe('Beszel')
    expect(seloDeMetricas('vps-zeta', nomes)).toBe('Sem métricas')
    expect(seloDeMetricas(null, nomes)).toBe('Sem métricas')
  })
})

describe('temSeloDeMetricas', () => {
  it('servidores e bancos levam o selo; contêiner, storage e outro não', () => {
    expect(temSeloDeMetricas('SERVIDOR')).toBe(true)
    expect(temSeloDeMetricas('BANCO')).toBe(true)
    expect(temSeloDeMetricas('CONTAINER')).toBe(false)
    expect(temSeloDeMetricas('STORAGE')).toBe(false)
    expect(temSeloDeMetricas('OUTRO')).toBe(false)
  })
})

describe('ordenarMaquinas', () => {
  const ms = [
    maquina({ nome: 'vps-beta' }),
    maquina({ nome: 'oficina' }),
    maquina({ nome: 'vps-alfa', discoPct: 86 }),
  ]
  it('cadastro: a local primeiro, depois o nome', () => {
    expect(ordenarMaquinas(ms, 'oficina', agora, 'cadastro').map((m) => m.nome)).toEqual([
      'oficina',
      'vps-alfa',
      'vps-beta',
    ])
  })
  it('atenção: as que pedem olhar primeiro', () => {
    expect(ordenarMaquinas(ms, 'oficina', agora, 'atencao').map((m) => m.nome)).toEqual([
      'vps-alfa',
      'oficina',
      'vps-beta',
    ])
  })
})

describe('formatarTaxa', () => {
  it.each([
    [0, '0 B/s'],
    [500, '500 B/s'],
    [4251, '4 KB/s'],
    [1942480, '1,9 MB/s'],
  ])('%d → %s', (b, texto) => {
    expect(formatarTaxa(b)).toBe(texto)
  })
})

describe('desdeDoStatus', () => {
  it.each([
    ['Up 2 weeks', '2 semanas'],
    ['Up About an hour', '1 hora'],
    ['Up 3 days (healthy)', '3 dias'],
    ['Exited (1) 2 hours ago', null],
  ])('%s → %s', (status, texto) => {
    expect(desdeDoStatus(status)).toBe(texto)
  })
})
