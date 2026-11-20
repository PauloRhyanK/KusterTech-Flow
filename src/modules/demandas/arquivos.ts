import { mkdir, open, rename, rm, type FileHandle } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as ReadableStreamDoNode } from 'node:stream/web'
import { CONTEUDOS_ACEITOS } from './transicoes'

// Sem `import 'server-only'`: o módulo também roda no worker (Node puro), onde esse pacote lança.
// Componentes não importam este arquivo; só services, rotas e o worker.

const DIRETORIO_PADRAO = '/var/lib/flow/arquivos'
const SUFIXO_PARCIAL = '.parcial'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CSP_DO_DESENHO =
  "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:"

// Tipos aceitos (CONTEUDOS_ACEITOS) que o navegador mostra sem executar nada; o HTML tem regra
// própria e qualquer tipo ativo (svg, xml, script) fica de fora mesmo que um dia seja aceito.
const TIPO_ATIVO = /(^text\/html$)|svg|xml|javascript|ecmascript/
const INLINE_SEGURO: ReadonlySet<string> = new Set(
  Object.values(CONTEUDOS_ACEITOS)
    .flat()
    .filter((t) => !TIPO_ATIVO.test(t)),
)

export function diretorioDosArquivos(): string {
  return process.env.FLOW_ARQUIVOS_DIR || DIRETORIO_PADRAO
}

/** `<dir>/demandas/<demandaId>/<arquivoId>`; só ids uuid entram no caminho (nunca o nome enviado). */
export function caminhoDoArquivo(demandaId: string, arquivoId: string): string {
  if (!UUID.test(demandaId) || !UUID.test(arquivoId)) {
    throw new Error('Identificador de arquivo inválido.')
  }
  const raiz = resolve(diretorioDosArquivos())
  const caminho = resolve(raiz, 'demandas', demandaId, arquivoId)
  if (!caminho.startsWith(raiz + sep)) throw new Error('Caminho fora do diretório de arquivos.')
  return caminho
}

export function caminhoParcial(demandaId: string, arquivoId: string): string {
  return caminhoDoArquivo(demandaId, arquivoId) + SUFIXO_PARCIAL
}

export function ehParcial(nome: string): boolean {
  return nome.endsWith(SUFIXO_PARCIAL) && UUID.test(nome.slice(0, -SUFIXO_PARCIAL.length))
}

/**
 * Grava em `<arquivoId>.parcial` contando os bytes; passou do `limite` → apaga o parcial e
 * devolve `grande` (o `Content-Length` não é confiável). No fim, `fsync` e `rename`.
 */
export async function gravarArquivo(
  demandaId: string,
  arquivoId: string,
  corpo: ReadableStream<Uint8Array>,
  limite: number,
): Promise<{ ok: true; tamanho: number } | { ok: false; motivo: 'grande' }> {
  const r = await gravarParcial(demandaId, arquivoId, corpo, limite)
  if (!r.ok) return r
  try {
    await promoverParcial(demandaId, arquivoId, arquivoId)
  } catch (err) {
    await rm(caminhoParcial(demandaId, arquivoId), { force: true })
    throw err
  }
  return r
}

/**
 * Como `gravarArquivo`, mas para em `<tempId>.parcial` (com `fsync`): quem chama decide depois,
 * sob a trava da demanda, se promove com `promoverParcial` ou apaga com `apagarArquivo(tempId)`.
 * Se o processo cair no meio, o worker apaga o `.parcial` velho.
 */
export async function gravarParcial(
  demandaId: string,
  tempId: string,
  corpo: ReadableStream<Uint8Array>,
  limite: number,
): Promise<{ ok: true; tamanho: number } | { ok: false; motivo: 'grande' }> {
  const parcial = caminhoParcial(demandaId, tempId)
  await mkdir(resolve(parcial, '..'), { recursive: true })

  let arquivo: FileHandle | null = await open(parcial, 'wx', 0o600)
  let tamanho = 0
  try {
    for await (const pedaco of Readable.fromWeb(corpo as ReadableStreamDoNode<Uint8Array>)) {
      const bytes = pedaco as Uint8Array
      tamanho += bytes.byteLength
      if (tamanho > limite) {
        // Sair do laço destrói o Readable e cancela o corpo.
        await arquivo.close()
        arquivo = null
        await rm(parcial, { force: true })
        return { ok: false, motivo: 'grande' }
      }
      await arquivo.write(bytes)
    }
    await arquivo.sync()
    await arquivo.close()
    arquivo = null
    return { ok: true, tamanho }
  } catch (err) {
    await arquivo?.close().catch(() => undefined)
    await rm(parcial, { force: true })
    throw err
  }
}

/** `rename` atômico do `.parcial` (mesmo volume) para o nome final do arquivo. */
export async function promoverParcial(
  demandaId: string,
  tempId: string,
  arquivoId: string,
): Promise<void> {
  await rename(caminhoParcial(demandaId, tempId), caminhoDoArquivo(demandaId, arquivoId))
}

export async function lerArquivo(
  demandaId: string,
  arquivoId: string,
): Promise<ReadableStream<Uint8Array> | null> {
  let arquivo: FileHandle
  try {
    arquivo = await open(caminhoDoArquivo(demandaId, arquivoId), 'r')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  return Readable.toWeb(arquivo.createReadStream()) as unknown as ReadableStream<Uint8Array>
}

/** Ausente não é erro. */
export async function apagarArquivo(demandaId: string, arquivoId: string): Promise<void> {
  const caminho = caminhoDoArquivo(demandaId, arquivoId)
  await rm(caminho, { force: true })
  await rm(caminho + SUFIXO_PARCIAL, { force: true })
}

// RFC 5987: encodeURIComponent deixa ' ( ) * sem escapar, e eles não são attr-char.
function nomeCodificado(nome: string): string {
  return encodeURIComponent(nome).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export function cabecalhosDoArquivo(conteudo: string, nome: string): Record<string, string> {
  const tipo = (conteudo.split(';')[0] ?? '').trim().toLowerCase()
  const base = {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  }
  const filename = `filename*=UTF-8''${nomeCodificado(nome)}`
  if (tipo === 'text/html') {
    return {
      ...base,
      'Content-Disposition': `inline; ${filename}`,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CSP_DO_DESENHO,
    }
  }
  if (INLINE_SEGURO.has(tipo)) {
    return { ...base, 'Content-Disposition': `inline; ${filename}`, 'Content-Type': tipo }
  }
  // svg, xhtml, js e qualquer outro tipo podem executar: só como download, e ainda sob sandbox.
  return {
    ...base,
    'Content-Disposition': `attachment; ${filename}`,
    'Content-Type': 'application/octet-stream',
    'Content-Security-Policy': CSP_DO_DESENHO,
  }
}
