import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

const SCRIPT = path.resolve(__dirname, '../../../scripts/flow-publicar')
const TOKEN = 'fp_tokenDeTesteQueNuncaPodeAparecerNaSaida'

interface Recebido {
  metodo: string
  url: string
  authorization: string | undefined
  contentType: string | undefined
  corpo: string
}

type Resposta = { status: number; corpo: unknown }
let respostas: Record<string, Resposta[]> = {}
let recebidos: Recebido[] = []
let servidor: Server
let flowUrl = ''
let pasta = ''
let trabalho = ''
let headDeMain = ''

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Teste',
      GIT_AUTHOR_EMAIL: 'teste@exemplo.invalid',
      GIT_COMMITTER_NAME: 'Teste',
      GIT_COMMITTER_EMAIL: 'teste@exemplo.invalid',
    },
  }).trim()
}

function responder(req: IncomingMessage, res: ServerResponse) {
  let corpo = ''
  req.on('data', (parte: Buffer) => (corpo += parte.toString('utf8')))
  req.on('end', () => {
    recebidos.push({
      metodo: req.method ?? '',
      url: req.url ?? '',
      authorization: req.headers.authorization,
      contentType: req.headers['content-type'],
      corpo,
    })
    const chave = `${req.method} ${req.url}`
    const fila = respostas[chave] ?? []
    const r = fila.length > 1 ? fila.shift()! : (fila[0] ?? { status: 500, corpo: { erro: 'x' } })
    res.writeHead(r.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(r.corpo))
  })
}

function rodar(
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{ codigo: number; saida: string }> {
  return new Promise((resolve) => {
    execFile(
      SCRIPT,
      args,
      {
        cwd: trabalho,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          NODE_ENV: 'test',
          ...env,
        } as NodeJS.ProcessEnv,
        encoding: 'utf8',
      },
      (erro, stdout: string, stderr: string) => {
        const codigo = erro ? (typeof erro.code === 'number' ? erro.code : 99) : 0
        resolve({ codigo, saida: `${stdout}${stderr}` })
      },
    )
  })
}

const envCompleto = () => ({
  FLOW_URL: flowUrl,
  FLOW_PUBLICACAO_TOKEN: TOKEN,
  FLOW_PUBLICAR_INTERVALO: '0',
})

beforeAll(async () => {
  servidor = createServer(responder)
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r))
  flowUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`

  pasta = mkdtempSync(path.join(tmpdir(), 'flow-publicar-'))
  const remoto = path.join(pasta, 'remoto', 'kustertech-exemplo', 'portal.git')
  execFileSync('git', ['init', '--bare', '-b', 'main', remoto])
  trabalho = path.join(pasta, 'trabalho')
  execFileSync('git', ['init', '-b', 'main', trabalho])
  git(trabalho, 'commit', '--allow-empty', '-m', 'primeiro')
  git(trabalho, 'remote', 'add', 'origin', `file://${remoto}`)
  git(trabalho, 'push', '-q', 'origin', 'main')
  // Um commit local que não está em origin/main: o script pede o de origin/main.
  headDeMain = git(trabalho, 'rev-parse', 'HEAD')
  git(trabalho, 'commit', '--allow-empty', '-m', 'local')
})

afterAll(async () => {
  await new Promise<void>((r) => servidor.close(() => r()))
  rmSync(pasta, { recursive: true, force: true })
})

beforeEach(() => {
  respostas = {}
  recebidos = []
})

describe('scripts/flow-publicar', () => {
  test('sem FLOW_PUBLICACAO_TOKEN sai 2 com "defina FLOW_URL e FLOW_PUBLICACAO_TOKEN"', async () => {
    const r = await rodar([], { FLOW_URL: flowUrl })
    expect(r.codigo).toBe(2)
    expect(r.saida).toContain('defina FLOW_URL e FLOW_PUBLICACAO_TOKEN')
    expect(recebidos).toHaveLength(0)
  })

  test('sem FLOW_URL também sai 2', async () => {
    const r = await rodar([], { FLOW_PUBLICACAO_TOKEN: TOKEN })
    expect(r.codigo).toBe(2)
    expect(r.saida).toContain('defina FLOW_URL e FLOW_PUBLICACAO_TOKEN')
  })

  test('opção desconhecida sai 2 sem pedir nada', async () => {
    const r = await rodar(['--agora'], envCompleto())
    expect(r.codigo).toBe(2)
    expect(recebidos).toHaveLength(0)
  })

  test('pedido 201 imprime "na_fila" e sai 0; 409 imprime o motivo e sai 1; o token não aparece na saída', async () => {
    respostas['POST /api/publicacoes'] = [
      { status: 201, corpo: { id: 'p1', estado: 'na_fila', posicao: 1 } },
      {
        status: 409,
        corpo: { id: 'p2', estado: 'recusado', motivo: 'publicação não configurada' },
      },
    ]
    const aceito = await rodar(['--descricao', 'Corrige "PDF" cortado'], envCompleto())
    expect(aceito.codigo).toBe(0)
    expect(aceito.saida).toContain('na_fila')
    expect(aceito.saida).not.toContain(TOKEN)

    const recusado = await rodar([], envCompleto())
    expect(recusado.codigo).toBe(1)
    expect(recusado.saida).toContain('recusado')
    expect(recusado.saida).toContain('publicação não configurada')
    expect(recusado.saida).not.toContain(TOKEN)

    const [primeiro] = recebidos
    expect(primeiro).toMatchObject({
      metodo: 'POST',
      url: '/api/publicacoes',
      authorization: `Bearer ${TOKEN}`,
      contentType: 'application/json',
    })
    expect(JSON.parse(primeiro!.corpo)).toEqual({
      repositorio: 'kustertech-exemplo/portal',
      commit: headDeMain,
      modo: 'imediato',
      descricao: 'Corrige "PDF" cortado',
    })
  })

  test('200 dispensado sai 0 com o motivo', async () => {
    respostas['POST /api/publicacoes'] = [
      { status: 200, corpo: { id: 'p3', estado: 'dispensado', motivo: 'já está no ar' } },
    ]
    const r = await rodar(['--lote'], envCompleto())
    expect(r.codigo).toBe(0)
    expect(r.saida).toContain('dispensado')
    expect(r.saida).toContain('já está no ar')
    expect(JSON.parse(recebidos[0]!.corpo)).toMatchObject({ modo: 'lote' })
  })

  test.each([401, 404, 413, 415, 422])('HTTP %i sai 2 com o erro do Flow', async (status) => {
    respostas['POST /api/publicacoes'] = [{ status, corpo: { erro: 'Erro do Flow.' } }]
    const r = await rodar([], envCompleto())
    expect(r.codigo).toBe(2)
    expect(r.saida).toContain('Erro do Flow.')
    expect(r.saida).not.toContain(TOKEN)
  })

  test('--esperar consulta o pedido até um estado final: publicado sai 0, falhou sai 1', async () => {
    respostas['POST /api/publicacoes'] = [
      { status: 201, corpo: { id: 'p4', estado: 'na_fila', posicao: 2 } },
    ]
    respostas['GET /api/publicacoes/p4'] = [
      { status: 200, corpo: { id: 'p4', estado: 'verificando', motivo: null } },
      { status: 200, corpo: { id: 'p4', estado: 'publicando', motivo: null } },
      { status: 200, corpo: { id: 'p4', estado: 'publicado', motivo: null } },
    ]
    const publicado = await rodar(['--esperar'], envCompleto())
    expect(publicado.codigo).toBe(0)
    expect(publicado.saida).toContain('publicado')
    const consultas = recebidos.filter((r) => r.metodo === 'GET')
    expect(consultas).toHaveLength(3)
    expect(consultas[0]!.authorization).toBe(`Bearer ${TOKEN}`)

    recebidos = []
    respostas['POST /api/publicacoes'] = [
      { status: 201, corpo: { id: 'p5', estado: 'na_fila', posicao: 1 } },
    ]
    respostas['GET /api/publicacoes/p5'] = [
      { status: 200, corpo: { id: 'p5', estado: 'falhou', motivo: 'a execução sumiu' } },
    ]
    const falhou = await rodar(['--esperar'], envCompleto())
    expect(falhou.codigo).toBe(1)
    expect(falhou.saida).toContain('falhou')
    expect(falhou.saida).toContain('a execução sumiu')
    expect(falhou.saida).not.toContain(TOKEN)
  })
})
