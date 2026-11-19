import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { z } from 'zod'
import {
  amostraSchema,
  avisoSchema,
  discoPorDonoSchema,
  limpezaSchema,
  retratoDaMaquinaSchema,
  type Amostra,
} from './contrato'
import {
  LIMITES_DA_OFICINA,
  reduzirHistorico,
  type LeituraDaMaquina,
  type PontoDoHistorico,
} from './model'

const MAX_BYTES_METRICAS = 6 * 1024 * 1024
const BLOCO_BYTES = 256 * 1024
const BYTES_SO_AMOSTRA = 64 * 1024
const CACHE_HISTORICO_MS = 10 * 60_000
const MAX_LIMPEZAS = 7

const cacheDoHistorico = new Map<string, { em: number; historico: PontoDoHistorico[] }>()

interface Linhas<T> {
  validas: T[]
  ignoradas: number
}

function lerLinhas<T>(texto: string, schema: z.ZodType<T>): Linhas<T> {
  const validas: T[] = []
  let ignoradas = 0
  for (const linha of texto.split('\n')) {
    if (linha.trim() === '') continue
    let bruto: unknown
    try {
      bruto = JSON.parse(linha)
    } catch {
      ignoradas++
      continue
    }
    const r = schema.safeParse(bruto)
    if (r.success) validas.push(r.data)
    else ignoradas++
  }
  return { validas, ignoradas }
}

async function lerTexto(caminho: string): Promise<string | null> {
  try {
    return await readFile(caminho, 'utf8')
  } catch {
    return null
  }
}

async function lerJson<T>(caminho: string, schema: z.ZodType<T>): Promise<T | null> {
  const texto = await lerTexto(caminho)
  if (texto === null) return null
  try {
    const r = schema.safeParse(JSON.parse(texto))
    return r.success ? r.data : null
  } catch {
    return null
  }
}

// Lê o fim do arquivo, em blocos, até cobrir `desde` (ou o limite de bytes).
// Descarta a primeira linha quando ela pode estar cortada.
async function lerFimDasMetricas(
  caminho: string,
  maxBytes: number,
  desde: Date | null,
): Promise<string | null> {
  let arquivo
  try {
    arquivo = await open(caminho, 'r')
  } catch {
    return null
  }
  try {
    const { size } = await arquivo.stat()
    let inicio = size
    let buffer = Buffer.alloc(0)
    while (inicio > 0 && size - inicio < maxBytes) {
      const tamanho = Math.min(BLOCO_BYTES, inicio, maxBytes - (size - inicio))
      inicio -= tamanho
      const bloco = Buffer.alloc(tamanho)
      await arquivo.read(bloco, 0, tamanho, inicio)
      buffer = Buffer.concat([bloco, buffer])
      if (desde && inicio > 0 && primeiraDataCompleta(buffer) < desde.getTime()) break
    }
    let texto = buffer.toString('utf8')
    if (inicio > 0) {
      const quebra = texto.indexOf('\n')
      texto = quebra === -1 ? '' : texto.slice(quebra + 1)
    }
    return texto
  } finally {
    await arquivo.close()
  }
}

// Data da primeira linha completa do buffer (a anterior pode estar cortada).
function primeiraDataCompleta(buffer: Buffer): number {
  const texto = buffer.toString('utf8')
  const ini = texto.indexOf('\n')
  if (ini === -1) return Infinity
  const fim = texto.indexOf('\n', ini + 1)
  if (fim === -1) return Infinity
  try {
    const em = (JSON.parse(texto.slice(ini + 1, fim)) as { em?: unknown }).em
    const t = typeof em === 'string' ? new Date(em).getTime() : NaN
    return Number.isNaN(t) ? Infinity : t
  } catch {
    return Infinity
  }
}

export async function lerOficina(dir: string, agora: Date): Promise<LeituraDaMaquina> {
  const caminhoMetricas = join(dir, 'metricas.jsonl')
  const emCache = cacheDoHistorico.get(dir)
  const cacheValido =
    emCache !== undefined &&
    agora.getTime() - emCache.em >= 0 &&
    agora.getTime() - emCache.em < CACHE_HISTORICO_MS

  const corte = new Date(agora.getTime() - LIMITES_DA_OFICINA.diasDeHistorico * 86_400_000)
  const textoMetricas = await lerFimDasMetricas(
    caminhoMetricas,
    cacheValido ? BYTES_SO_AMOSTRA : MAX_BYTES_METRICAS,
    cacheValido ? null : corte,
  )
  const metricas: Linhas<Amostra> = textoMetricas
    ? lerLinhas(textoMetricas, amostraSchema)
    : { validas: [], ignoradas: 0 }

  let historico: PontoDoHistorico[]
  if (cacheValido) {
    historico = emCache.historico
  } else {
    historico = reduzirHistorico(metricas.validas, agora)
    if (textoMetricas !== null) {
      cacheDoHistorico.set(dir, { em: agora.getTime(), historico })
    }
  }

  const textoLimpezas = await lerTexto(join(dir, 'limpezas.jsonl'))
  const limpezas = textoLimpezas
    ? lerLinhas(textoLimpezas, limpezaSchema)
    : { validas: [], ignoradas: 0 }

  const textoAvisos = await lerTexto(join(dir, 'alertas.jsonl'))
  const alertas = textoAvisos ? lerLinhas(textoAvisos, avisoSchema) : { validas: [], ignoradas: 0 }
  const limiteDosAvisos = agora.getTime() - LIMITES_DA_OFICINA.avisosH * 3_600_000

  return {
    lidaEm: agora,
    amostra: metricas.validas.at(-1) ?? null,
    retrato: await lerJson(join(dir, 'retrato.json'), retratoDaMaquinaSchema),
    discoPorDono: await lerJson(join(dir, 'disco-por-dono.json'), discoPorDonoSchema),
    limpezas: limpezas.validas
      .sort((a, b) => new Date(b.em).getTime() - new Date(a.em).getTime())
      .slice(0, MAX_LIMPEZAS),
    historico,
    avisos: alertas.validas.filter((a) => new Date(a.em).getTime() >= limiteDosAvisos),
    linhasIgnoradas: metricas.ignoradas + limpezas.ignoradas + alertas.ignoradas,
  }
}
