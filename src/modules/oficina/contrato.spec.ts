import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  amostraSchema,
  avisoSchema,
  discoPorDonoSchema,
  limpezaSchema,
  limpezaUltimaSchema,
  retratoDaMaquinaSchema,
} from './contrato'

const dir = join(__dirname, 'exemplos')
const texto = (arquivo: string) => readFileSync(join(dir, arquivo), 'utf8')
const linhas = (arquivo: string) =>
  texto(arquivo)
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
const json = (arquivo: string) => JSON.parse(texto(arquivo)) as Record<string, unknown>

describe('contrato dos arquivos da oficina', () => {
  it('amostra de hoje (sem cpuUsoPct nem bytes de disco) é aceita', () => {
    for (const linha of linhas('metricas.jsonl')) {
      expect(amostraSchema.safeParse(linha).success).toBe(true)
    }
  })

  it('amostra com campo desconhecido e com campos novos é aceita', () => {
    const base = linhas('metricas.jsonl')[0]
    const r = amostraSchema.safeParse({
      ...base,
      campoNovo: 1,
      cpuUsoPct: 12.5,
      discoLivreBytes: 100,
      discoTotalBytes: 200,
    })
    expect(r.success).toBe(true)
  })

  it('amostra com data sem fuso é recusada', () => {
    const base = linhas('metricas.jsonl')[0]
    expect(amostraSchema.safeParse({ ...base, em: '2026-11-18T10:01:00' }).success).toBe(false)
  })

  it('aceita os avisos de exemplo e recusa aviso sem mensagem', () => {
    for (const linha of linhas('alertas.jsonl')) {
      expect(avisoSchema.safeParse(linha).success).toBe(true)
    }
    const semMensagem = { ...linhas('alertas.jsonl')[0] }
    delete semMensagem.mensagem
    expect(avisoSchema.safeParse(semMensagem).success).toBe(false)
  })

  it('aceita limpezas, limpeza-ultima e disco por dono de exemplo', () => {
    for (const linha of linhas('limpezas.jsonl')) {
      expect(limpezaSchema.safeParse(linha).success).toBe(true)
    }
    expect(limpezaUltimaSchema.safeParse(json('limpeza-ultima.json')).success).toBe(true)
    expect(discoPorDonoSchema.safeParse(json('disco-por-dono.json')).success).toBe(true)
  })

  it('aceita o retrato de exemplo', () => {
    expect(retratoDaMaquinaSchema.safeParse(json('retrato.json')).success).toBe(true)
  })

  it('retrato com estado de contêiner desconhecido é recusado', () => {
    const r = json('retrato.json') as { containers: Record<string, unknown>[] }
    const ruim = { ...r, containers: [{ ...r.containers[0], estado: 'pausado' }] }
    expect(retratoDaMaquinaSchema.safeParse(ruim).success).toBe(false)
  })
})
