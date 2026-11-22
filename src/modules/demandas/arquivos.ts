import { constants } from 'node:fs'
import { access, mkdir, open, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as ReadableStreamDoNode } from 'node:stream/web'
import { log } from '@/lib/log'
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

export const ARMAZENAMENTO_NAO_CONFIGURADO = 'Armazenamento de arquivos não configurado.'

/** Em produção, sem o volume dos arquivos configurado: as rotas respondem 503. */
export class ArmazenamentoNaoConfigurado extends Error {
  constructor() {
    super(ARMAZENAMENTO_NAO_CONFIGURADO)
    this.name = 'ArmazenamentoNaoConfigurado'
  }
}

const emProducao = () => process.env.NODE_ENV === 'production'

/**
 * Em produção o diretório é sempre o `FLOW_ARQUIVOS_DIR` explícito (o volume do compose): sem ele,
 * o padrão gravaria na camada do contêiner e os arquivos sumiriam na próxima troca de imagem.
 */
export function diretorioDosArquivos(): string {
  const dir = process.env.FLOW_ARQUIVOS_DIR
  if (dir) return dir
  if (emProducao()) {
    log.error('FLOW_ARQUIVOS_DIR ausente em produção: os arquivos das demandas não são gravados.')
    throw new ArmazenamentoNaoConfigurado()
  }
  return DIRETORIO_PADRAO
}

/** Em produção, o diretório precisa existir e aceitar escrita; nunca é criado aqui. */
export async function exigirArmazenamento(): Promise<string> {
  const dir = diretorioDosArquivos()
  if (!emProducao()) return dir
  try {
    if (!(await stat(dir)).isDirectory()) throw new Error('não é um diretório')
    await access(dir, constants.W_OK)
  } catch (erro) {
    log.error(
      { dir, erro: (erro as Error).message },
      'FLOW_ARQUIVOS_DIR não existe ou não aceita escrita: os arquivos das demandas não são gravados.',
    )
    throw new ArmazenamentoNaoConfigurado()
  }
  return dir
}

/** Subpasta do volume: as demandas e as conversas do Decidir (`<dir>/<pasta>/<dono>/<arquivo>`). */
export type Pasta = 'demandas' | 'conversas'

/** `<dir>/<pasta>/<demandaId>/<arquivoId>`; só ids uuid entram no caminho (nunca o nome enviado). */
export function caminhoDoArquivo(
  demandaId: string,
  arquivoId: string,
  pasta: Pasta = 'demandas',
): string {
  if (!UUID.test(demandaId) || !UUID.test(arquivoId)) {
    throw new Error('Identificador de arquivo inválido.')
  }
  if (pasta !== 'demandas' && pasta !== 'conversas') throw new Error('Pasta de arquivos inválida.')
  const raiz = resolve(/* turbopackIgnore: true */ diretorioDosArquivos())
  const caminho = resolve(raiz, pasta, demandaId, arquivoId)
  if (!caminho.startsWith(raiz + sep)) throw new Error('Caminho fora do diretório de arquivos.')
  return caminho
}

export function caminhoParcial(
  demandaId: string,
  arquivoId: string,
  pasta: Pasta = 'demandas',
): string {
  return caminhoDoArquivo(demandaId, arquivoId, pasta) + SUFIXO_PARCIAL
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
  pasta: Pasta = 'demandas',
): Promise<{ ok: true; tamanho: number } | { ok: false; motivo: 'grande' }> {
  const r = await gravarParcial(demandaId, arquivoId, corpo, limite, pasta)
  if (!r.ok) return r
  try {
    await promoverParcial(demandaId, arquivoId, arquivoId, pasta)
  } catch (err) {
    await rm(caminhoParcial(demandaId, arquivoId, pasta), { force: true })
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
  pasta: Pasta = 'demandas',
): Promise<{ ok: true; tamanho: number } | { ok: false; motivo: 'grande' }> {
  const parcial = caminhoParcial(demandaId, tempId, pasta)
  await exigirArmazenamento()
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
  pasta: Pasta = 'demandas',
): Promise<void> {
  await rename(
    caminhoParcial(demandaId, tempId, pasta),
    caminhoDoArquivo(demandaId, arquivoId, pasta),
  )
}

export async function lerArquivo(
  demandaId: string,
  arquivoId: string,
  pasta: Pasta = 'demandas',
): Promise<ReadableStream<Uint8Array> | null> {
  let arquivo: FileHandle
  try {
    arquivo = await open(caminhoDoArquivo(demandaId, arquivoId, pasta), 'r')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  return Readable.toWeb(arquivo.createReadStream()) as unknown as ReadableStream<Uint8Array>
}

/** Ausente não é erro. */
export async function apagarArquivo(
  demandaId: string,
  arquivoId: string,
  pasta: Pasta = 'demandas',
): Promise<void> {
  const caminho = caminhoDoArquivo(demandaId, arquivoId, pasta)
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
