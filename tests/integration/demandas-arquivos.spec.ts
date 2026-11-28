import { randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { log } from '@/lib/log'
import {
  ArmazenamentoNaoConfigurado,
  apagarArquivo,
  cabecalhosDoArquivo,
  cabecalhosDoSvg,
  caminhoDoArquivo,
  diretorioDosArquivos,
  gravarArquivo,
  gravarParcial,
  lerArquivo,
  promoverParcial,
} from '@/modules/demandas/arquivos'
import { CONTEUDOS_ACEITOS, LIMITE_POR_ARQUIVO } from '@/modules/demandas/transicoes'

let dir: string
const anterior = process.env.FLOW_ARQUIVOS_DIR

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-arquivos-'))
  process.env.FLOW_ARQUIVOS_DIR = dir
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  if (anterior === undefined) delete process.env.FLOW_ARQUIVOS_DIR
  else process.env.FLOW_ARQUIVOS_DIR = anterior
  await rm(dir, { recursive: true, force: true })
})

function corpoEmPedacos(total: number, pedaco = 64 * 1024): ReadableStream<Uint8Array> {
  let enviado = 0
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (enviado >= total) return c.close()
      const n = Math.min(pedaco, total - enviado)
      c.enqueue(new Uint8Array(n).fill(enviado % 251))
      enviado += n
    },
  })
}

function corpoDe(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes)
      c.close()
    },
  })
}

async function lerTudo(s: ReadableStream<Uint8Array>): Promise<Buffer> {
  const partes: Uint8Array[] = []
  for await (const p of s as unknown as AsyncIterable<Uint8Array>) partes.push(p)
  return Buffer.concat(partes)
}

describe('arquivos de demandas no volume', () => {
  test('diretorioDosArquivos usa FLOW_ARQUIVOS_DIR e cai em /var/lib/flow/arquivos sem ela', () => {
    expect(diretorioDosArquivos()).toBe(dir)
    delete process.env.FLOW_ARQUIVOS_DIR
    expect(diretorioDosArquivos()).toBe('/var/lib/flow/arquivos')
  })

  test('gravarArquivo grava, devolve o tamanho e lerArquivo devolve os mesmos bytes', async () => {
    const demandaId = randomUUID()
    const arquivoId = randomUUID()
    const bytes = new TextEncoder().encode('<p>olá, desenho</p>')

    const r = await gravarArquivo(demandaId, arquivoId, corpoDe(bytes), LIMITE_POR_ARQUIVO)

    expect(r).toEqual({ ok: true, tamanho: bytes.byteLength })
    expect(caminhoDoArquivo(demandaId, arquivoId)).toBe(join(dir, 'demandas', demandaId, arquivoId))
    expect(await readdir(join(dir, 'demandas', demandaId))).toEqual([arquivoId])
    const lido = await lerArquivo(demandaId, arquivoId)
    expect(lido).not.toBeNull()
    expect(Buffer.compare(await lerTudo(lido!), Buffer.from(bytes))).toBe(0)
  })

  test('arquivo com exatamente o limite é aceito', async () => {
    const r = await gravarArquivo(randomUUID(), randomUUID(), corpoEmPedacos(1000), 1000)
    expect(r).toEqual({ ok: true, tamanho: 1000 })
  })

  test('Review Focus 4: corpo de 10 MB + 1 com limite de 10 MB → { ok: false, motivo: "grande" } e nenhum arquivo nem .parcial no diretório', async () => {
    const demandaId = randomUUID()
    const r = await gravarArquivo(
      demandaId,
      randomUUID(),
      corpoEmPedacos(LIMITE_POR_ARQUIVO + 1),
      LIMITE_POR_ARQUIVO,
    )
    expect(r).toEqual({ ok: false, motivo: 'grande' })
    expect(await readdir(join(dir, 'demandas', demandaId))).toEqual([])
  })

  test('lerArquivo de arquivo ausente devolve null; apagarArquivo de ausente não é erro', async () => {
    const demandaId = randomUUID()
    const arquivoId = randomUUID()
    expect(await lerArquivo(demandaId, arquivoId)).toBeNull()
    await expect(apagarArquivo(demandaId, arquivoId)).resolves.toBeUndefined()
    await gravarArquivo(demandaId, arquivoId, corpoEmPedacos(10), 100)
    await apagarArquivo(demandaId, arquivoId)
    expect(await lerArquivo(demandaId, arquivoId)).toBeNull()
  })

  test('regressão: gravar e ler arquivo de demanda sem informar a pasta continua em <dir>/demandas/', async () => {
    const demandaId = randomUUID()
    const arquivoId = randomUUID()
    const bytes = new TextEncoder().encode('anexo')
    await gravarArquivo(demandaId, arquivoId, corpoDe(bytes), 100)
    expect(await readdir(dir)).toEqual(['demandas'])
    expect(await readdir(join(dir, 'demandas', demandaId))).toEqual([arquivoId])
    expect(Buffer.from(await lerTudo((await lerArquivo(demandaId, arquivoId))!)).toString()).toBe(
      'anexo',
    )
  })

  test('com a pasta "conversas" o arquivo vai para <dir>/conversas/ e só é lido, apagado e promovido lá', async () => {
    const conversaId = randomUUID()
    const anexoId = randomUUID()
    const bytes = new TextEncoder().encode('imagem')
    const r = await gravarParcial(conversaId, anexoId, corpoDe(bytes), 100, 'conversas')
    expect(r).toEqual({ ok: true, tamanho: bytes.byteLength })
    expect(await readdir(join(dir, 'conversas', conversaId))).toEqual([`${anexoId}.parcial`])
    await promoverParcial(conversaId, anexoId, anexoId, 'conversas')
    expect(caminhoDoArquivo(conversaId, anexoId, 'conversas')).toBe(
      join(dir, 'conversas', conversaId, anexoId),
    )
    expect(await lerArquivo(conversaId, anexoId)).toBeNull()
    expect(await lerArquivo(conversaId, anexoId, 'conversas')).not.toBeNull()
    await apagarArquivo(conversaId, anexoId)
    expect(await readdir(join(dir, 'conversas', conversaId))).toEqual([anexoId])
    await apagarArquivo(conversaId, anexoId, 'conversas')
    expect(await readdir(join(dir, 'conversas', conversaId))).toEqual([])
    expect(() => caminhoDoArquivo(conversaId, anexoId, '..' as 'conversas')).toThrow()
  })

  test('caminhoDoArquivo recusa id que não é uuid ("../x", "a/b")', () => {
    const ok = randomUUID()
    for (const ruim of ['../x', 'a/b', '..', '', `${ok}/../x`, `${ok}\0`]) {
      expect(() => caminhoDoArquivo(ruim, ok)).toThrow()
      expect(() => caminhoDoArquivo(ok, ruim)).toThrow()
    }
  })

  test('gravarArquivo com id que não é uuid não toca o disco', async () => {
    await expect(gravarArquivo('../x', randomUUID(), corpoEmPedacos(1), 10)).rejects.toThrow()
    expect(await readdir(dir)).toEqual([])
  })

  test('cabecalhosDoSvg: imagem inline sob o mesmo sandbox do desenho; pelo caminho comum o svg continua só download', () => {
    const svg = cabecalhosDoSvg('fluxo.svg')
    expect(svg['Content-Type']).toBe('image/svg+xml')
    expect(svg['Content-Security-Policy']).toMatch(/^sandbox; default-src 'none'/)
    expect(svg['X-Content-Type-Options']).toBe('nosniff')
    expect(svg['Content-Disposition']).toBe("inline; filename*=UTF-8''fluxo.svg")

    const comum = cabecalhosDoArquivo('image/svg+xml', 'fluxo.svg')
    expect(comum['Content-Type']).toBe('application/octet-stream')
    expect(comum['Content-Disposition']).toMatch(/^attachment/)
  })

  test('Review Focus 3: cabecalhosDoArquivo("text/html", "d.html") traz Content-Security-Policy começando por "sandbox" e nosniff; image/png não traz CSP', () => {
    const html = cabecalhosDoArquivo('text/html', 'd.html')
    expect(html['Content-Security-Policy']).toBe(
      "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:",
    )
    expect(html['Content-Type']).toBe('text/html; charset=utf-8')
    expect(html['X-Content-Type-Options']).toBe('nosniff')
    expect(html['Cache-Control']).toBe('private, no-store')
    expect(html['Content-Disposition']).toBe("inline; filename*=UTF-8''d.html")

    const png = cabecalhosDoArquivo('image/png', 'tela 1.png')
    expect(png['Content-Security-Policy']).toBeUndefined()
    expect(png['Content-Type']).toBe('image/png')
    expect(png['X-Content-Type-Options']).toBe('nosniff')
    expect(png['Cache-Control']).toBe('private, no-store')
    expect(png['Content-Disposition']).toBe("inline; filename*=UTF-8''tela%201.png")
  })

  test('HTML com parâmetros ("text/html; charset=x", "TEXT/HTML") também ganha a CSP sandbox', () => {
    for (const c of ['text/html; charset=iso-8859-1', 'TEXT/HTML']) {
      expect(cabecalhosDoArquivo(c, 'd.html')['Content-Security-Policy']).toMatch(/^sandbox;/)
    }
  })

  test('conteúdo ativo que não é HTML (svg, xhtml, js) vira download octet-stream sob a CSP sandbox', () => {
    for (const c of ['image/svg+xml', 'application/xhtml+xml', 'text/javascript', 'x/qualquer']) {
      const h = cabecalhosDoArquivo(c, 'a.svg')
      expect(h['Content-Type']).toBe('application/octet-stream')
      expect(h['Content-Disposition']).toBe("attachment; filename*=UTF-8''a.svg")
      expect(h['Content-Security-Policy']).toMatch(/^sandbox;/)
    }
  })

  test('todo tipo aceito que não é HTML (imagens, áudios e vídeos) sai inline com o próprio tipo e sem CSP', () => {
    const aceitos = new Set(Object.values(CONTEUDOS_ACEITOS).flat())
    aceitos.delete('text/html')
    expect([...aceitos].sort()).toEqual(
      [
        'audio/mp4',
        'audio/mpeg',
        'audio/ogg',
        'audio/webm',
        'image/jpeg',
        'image/png',
        'image/webp',
        'video/mp4',
        'video/quicktime',
        'video/webm',
      ].sort(),
    )
    for (const c of aceitos) {
      const h = cabecalhosDoArquivo(c, 'a.bin')
      expect(h['Content-Type']).toBe(c)
      expect(h['Content-Disposition']).toBe("inline; filename*=UTF-8''a.bin")
      expect(h['Content-Security-Policy']).toBeUndefined()
      expect(h['X-Content-Type-Options']).toBe('nosniff')
    }
  })

  test('tipo não aceito (pdf, text/plain, gif) também vira download sob a CSP sandbox', () => {
    for (const c of ['application/pdf', 'text/plain', 'image/gif']) {
      const h = cabecalhosDoArquivo(c, 'a.bin')
      expect(h['Content-Type']).toBe('application/octet-stream')
      expect(h['Content-Disposition']).toMatch(/^attachment;/)
      expect(h['Content-Security-Policy']).toMatch(/^sandbox;/)
    }
  })
})

describe('armazenamento em produção (I2)', () => {
  const gravar = () =>
    gravarArquivo(
      randomUUID(),
      randomUUID(),
      corpoDe(new Uint8Array([1, 2, 3])),
      LIMITE_POR_ARQUIVO,
    )

  test('sem FLOW_ARQUIVOS_DIR a gravação falha alto, com log de erro, e não cai no padrão do contêiner', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.FLOW_ARQUIVOS_DIR
    const erro = vi.spyOn(log, 'error').mockImplementation(() => undefined as never)
    await expect(gravar()).rejects.toBeInstanceOf(ArmazenamentoNaoConfigurado)
    await expect(gravar()).rejects.toThrow('Armazenamento de arquivos não configurado.')
    expect(erro).toHaveBeenCalled()
    expect(() => diretorioDosArquivos()).toThrow(ArmazenamentoNaoConfigurado)
  })

  test('com FLOW_ARQUIVOS_DIR que não existe a gravação falha e nada é criado', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const faltando = join(dir, 'volume-que-nao-existe')
    process.env.FLOW_ARQUIVOS_DIR = faltando
    vi.spyOn(log, 'error').mockImplementation(() => undefined as never)
    await expect(gravar()).rejects.toBeInstanceOf(ArmazenamentoNaoConfigurado)
    expect(await readdir(dir)).toEqual([])
  })

  test('com FLOW_ARQUIVOS_DIR sem permissão de escrita a gravação falha', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const travado = join(dir, 'so-leitura')
    await mkdir(travado)
    await chmod(travado, 0o500)
    process.env.FLOW_ARQUIVOS_DIR = travado
    vi.spyOn(log, 'error').mockImplementation(() => undefined as never)
    try {
      await expect(gravar()).rejects.toBeInstanceOf(ArmazenamentoNaoConfigurado)
    } finally {
      await chmod(travado, 0o700)
    }
  })

  test('com FLOW_ARQUIVOS_DIR existente e gravável a gravação segue', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(await gravar()).toEqual({ ok: true, tamanho: 3 })
  })
})
