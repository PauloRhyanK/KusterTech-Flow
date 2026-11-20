import { lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { db } from '@/lib/db'
import { apagarArquivo, diretorioDosArquivos, ehParcial } from './arquivos'
import { capturaVencida, RETENCAO_DAS_CAPTURAS_MS } from './transicoes'

const IDADE_MAXIMA_DO_PARCIAL_MS = 24 * 60 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Capturas vencidas saem do disco e ganham `apagadoEm`; `.parcial` com mais de 1 dia saem. */
export async function limparArquivosDeDemandas(
  agora: Date,
): Promise<{ capturas: number; parciais: number }> {
  return { capturas: await limparCapturas(agora), parciais: await limparParciais(agora) }
}

async function limparCapturas(agora: Date): Promise<number> {
  const candidatas = await db.arquivoDaDemanda.findMany({
    where: {
      tipo: 'CAPTURA',
      apagadoEm: null,
      demanda: { entregueEm: { lt: new Date(agora.getTime() - RETENCAO_DAS_CAPTURAS_MS) } },
    },
    select: { id: true, demandaId: true, tipo: true, apagadoEm: true, demanda: true },
  })
  let apagadas = 0
  for (const a of candidatas) {
    const arquivo = { tipo: a.tipo.toLowerCase(), apagadoEm: a.apagadoEm }
    if (!capturaVencida(arquivo, a.demanda.entregueEm, agora)) continue
    // Disco antes do banco: se a marcação falhar, a próxima rodada apaga de novo (ausente é ok).
    await apagarArquivo(a.demandaId, a.id)
    const { count } = await db.arquivoDaDemanda.updateMany({
      where: { id: a.id, apagadoEm: null },
      data: { apagadoEm: agora },
    })
    apagadas += count
  }
  return apagadas
}

async function limparParciais(agora: Date): Promise<number> {
  const raiz = join(diretorioDosArquivos(), 'demandas')
  let demandas: string[]
  try {
    demandas = await readdir(raiz)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw err
  }
  let apagados = 0
  for (const demandaId of demandas) {
    if (!UUID.test(demandaId)) continue
    const pasta = join(raiz, demandaId)
    if (!(await lstat(pasta)).isDirectory()) continue
    for (const nome of await readdir(pasta)) {
      if (!ehParcial(nome)) continue
      const caminho = join(pasta, nome)
      const info = await lstat(caminho)
      if (!info.isFile() || agora.getTime() - info.mtimeMs <= IDADE_MAXIMA_DO_PARCIAL_MS) continue
      await rm(caminho, { force: true })
      apagados += 1
    }
  }
  return apagados
}
