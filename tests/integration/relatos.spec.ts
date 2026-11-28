import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { decifrarSegredo, MENSAGEM_SEM_CHAVE } from '@/lib/segredos'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { enfileirarAutomaticos, enviarPendentes } from '@/modules/relatos/andamento'
import { buscarSistema, buscarTodos, recuperarAnexosFaltantes } from '@/modules/relatos/busca'
import type {
  baixarAnexo,
  buscarPagina,
  enviarAndamento,
  PaginaBuscada,
} from '@/modules/relatos/cliente'
import { lerPagina } from '@/modules/relatos/contrato'
import { idDoAnexo } from '@/modules/relatos/model'
import { ID_A, ID_B, relatoDeExemplo } from '@/modules/relatos/exemplos'
import {
  criarSistema,
  editarSistema,
  revogarSistema,
  testarConexao,
} from '@/modules/relatos/sistemas'
import { obterSistemasConectados } from '@/modules/relatos/queries'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const chave = randomBytes(32)
const agora = new Date('2026-11-26T15:00:00.000Z')
const MIN = 60_000
const TOKEN = 'token-de-teste-1234567890'
const ID_C = '019a0000-0000-7000-8000-00000000000c'

let admin: Sujeito
let projetoId: string
let repositorioId: string
let chaveAntes: string | undefined

beforeAll(() => {
  chaveAntes = process.env.FLOW_CHAVE_DOS_SEGREDOS
  process.env.FLOW_CHAVE_DOS_SEGREDOS = chave.toString('base64')
})
afterAll(() => {
  if (chaveAntes === undefined) delete process.env.FLOW_CHAVE_DOS_SEGREDOS
  else process.env.FLOW_CHAVE_DOS_SEGREDOS = chaveAntes
})

beforeEach(async () => {
  await limparBanco()
  await sincronizarCatalogo(criarFonteFixtures(), agora)
  const repo = await db.repositorioGitHub.findFirstOrThrow({ orderBy: { nomeCompleto: 'asc' } })
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto alfa' },
  })
  await db.repositorioGitHub.update({
    where: { id: repo.id },
    data: { projetoId: projeto.id, vinculadoEm: agora },
  })
  projetoId = projeto.id
  repositorioId = repo.id
  const u = await criarUsuario({
    email: 'admin-relatos@local.test',
    nome: 'Admin',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: u.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
})

const testador = (): Sujeito => ({
  usuarioId: admin.usuarioId,
  papeis: [{ papel: 'TESTADOR', clienteId: null }],
})

const dados = (p: Partial<Parameters<typeof criarSistema>[1]> = {}) => ({
  nome: 'Sistema Alfa',
  url: 'https://alfa.exemplo.com/v1/',
  projetoId,
  repositorioId: null,
  token: TOKEN,
  ...p,
})

/** Um sistema que responde páginas prontas, uma por chamada, guardando os `desde` pedidos. */
function sistemaFalso(paginas: (PaginaBuscada | Record<string, unknown>)[]) {
  const pedidos: (string | null)[] = []
  const buscar: typeof buscarPagina = async (alvo, desde) => {
    expect(alvo.token).toBe(TOKEN)
    pedidos.push(desde)
    const p = paginas.shift() ?? { relatos: [], cursor: desde ?? '0' }
    if ('ok' in p) return p as PaginaBuscada
    const lida = lerPagina(p, 50)
    return lida.ok ? lida : { ok: false, falha: { tipo: 'contrato', motivo: lida.motivo } }
  }
  return { buscar, pedidos }
}

describe('sistemas conectados', () => {
  test('criarSistema grava o token cifrado com o AAD do id e a URL sem barra no fim', async () => {
    const { id } = await criarSistema(admin, dados())
    const s = await db.sistemaConectado.findUniqueOrThrow({ where: { id } })
    expect(s.url).toBe('https://alfa.exemplo.com/v1')
    expect(s.repositorioId).toBe(repositorioId)
    expect(s.tokenCifrado).not.toContain(TOKEN)
    expect(decifrarSegredo(s.tokenCifrado!, `sistema:${id}`, chave)).toBe(TOKEN)
  })

  test('recusas: http, token curto, sem chave e perfil sem permissão', async () => {
    await expect(criarSistema(admin, dados({ url: 'http://alfa.exemplo.com' }))).rejects.toThrow(
      'Use um endereço https.',
    )
    await expect(criarSistema(admin, dados({ token: 'curto' }))).rejects.toThrow(
      'O token precisa ter',
    )
    await expect(criarSistema(testador(), dados())).rejects.toThrow(ErroDeAutorizacao)
    process.env.FLOW_CHAVE_DOS_SEGREDOS = ''
    try {
      await expect(criarSistema(admin, dados())).rejects.toThrow(MENSAGEM_SEM_CHAVE)
    } finally {
      process.env.FLOW_CHAVE_DOS_SEGREDOS = chave.toString('base64')
    }
    expect(await db.sistemaConectado.count()).toBe(0)
  })

  test('editar com token vazio mantém; com token novo volta a ATIVO; trocar url limpa o cursor', async () => {
    const { id } = await criarSistema(admin, dados())
    await db.sistemaConectado.update({
      where: { id },
      data: { estado: 'DESCONECTADO', cursor: '9', ultimoErro: 'O sistema recusou o token.' },
    })
    const antes = (await db.sistemaConectado.findUniqueOrThrow({ where: { id } })).tokenCifrado
    await editarSistema(admin, id, dados({ token: '' }))
    let s = await db.sistemaConectado.findUniqueOrThrow({ where: { id } })
    expect(s.tokenCifrado).toBe(antes)
    expect(s.estado).toBe('DESCONECTADO')
    expect(s.cursor).toBe('9')
    await editarSistema(
      admin,
      id,
      dados({ url: 'https://beta.exemplo.com/v1', token: 'outro-token-1234567890' }),
    )
    s = await db.sistemaConectado.findUniqueOrThrow({ where: { id } })
    expect(s).toMatchObject({ estado: 'ATIVO', ultimoErro: null, cursor: null })
  })

  test('revogar apaga o token e descarta os envios pendentes; editar depois recusa', async () => {
    const { id } = await criarSistema(admin, dados())
    const { buscar } = sistemaFalso([{ relatos: [relatoDeExemplo()], cursor: '2' }])
    await buscarSistema(id, agora, { buscar, chave })
    await enfileirarAutomaticos(agora)
    await revogarSistema(admin, id, agora)
    const s = await db.sistemaConectado.findUniqueOrThrow({ where: { id } })
    expect(s).toMatchObject({ estado: 'REVOGADO', tokenCifrado: null })
    expect(await db.envioDeAndamento.findFirstOrThrow()).toMatchObject({
      situacao: 'DESCARTADO',
      ultimoErro: 'Sistema revogado.',
    })
    await expect(editarSistema(admin, id, dados())).rejects.toThrow('Este sistema foi revogado.')
  })

  test('testarConexao não grava relato nem anda o cursor', async () => {
    const { id } = await criarSistema(admin, dados())
    const { buscar } = sistemaFalso([
      { relatos: [relatoDeExemplo({ id: ID_A }), relatoDeExemplo({ id: ID_B })], cursor: '3' },
      { ok: false, falha: { tipo: 'token_recusado' } },
    ])
    expect(await testarConexao(admin, id, { buscar })).toEqual({
      ok: true,
      mensagem: 'Conexão ok: 2 relato(s) esperando.',
    })
    expect(await testarConexao(admin, id, { buscar })).toEqual({
      ok: false,
      mensagem: 'O sistema recusou o token.',
    })
    expect(await db.relato.count()).toBe(0)
    expect((await db.sistemaConectado.findUniqueOrThrow({ where: { id } })).cursor).toBeNull()
  })
})

describe('buscar-relatos', () => {
  test('primeira busca sem desde: segue vira demanda de usuário sem o nome do autor; orientado só é gravado', async () => {
    const { id } = await criarSistema(admin, dados())
    const { buscar, pedidos } = sistemaFalso([
      {
        relatos: [
          relatoDeExemplo({ id: ID_A, cursor: '1' }),
          relatoDeExemplo({
            id: ID_B,
            resultado: 'orientado',
            tipo: null,
            texto: 'Como exportar o relatório',
            contexto: { tela: 'Relatórios', versao: null },
            cursor: '2',
          }),
        ],
        cursor: '2',
      },
    ])
    const r = await buscarSistema(id, agora, { buscar, chave })
    expect(r).toMatchObject({ buscou: true, novos: 1, orientados: 1, falha: null })
    expect(pedidos).toEqual([null])
    const demanda = await db.demanda.findFirstOrThrow()
    expect(demanda).toMatchObject({ origem: 'USUARIO', titulo: 'A tela de pedidos não abre' })
    expect(`${demanda.titulo}${demanda.descricao}`).not.toMatch(/Ana|Lima|Assessora/)
    expect(demanda.descricao).toContain('ticket R-0001')
    const orientado = await db.relato.findFirstOrThrow({ where: { idExterno: ID_B } })
    expect(orientado).toMatchObject({
      resultado: 'ORIENTADO',
      demandaId: null,
      texto: null,
      assunto: 'Relatórios',
    })
    const s = await db.sistemaConectado.findUniqueOrThrow({ where: { id } })
    expect(s).toMatchObject({ cursor: '2', ultimaBuscaOkEm: agora, ultimoErro: null })
  })

  test('sinal novo faz o relato voltar: sinais atualizados, nenhuma demanda nova, desde = cursor anterior', async () => {
    const { id } = await criarSistema(admin, dados())
    const sinal = {
      tipo: 'urgencia',
      autor: { id: 'u-2', nome: 'Bruno Reis', papel: 'Gestor' },
      texto: 'Cliente esperando',
      em: '2026-11-26T15:30:00.000Z',
    }
    const { buscar, pedidos } = sistemaFalso([
      { relatos: [relatoDeExemplo({ cursor: '2' })], cursor: '2' },
      { relatos: [relatoDeExemplo({ cursor: '5', sinais: [sinal] })], cursor: '5' },
    ])
    await buscarSistema(id, agora, { buscar, chave })
    const r = await buscarSistema(id, new Date(agora.getTime() + MIN), { buscar, chave })
    expect(r).toMatchObject({ novos: 0, repetidos: 1, sinaisNovos: 1 })
    expect(pedidos).toEqual([null, '2'])
    expect(await db.demanda.count()).toBe(1)
    expect((await db.relato.findFirstOrThrow()).sinais).toEqual([sinal])
  })

  test('orientado que volta como segue abre a demanda nessa hora', async () => {
    const { id } = await criarSistema(admin, dados())
    const { buscar } = sistemaFalso([
      { relatos: [relatoDeExemplo({ resultado: 'orientado', tipo: null })], cursor: '1' },
      { relatos: [relatoDeExemplo({ cursor: '3' })], cursor: '3' },
    ])
    await buscarSistema(id, agora, { buscar, chave })
    expect(await db.demanda.count()).toBe(0)
    await buscarSistema(id, new Date(agora.getTime() + MIN), { buscar, chave })
    const relato = await db.relato.findFirstOrThrow()
    expect(relato.resultado).toBe('SEGUE')
    expect(relato.demandaId).not.toBeNull()
  })

  test('relato torto recusa a página: nada gravado, cursor parado, ultimoErro com o motivo', async () => {
    const { id } = await criarSistema(admin, dados())
    const { buscar } = sistemaFalso([
      { relatos: [relatoDeExemplo(), relatoDeExemplo({ id: ID_B, canal: 'email' })], cursor: '4' },
    ])
    const r = await buscarSistema(id, agora, { buscar, chave })
    expect(r.falha).toBe(`O relato ${ID_B} não segue o contrato: canal.`)
    expect(await db.relato.count()).toBe(0)
    expect(await db.sistemaConectado.findUniqueOrThrow({ where: { id } })).toMatchObject({
      cursor: null,
      ultimaBuscaOkEm: null,
      ultimoErro: `O relato ${ID_B} não segue o contrato: canal.`,
    })
  })

  test('token recusado → DESCONECTADO; a busca seguinte não chama o sistema', async () => {
    const { id } = await criarSistema(admin, dados())
    const { buscar, pedidos } = sistemaFalso([{ ok: false, falha: { tipo: 'token_recusado' } }])
    await buscarSistema(id, agora, { buscar, chave })
    expect(await db.sistemaConectado.findUniqueOrThrow({ where: { id } })).toMatchObject({
      estado: 'DESCONECTADO',
      ultimoErro: 'O sistema recusou o token.',
    })
    await buscarSistema(id, new Date(agora.getTime() + 5 * MIN), { buscar, chave })
    expect(pedidos).toHaveLength(1)
  })

  test('dentro de 60 s não busca de novo; página cheia busca a seguinte', async () => {
    const { id } = await criarSistema(admin, dados())
    const cheia = { ok: true as const, relatos: [], cursor: '50', mais: true }
    const { buscar, pedidos } = sistemaFalso([cheia, { relatos: [], cursor: '50' }])
    await buscarSistema(id, agora, { buscar, chave })
    expect(pedidos).toEqual([null, '50'])
    await buscarSistema(id, new Date(agora.getTime() + 30_000), { buscar, chave })
    expect(pedidos).toHaveLength(2)
  })

  test('buscarTodos: um sistema lança exceção e o outro grava os seus', async () => {
    const a = await criarSistema(admin, dados({ nome: 'Sistema Alfa' }))
    await criarSistema(admin, dados({ nome: 'Sistema Beta', url: 'https://beta.exemplo.com/v1' }))
    const buscar: typeof buscarPagina = async (alvo) => {
      if (alvo.url.includes('alfa')) throw new Error('quebrou')
      return { ok: true, relatos: [lerRelato(ID_C)], cursor: '1', mais: false }
    }
    const r = await buscarTodos(agora, { buscar, chave })
    expect(r).toMatchObject({ sistemas: 2, novos: 1, falhas: 1 })
    expect(
      (await db.sistemaConectado.findUniqueOrThrow({ where: { id: a.id } })).ultimoErro,
    ).toMatch(/Erro inesperado/)
  })
})

function lerRelato(id: string) {
  const p = lerPagina({ relatos: [relatoDeExemplo({ id })], cursor: '1' }, 50)
  if (!p.ok) throw new Error(p.motivo)
  return p.relatos[0]!
}

describe('enviar-andamento', () => {
  async function comUmRelato() {
    const { id } = await criarSistema(admin, dados())
    const { buscar } = sistemaFalso([{ relatos: [relatoDeExemplo()], cursor: '2' }])
    await buscarSistema(id, agora, { buscar, chave })
    return id
  }

  test('demanda criada → um "recebido"; a segunda varredura não duplica', async () => {
    await comUmRelato()
    expect(await enfileirarAutomaticos(agora)).toBe(1)
    expect(await enfileirarAutomaticos(agora)).toBe(0)
    expect(await db.envioDeAndamento.findFirstOrThrow()).toMatchObject({
      estado: 'recebido',
      mensagem: 'Recebemos seu relato. Você terá notícias por aqui.',
      situacao: 'PENDENTE',
    })
  })

  test('Review Focus 1: tempo esgotado e depois 200 → mesmo estado e mensagem, um ENVIADO, tentativas 1', async () => {
    await comUmRelato()
    await enfileirarAutomaticos(agora)
    const chamadas: { relato: string; corpo: unknown }[] = []
    const respostas: Awaited<ReturnType<typeof enviarAndamento>>[] = [
      { resultado: 'tentar_de_novo', motivo: 'O sistema não respondeu em 10 s.' },
      { resultado: 'enviado' },
    ]
    const enviar: typeof enviarAndamento = async (_alvo, relato, a) => {
      chamadas.push({ relato, corpo: a })
      return respostas.shift()!
    }
    expect(await enviarPendentes(agora, { enviar, chave })).toMatchObject({ reagendados: 1 })
    expect(await enviarPendentes(agora, { enviar, chave })).toMatchObject({ enviados: 0 })
    expect(await enviarPendentes(new Date(agora.getTime() + MIN), { enviar, chave })).toMatchObject(
      {
        enviados: 1,
      },
    )
    expect(chamadas).toHaveLength(2)
    expect(chamadas[0]).toEqual(chamadas[1])
    expect(chamadas[0]!.relato).toBe(ID_A)
    expect(await db.envioDeAndamento.findFirstOrThrow()).toMatchObject({
      situacao: 'ENVIADO',
      tentativas: 1,
    })
  })

  test('404 → DESCARTADO; 403 → sistema DESCONECTADO e envio PENDENTE sem tentativa', async () => {
    const id = await comUmRelato()
    await enfileirarAutomaticos(agora)
    await enviarPendentes(agora, { enviar: async () => ({ resultado: 'token_recusado' }), chave })
    expect(await db.sistemaConectado.findUniqueOrThrow({ where: { id } })).toMatchObject({
      estado: 'DESCONECTADO',
    })
    expect(await db.envioDeAndamento.findFirstOrThrow()).toMatchObject({
      situacao: 'PENDENTE',
      tentativas: 0,
    })
    await db.sistemaConectado.update({ where: { id }, data: { estado: 'ATIVO' } })
    await enviarPendentes(agora, {
      enviar: async () => ({
        resultado: 'descartar',
        motivo: 'O sistema não conhece este relato.',
      }),
      chave,
    })
    expect(await db.envioDeAndamento.findFirstOrThrow()).toMatchObject({
      situacao: 'DESCARTADO',
      ultimoErro: 'O sistema não conhece este relato.',
    })
  })

  test('demanda na fila de agentes com etapa planejada concluída → em-andamento (pula na-fila)', async () => {
    await comUmRelato()
    await enfileirarAutomaticos(agora)
    const d = await db.demanda.findFirstOrThrow()
    const planejada = (d.etapas as { chave: string; marco: string | null }[]).find(
      (e) => e.marco === 'planejada',
    )
    await db.demanda.update({
      where: { id: d.id },
      data: { destino: 'FILA_DE_AGENTES', concluidas: [...d.concluidas, planejada!.chave] },
    })
    expect(await enfileirarAutomaticos(agora)).toBe(1)
    const estados = (await db.envioDeAndamento.findMany({ orderBy: { estado: 'asc' } })).map(
      (e) => e.estado,
    )
    expect(estados).toEqual(['em-andamento', 'recebido'])
  })

  test('envio de mais de 7 dias que falha → DESCARTADO "Não entregue em 7 dias."', async () => {
    await comUmRelato()
    await enfileirarAutomaticos(new Date(agora.getTime() - 7 * 24 * 60 * MIN - MIN))
    await enviarPendentes(agora, {
      enviar: async () => ({ resultado: 'tentar_de_novo', motivo: 'O sistema respondeu 503.' }),
      chave,
    })
    expect(await db.envioDeAndamento.findFirstOrThrow()).toMatchObject({
      situacao: 'DESCARTADO',
      ultimoErro: 'Não entregue em 7 dias.',
    })
  })
})

describe('tela', () => {
  test('obterSistemasConectados conta hoje, não mostra revogados e exige permissão', async () => {
    const { id } = await criarSistema(admin, dados())
    const b = await criarSistema(
      admin,
      dados({ nome: 'Sistema Beta', url: 'https://beta.exemplo.com/v1' }),
    )
    await revogarSistema(admin, b.id, agora)
    const { buscar } = sistemaFalso([
      {
        relatos: [
          relatoDeExemplo({ id: ID_A }),
          relatoDeExemplo({ id: ID_B, resultado: 'orientado', tipo: null }),
        ],
        cursor: '2',
      },
    ])
    await buscarSistema(id, agora, { buscar, chave })
    const t = await obterSistemasConectados(admin, new Date(agora.getTime() + MIN))
    expect(t.quadros).toEqual({ relatosHoje: 2, viraramDemanda: 1, orientadosNaHora: 1 })
    expect(t.sistemas).toHaveLength(1)
    expect(t.sistemas[0]).toMatchObject({
      nome: 'Sistema Alfa',
      projeto: 'Projeto Alfa',
      host: 'alfa.exemplo.com',
      relatosHoje: 2,
      demandasHoje: 1,
      situacao: { texto: 'buscou há 1 min', tom: 'neutro' },
    })
    expect(JSON.stringify(t)).not.toContain('tokenCifrado')
    await expect(obterSistemasConectados(testador(), agora)).rejects.toThrow(ErroDeAutorizacao)
  })
})

describe('contexto do relato', () => {
  test('grava versão, plataforma e aparelho do contexto; ausentes ficam nulos', async () => {
    const { id } = await criarSistema(admin, dados())
    const { buscar } = sistemaFalso([
      {
        relatos: [
          relatoDeExemplo({
            contexto: { tela: 'Pedidos', versao: '2.3', plataforma: 'ios', aparelho: 'iPhone 15' },
          }),
          relatoDeExemplo({ id: ID_B, ticket: 'R-0002' }),
        ],
        cursor: '2',
      },
    ])
    await buscarSistema(id, agora, { buscar, chave })
    const a = await db.relato.findFirstOrThrow({ where: { idExterno: ID_A } })
    expect(a).toMatchObject({ versao: '2.3', plataforma: 'ios', aparelho: 'iPhone 15' })
    const b = await db.relato.findFirstOrThrow({ where: { idExterno: ID_B } })
    expect(b).toMatchObject({ plataforma: null, aparelho: null })
  })
})

describe('anexos do relato', () => {
  let dir: string
  let dirAntes: string | undefined
  beforeAll(async () => {
    dirAntes = process.env.FLOW_ARQUIVOS_DIR
    dir = await mkdtemp(join(tmpdir(), 'flow-relatos-anexos-'))
    process.env.FLOW_ARQUIVOS_DIR = dir
  })
  afterAll(async () => {
    if (dirAntes === undefined) delete process.env.FLOW_ARQUIVOS_DIR
    else process.env.FLOW_ARQUIVOS_DIR = dirAntes
    await rm(dir, { recursive: true, force: true })
  })

  const comAnexos = () =>
    relatoDeExemplo({
      anexos: [
        { tipo: 'imagem', url: 'https://alfa.exemplo.com/v1/relatos/anexos/p1', bytes: 3 },
        { tipo: 'imagem', url: 'https://alfa.exemplo.com/v1/relatos/anexos/p2', bytes: 3 },
      ],
    })

  test('o print do relato é copiado para a demanda; o que não baixa fica de fora sem travar a busca', async () => {
    const { id } = await criarSistema(admin, dados())
    const { buscar } = sistemaFalso([{ relatos: [comAnexos()], cursor: '1' }])
    const pedidos: string[] = []
    const baixar: typeof baixarAnexo = async (alvo, url) => {
      expect(alvo.token).toBe(TOKEN)
      pedidos.push(url)
      return url.endsWith('/p1')
        ? { ok: true, conteudo: 'image/png', bytes: Buffer.from([137, 80, 78]) }
        : { ok: false, motivo: 'O sistema respondeu 404.' }
    }
    const r = await buscarSistema(id, agora, { buscar, chave, baixar })
    expect(r).toMatchObject({ novos: 1, falha: null })
    expect(pedidos).toEqual([
      'https://alfa.exemplo.com/v1/relatos/anexos/p1',
      'https://alfa.exemplo.com/v1/relatos/anexos/p2',
    ])
    const demanda = await db.demanda.findFirstOrThrow({ include: { arquivos: true } })
    expect(demanda.arquivos).toHaveLength(1)
    expect(demanda.arquivos[0]).toMatchObject({
      tipo: 'ANEXO',
      nome: 'print-1-do-relato',
      conteudo: 'image/png',
      tamanho: 3,
      enviadoPor: 'flow',
    })
  })

  test('relato repetido não baixa de novo', async () => {
    const { id } = await criarSistema(admin, dados())
    const { buscar } = sistemaFalso([
      { relatos: [comAnexos()], cursor: '1' },
      { relatos: [comAnexos()], cursor: '2' },
    ])
    let chamadas = 0
    const baixar: typeof baixarAnexo = async () => {
      chamadas++
      return { ok: true, conteudo: 'image/png', bytes: Buffer.from([1]) }
    }
    await buscarSistema(id, agora, { buscar, chave, baixar })
    await buscarSistema(id, new Date(agora.getTime() + MIN), { buscar, chave, baixar })
    expect(chamadas).toBe(2)
    expect(await db.arquivoDaDemanda.count()).toBe(2)
  })
})

describe('recuperar anexos faltantes', () => {
  let dir: string
  let dirAntes: string | undefined
  beforeAll(async () => {
    dirAntes = process.env.FLOW_ARQUIVOS_DIR
    dir = await mkdtemp(join(tmpdir(), 'flow-relatos-recuperar-'))
    process.env.FLOW_ARQUIVOS_DIR = dir
  })
  afterAll(async () => {
    if (dirAntes === undefined) delete process.env.FLOW_ARQUIVOS_DIR
    else process.env.FLOW_ARQUIVOS_DIR = dirAntes
    await rm(dir, { recursive: true, force: true })
  })

  const anexo = (n: number) => ({
    tipo: 'imagem',
    url: `https://alfa.exemplo.com/v1/relatos/anexos/p${n}`,
    bytes: 3,
  })
  const baixaTudo: typeof baixarAnexo = async () => ({
    ok: true,
    conteudo: 'image/png',
    bytes: Buffer.from([137, 80, 78]),
  })
  const naoBaixa: typeof baixarAnexo = async () => ({
    ok: false,
    motivo: 'O sistema respondeu 500.',
  })

  /** Relato que chegou antes da cópia existir: demanda aberta, nenhuma linha de arquivo. */
  async function relatoSemCopia(n = 2, extra: Record<string, unknown> = {}) {
    const { id } = await criarSistema(admin, dados())
    const { buscar } = sistemaFalso([
      {
        relatos: [
          relatoDeExemplo({ anexos: Array.from({ length: n }, (_, i) => anexo(i + 1)), ...extra }),
        ],
        cursor: '1',
      },
    ])
    await buscarSistema(id, agora, { buscar, chave, baixar: naoBaixa })
    expect(await db.arquivoDaDemanda.count()).toBe(0)
    return { sistemaId: id, demanda: await db.demanda.findFirstOrThrow() }
  }

  test('copia o que falta, também para demanda já no ar, sem alterar a demanda', async () => {
    const { demanda } = await relatoSemCopia()
    await db.demanda.update({ where: { id: demanda.id }, data: { noArEm: agora } })
    const antes = await db.demanda.findUniqueOrThrow({ where: { id: demanda.id } })
    const r = await recuperarAnexosFaltantes(new Date(agora.getTime() + MIN), {
      baixar: baixaTudo,
      chave,
    })
    expect(r).toEqual({ copiados: 2, falhas: 0 })
    const arquivos = await db.arquivoDaDemanda.findMany({ orderBy: { nome: 'asc' } })
    expect(arquivos.map((a) => a.nome)).toEqual(['print-1-do-relato', 'print-2-do-relato'])
    expect(await db.demanda.findUniqueOrThrow({ where: { id: demanda.id } })).toEqual(antes)
  })

  test('não recopia o que já existe', async () => {
    await relatoSemCopia()
    await recuperarAnexosFaltantes(agora, { baixar: baixaTudo, chave })
    let chamadas = 0
    const r = await recuperarAnexosFaltantes(agora, {
      baixar: async (...a) => (chamadas++, baixaTudo(...a)),
      chave,
    })
    expect(r).toEqual({ copiados: 0, falhas: 0 })
    expect(chamadas).toBe(0)
  })

  test('não recopia o apagado pela retenção', async () => {
    await relatoSemCopia()
    await recuperarAnexosFaltantes(agora, { baixar: baixaTudo, chave })
    await db.arquivoDaDemanda.updateMany({ data: { apagadoEm: agora } })
    const r = await recuperarAnexosFaltantes(agora, { baixar: baixaTudo, chave })
    expect(r).toEqual({ copiados: 0, falhas: 0 })
    expect(await db.arquivoDaDemanda.count({ where: { apagadoEm: null } })).toBe(0)
  })

  test('pula a demanda com a retenção vencida', async () => {
    const { demanda } = await relatoSemCopia()
    await db.demanda.update({ where: { id: demanda.id }, data: { noArEm: agora } })
    const depois = new Date(agora.getTime() + 91 * 24 * 60 * 60_000)
    const r = await recuperarAnexosFaltantes(depois, { baixar: baixaTudo, chave })
    expect(r).toEqual({ copiados: 0, falhas: 0 })
    expect(await db.arquivoDaDemanda.count()).toBe(0)
  })

  test('falha de download conta e não quebra; a próxima rodada tenta de novo', async () => {
    await relatoSemCopia()
    const r = await recuperarAnexosFaltantes(agora, { baixar: naoBaixa, chave })
    expect(r).toEqual({ copiados: 0, falhas: 2 })
    const lancou: typeof baixarAnexo = async () => {
      throw new Error('rede')
    }
    expect(await recuperarAnexosFaltantes(agora, { baixar: lancou, chave })).toEqual({
      copiados: 0,
      falhas: 2,
    })
    expect(await recuperarAnexosFaltantes(agora, { baixar: baixaTudo, chave })).toEqual({
      copiados: 2,
      falhas: 0,
    })
  })

  test('respeita o teto de 20 arquivos por rodada', async () => {
    await relatoSemCopia(8)
    await db.relato.create({
      data: {
        sistemaId: (await db.sistemaConectado.findFirstOrThrow()).id,
        idExterno: ID_B,
        ticket: 'R-0002',
        canal: 'SISTEMA',
        em: new Date('2026-11-26T13:30:00.000Z'),
        autorIdExterno: 'u-2',
        autorNome: 'Bia',
        autorPapel: 'Assessora',
        resultado: 'SEGUE',
        demandaId: (await db.demanda.findFirstOrThrow()).id,
        anexos: Array.from({ length: 16 }, (_, i) => ({
          tipo: 'imagem',
          bytes: 3,
          caminho: `https://alfa.exemplo.com/v1/relatos/anexos/q${i}`,
        })),
        sinais: [],
      },
    })
    const r1 = await recuperarAnexosFaltantes(agora, { baixar: baixaTudo, chave })
    expect(r1).toEqual({ copiados: 20, falhas: 0 })
    const r2 = await recuperarAnexosFaltantes(agora, { baixar: baixaTudo, chave })
    expect(r2).toEqual({ copiados: 4, falhas: 0 })
    expect(await db.arquivoDaDemanda.count()).toBe(24)
  })

  test('ignora sistema que não está ativo e relato orientado', async () => {
    const { sistemaId } = await relatoSemCopia()
    await db.sistemaConectado.update({ where: { id: sistemaId }, data: { estado: 'DESCONECTADO' } })
    const r = await recuperarAnexosFaltantes(agora, { baixar: baixaTudo, chave })
    expect(r).toEqual({ copiados: 0, falhas: 0 })
    await db.sistemaConectado.update({ where: { id: sistemaId }, data: { estado: 'ATIVO' } })
    await db.relato.updateMany({ data: { resultado: 'ORIENTADO' } })
    expect(await recuperarAnexosFaltantes(agora, { baixar: baixaTudo, chave })).toEqual({
      copiados: 0,
      falhas: 0,
    })
  })

  test('arquivo e acima de 10 MB nunca são baixados, nem gastam o teto nem contam como falha', async () => {
    const { sistemaId, demanda } = await relatoSemCopia(0)
    const base = {
      sistemaId,
      ticket: 'R-9',
      canal: 'SISTEMA' as const,
      em: new Date('2026-11-26T13:00:00.000Z'),
      autorIdExterno: 'u-2',
      autorNome: 'Bia',
      autorPapel: 'Assessora',
      resultado: 'SEGUE' as const,
      demandaId: demanda.id,
      sinais: [],
    }
    const url = (n: string) => `https://alfa.exemplo.com/v1/relatos/anexos/${n}`
    await db.relato.create({
      data: {
        ...base,
        idExterno: ID_B,
        em: new Date('2026-11-26T12:00:00.000Z'),
        anexos: [
          ...Array.from({ length: 25 }, (_, i) => ({
            tipo: 'arquivo',
            bytes: 3,
            caminho: url(`v${i}`),
          })),
          { tipo: 'imagem', bytes: 11 * 1024 * 1024, caminho: url('grande') },
        ],
      },
    })
    await db.relato.create({
      data: {
        ...base,
        idExterno: ID_C,
        em: new Date('2026-11-26T14:00:00.000Z'),
        anexos: [{ tipo: 'imagem', bytes: 3, caminho: url('nova') }],
      },
    })
    const pedidos: string[] = []
    const r = await recuperarAnexosFaltantes(agora, {
      baixar: async (a, u, l) => (pedidos.push(u), baixaTudo(a, u, l)),
      chave,
    })
    expect(pedidos).toEqual([url('nova')])
    expect(r).toEqual({ copiados: 1, falhas: 0 })
  })

  test('recupera vídeo do relato como anexo da demanda', async () => {
    const { sistemaId, demanda } = await relatoSemCopia(0)
    const url = `https://alfa.exemplo.com/v1/relatos/anexos/video-1`
    await db.relato.create({
      data: {
        sistemaId,
        ticket: 'R-8',
        canal: 'SISTEMA',
        idExterno: ID_B,
        em: new Date('2026-11-26T12:00:00.000Z'),
        autorIdExterno: 'u-2',
        autorNome: 'Bia',
        autorPapel: 'Assessora',
        resultado: 'SEGUE',
        demandaId: demanda.id,
        sinais: [],
        anexos: [{ tipo: 'video', bytes: 3, caminho: url }],
      },
    })
    const r = await recuperarAnexosFaltantes(agora, {
      baixar: async () => ({ ok: true, conteudo: 'video/mp4', bytes: Buffer.from([0, 0, 0]) }),
      chave,
    })
    expect(r).toEqual({ copiados: 1, falhas: 0 })
    const arquivo = await db.arquivoDaDemanda.findFirstOrThrow({ where: { demandaId: demanda.id } })
    expect(arquivo.conteudo).toBe('video/mp4')
    expect(arquivo.id).toBe(idDoAnexo(`${sistemaId}:${ID_B}`, 0))
  })
})
