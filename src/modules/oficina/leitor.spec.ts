import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lerOficina } from './leitor'

const agora = new Date('2026-11-18T12:00:00-03:00')
const hora = 3_600_000

function amostraEm(em: Date, extra: Record<string, unknown> = {}) {
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

const jsonl = (objetos: unknown[]) => objetos.map((o) => JSON.stringify(o)).join('\n') + '\n'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'oficina-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('lerOficina', () => {
  it('diretório inexistente devolve leitura vazia, sem lançar', async () => {
    const l = await lerOficina('/nao/existe', agora)
    expect(l.amostra).toBeNull()
    expect(l.retrato).toBeNull()
    expect(l.discoPorDono).toBeNull()
    expect(l.limpezas).toEqual([])
    expect(l.historico).toEqual([])
    expect(l.avisos).toEqual([])
    expect(l.linhasIgnoradas).toBe(0)
  })

  it('a amostra é a última linha válida e o histórico é reduzido', async () => {
    const primeira = amostraEm(new Date(agora.getTime() - 2 * 60_000))
    const segunda = amostraEm(new Date(agora.getTime() - 60_000), { memDisponivelMb: 5000 })
    await writeFile(join(dir, 'metricas.jsonl'), jsonl([primeira, segunda]))
    const l = await lerOficina(dir, agora)
    expect(l.amostra?.em).toBe(segunda.em)
    expect(l.historico.length).toBeGreaterThan(0)
    expect(l.linhasIgnoradas).toBe(0)
  })

  it('última linha truncada é ignorada e a amostra é a anterior', async () => {
    const primeira = amostraEm(new Date(agora.getTime() - 2 * 60_000))
    const segunda = amostraEm(new Date(agora.getTime() - 60_000))
    await writeFile(
      join(dir, 'metricas.jsonl'),
      jsonl([primeira, segunda]) + '{"em":"2026-11-18T10:02',
    )
    const l = await lerOficina(dir, agora)
    expect(l.amostra?.em).toBe(segunda.em)
    expect(l.linhasIgnoradas).toBe(1)
  })

  it('linha que não é JSON no meio do arquivo é contada e pulada', async () => {
    const a = amostraEm(new Date(agora.getTime() - 2 * 60_000))
    const b = amostraEm(new Date(agora.getTime() - 60_000))
    await writeFile(
      join(dir, 'metricas.jsonl'),
      `${JSON.stringify(a)}\nisto não é json\n${JSON.stringify({ ...b, em: 'ontem' })}\n${JSON.stringify(b)}\n`,
    )
    const l = await lerOficina(dir, agora)
    expect(l.amostra?.em).toBe(b.em)
    expect(l.linhasIgnoradas).toBe(2)
  })

  it('arquivo grande: lê só o fim e descarta a primeira linha parcial', async () => {
    const linhas: unknown[] = []
    for (let i = 0; i < 60_000; i++) {
      linhas.push(amostraEm(new Date(agora.getTime() - (60_000 - i) * 1000)))
    }
    await writeFile(join(dir, 'metricas.jsonl'), jsonl(linhas))
    const l = await lerOficina(dir, agora)
    expect(l.amostra?.em).toBe((linhas[59_999] as { em: string }).em)
    expect(l.linhasIgnoradas).toBe(0)
  })

  it('limpezas vêm da mais recente para a mais antiga, no máximo 7', async () => {
    const limpezas = Array.from({ length: 9 }, (_, i) => ({
      em: new Date(agora.getTime() - (9 - i) * 24 * hora).toISOString(),
      ok: true,
      livreAntesBytes: 1,
      livreDepoisBytes: 2,
      liberadoBytes: i,
    }))
    await writeFile(join(dir, 'limpezas.jsonl'), jsonl(limpezas))
    const l = await lerOficina(dir, agora)
    expect(l.limpezas).toHaveLength(7)
    expect(l.limpezas[0]?.liberadoBytes).toBe(8)
    expect(l.limpezas[6]?.liberadoBytes).toBe(2)
  })

  it('avisos com mais de 24 h ficam de fora', async () => {
    const aviso = (horasAtras: number, mensagem: string) => ({
      em: new Date(agora.getTime() - horasAtras * hora).toISOString(),
      origem: 'oficina',
      tipo: 'disco',
      severidade: 'alta',
      mensagem,
    })
    await writeFile(join(dir, 'alertas.jsonl'), jsonl([aviso(25, 'velho'), aviso(23, 'recente')]))
    const l = await lerOficina(dir, agora)
    expect(l.avisos.map((a) => a.mensagem)).toEqual(['recente'])
  })

  it('retrato.json inválido deixa retrato nulo e não afeta a amostra', async () => {
    await writeFile(join(dir, 'retrato.json'), '{"em": "quebrado"')
    await writeFile(
      join(dir, 'metricas.jsonl'),
      jsonl([amostraEm(new Date(agora.getTime() - 60_000))]),
    )
    const l = await lerOficina(dir, agora)
    expect(l.retrato).toBeNull()
    expect(l.amostra).not.toBeNull()
  })

  it('retrato.json e disco-por-dono.json válidos são lidos', async () => {
    const exemplos = join(__dirname, 'exemplos')
    const { readFile } = await import('node:fs/promises')
    for (const arquivo of ['retrato.json', 'disco-por-dono.json']) {
      await writeFile(join(dir, arquivo), await readFile(join(exemplos, arquivo)))
    }
    const l = await lerOficina(dir, agora)
    expect(l.retrato?.containers).toHaveLength(2)
    expect(l.discoPorDono?.donos).toHaveLength(5)
  })
})
