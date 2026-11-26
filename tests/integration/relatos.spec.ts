import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { decifrarSegredo, MENSAGEM_SEM_CHAVE } from '@/lib/segredos'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { enfileirarAutomaticos, enviarPendentes } from '@/modules/relatos/andamento'
import { buscarSistema, buscarTodos } from '@/modules/relatos/busca'
import type { buscarPagina, enviarAndamento, PaginaBuscada } from '@/modules/relatos/cliente'
import { lerPagina } from '@/modules/relatos/contrato'
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
