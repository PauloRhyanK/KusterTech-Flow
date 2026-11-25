import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { ArmazenamentoNaoConfigurado } from '@/modules/demandas/arquivos'
import { MODELO_PADRAO, type EtapaDefinida } from '@/modules/demandas/model'
import {
  aprovarDesenho,
  criarDemanda,
  criarModeloDeEtapas,
  decidirDestino,
  definirDemandasDoProjeto,
  guardarArquivo,
  modeloDoProjeto,
  pedirAjuste,
  registrarEvento,
} from '@/modules/demandas/service'
import { LIMITE_POR_ARQUIVO } from '@/modules/demandas/transicoes'
import { limparBanco } from './banco-de-teste'

const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const aprovador: Sujeito = {
  usuarioId: 'u-aprovador',
  papeis: [{ papel: 'APROVADOR', clienteId: null }],
}
const MB = 1024 * 1024

let dir: string
const anterior = process.env.FLOW_ARQUIVOS_DIR
let githubId = 7000

async function criarRepositorio(nome: string, projetoId: string | null) {
  githubId += 1
  return db.repositorioGitHub.create({
    data: {
      githubId: BigInt(githubId),
      instalacaoId: BigInt(1),
      nomeCompleto: `kustertech-exemplo/${nome}`,
      urlHtml: `https://github.com/kustertech-exemplo/${nome}`,
      privado: true,
      catalogadoEm: new Date(),
      projetoId,
    },
  })
}

async function cenario() {
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto alfa' },
  })
  const repositorio = await criarRepositorio('alfa', projeto.id)
  return { projeto, repositorio }
}

function corpoDe(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes)
      c.close()
    },
  })
}

function corpoEmPedacos(total: number, pedaco = 256 * 1024): ReadableStream<Uint8Array> {
  let enviado = 0
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      if (enviado >= total) return c.close()
      const n = Math.min(pedaco, total - enviado)
      c.enqueue(new Uint8Array(n))
      enviado += n
      await new Promise((r) => setTimeout(r, 1))
    },
  })
}

const triagem = (destino: string) => ({
  tipo: 'triagem' as const,
  ator: 'fabrica' as const,
  dados: {
    tipo: 'ajuste' as const,
    destino: destino as 'fila_de_agentes',
    tamanho: 'pequeno' as const,
    mexeEm: 'tela de entrada',
    risco: 'baixo' as const,
    dados: 'nenhum' as const,
    impacto: { toca: [], podeQuebrar: [], autorizacao: false, caminhoProtegido: false },
    resposta: null,
    motivo: 'ajuste simples',
  },
})

function daFabrica(demandaId: string, evento: Parameters<typeof registrarEvento>[0]['evento']) {
  return registrarEvento({
    demandaId,
    idExterno: randomUUID(),
    evento,
    origem: 'fabrica',
    em: new Date(),
  })
}

async function enviarDesenho(demandaId: string) {
  const arquivoId = randomUUID()
  const r = await guardarArquivo({
    demandaId,
    arquivoId,
    tipo: 'desenho',
    nome: 'desenho.html',
    conteudo: 'text/html',
    tamanhoDeclarado: null,
    corpo: corpoDe(new TextEncoder().encode('<p>desenho</p>')),
    tela: null,
    enviadoPor: 'fabrica',
  })
  expect(r.status).toBe(201)
  const ev = await daFabrica(demandaId, {
    tipo: 'desenho_pronto',
    ator: 'fabrica',
    dados: { arquivoId },
  })
  expect(ev.resultado).toBe('aplicado')
  return arquivoId
}

/** Demanda com tela em "aprovar desenho", já no desenho com a versão 1 esperando o Paulo. */
async function demandaNoDesenho() {
  const { projeto, repositorio } = await cenario()
  const { id } = await criarDemanda(admin, {
    projetoId: projeto.id,
    repositorioId: repositorio.id,
    titulo: 'Botão de exportar',
    descricao: null,
    nivel: 'aprovar_desenho',
    temTela: true,
    anexos: [],
  })
  expect((await daFabrica(id, triagem('fila_de_agentes'))).resultado).toBe('aplicado')
  const plano = await daFabrica(id, {
    tipo: 'plano_criado',
    ator: 'fabrica',
    dados: { plano: '.fabrica/planos/botao-exportar.json', prUrl: null },
  })
  expect(plano.resultado).toBe('aplicado')
  await enviarDesenho(id)
  return id
}

beforeEach(async () => {
  await limparBanco()
  dir = await mkdtemp(join(tmpdir(), 'flow-demandas-'))
  process.env.FLOW_ARQUIVOS_DIR = dir
  for (const s of [admin, aprovador]) {
    await db.usuario.create({
      data: {
        id: s.usuarioId,
        email: `${s.usuarioId}@local.test`,
        nome: s.usuarioId,
        senhaHash: 'x',
      },
    })
  }
})

afterEach(async () => {
  if (anterior === undefined) delete process.env.FLOW_ARQUIVOS_DIR
  else process.env.FLOW_ARQUIVOS_DIR = anterior
  await rm(dir, { recursive: true, force: true })
})

describe('demandas / service (integração)', () => {
  async function demandaParaDecidir() {
    const { projeto, repositorio } = await cenario()
    const { id } = await criarDemanda(admin, {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      titulo: 'Decidir',
      descricao: null,
      nivel: 'aprovar_desenho',
      temTela: true,
      anexos: [],
    })
    expect((await daFabrica(id, triagem('decisao_do_paulo'))).resultado).toBe('aplicado')
    return id
  }

  test('decidirDestino com { tipo, nivel, escopo } grava a coluna tipo e o evento com nivel e escopo', async () => {
    const id = await demandaParaDecidir()
    await decidirDestino(admin, id, 'fila_de_agentes', {
      tipo: 'ajuste',
      nivel: 'vai_sozinho',
      escopo: '  só o botão  ',
    })
    const d = await db.demanda.findUniqueOrThrow({ where: { id } })
    expect(d.tipo).toBe('AJUSTE')
    expect(d.nivel).toBe('VAI_SOZINHO')
    expect(d.espera).toBeNull()
    const ev = await db.eventoDaDemanda.findFirstOrThrow({
      where: { demandaId: id, tipo: 'destino_decidido' },
    })
    expect(ev.dados).toEqual({
      destino: 'fila_de_agentes',
      nivel: 'vai_sozinho',
      escopo: 'só o botão',
    })
  })

  test('decidirDestino com escopo de 501 → ErroDeDominio e nada gravado', async () => {
    const id = await demandaParaDecidir()
    await expect(
      decidirDestino(admin, id, 'fila_de_agentes', { tipo: 'ajuste', escopo: 'x'.repeat(501) }),
    ).rejects.toThrow(ErroDeDominio)
    const d = await db.demanda.findUniqueOrThrow({ where: { id } })
    expect(d.espera).toBe('decidir_destino')
    expect(
      await db.eventoDaDemanda.count({ where: { demandaId: id, tipo: 'destino_decidido' } }),
    ).toBe(0)
  })

  test('criarDemanda sem projetos.gerenciar → ErroDeAutorizacao; com → demanda em "recebida", origem FLOW, evento "criada" no histórico com usuarioId', async () => {
    const { projeto, repositorio } = await cenario()
    const entrada = {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      titulo: 'Corrigir filtro',
      descricao: 'O filtro some ao voltar',
      nivel: 'vai_sozinho' as const,
      temTela: false,
      anexos: [],
    }
    await expect(criarDemanda(aprovador, entrada)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    expect(await db.demanda.count()).toBe(0)

    const { id } = await criarDemanda(admin, entrada)
    const d = await db.demanda.findUniqueOrThrow({ where: { id }, include: { eventos: true } })
    expect(d).toMatchObject({
      etapaAtual: 'recebida',
      origem: 'FLOW',
      nivel: 'VAI_SOZINHO',
      criadaPorId: admin.usuarioId,
      espera: null,
      encerrada: null,
    })
    expect(d.etapas).toEqual(MODELO_PADRAO)
    expect(d.eventos).toHaveLength(1)
    expect(d.eventos[0]).toMatchObject({
      tipo: 'criada',
      origem: 'flow',
      usuarioId: admin.usuarioId,
    })
  })

  test('criarDemanda sem nivel usa o nivelPadraoDeDemanda do projeto; repositório de outro projeto → "O repositório não é deste projeto."', async () => {
    const { projeto, repositorio } = await cenario()
    await db.projeto.update({
      where: { id: projeto.id },
      data: { nivelPadraoDeDemanda: 'PLANEJAR_COMIGO' },
    })
    const { id } = await criarDemanda(admin, {
      projetoId: projeto.id,
      repositorioId: null,
      titulo: 'Sem nível',
      descricao: null,
      nivel: null,
      temTela: true,
      anexos: [],
    })
    const d = await db.demanda.findUniqueOrThrow({ where: { id } })
    expect(d.nivel).toBe('PLANEJAR_COMIGO')
    expect(d.repositorioId).toBe(repositorio.id)

    const outro = await db.projeto.create({
      data: { nome: 'Projeto Beta', nomeNormalizado: 'projeto beta' },
    })
    const deOutro = await criarRepositorio('beta', outro.id)
    await expect(
      criarDemanda(admin, {
        projetoId: projeto.id,
        repositorioId: deOutro.id,
        titulo: 'Errada',
        descricao: null,
        nivel: 'vai_sozinho',
        temTela: false,
        anexos: [],
      }),
    ).rejects.toThrow(new ErroDeDominio('O repositório não é deste projeto.'))
  })

  test('criarDemanda com anexo em produção sem FLOW_ARQUIVOS_DIR → ArmazenamentoNaoConfigurado antes de abrir a demanda', async () => {
    const { projeto, repositorio } = await cenario()
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.FLOW_ARQUIVOS_DIR
    try {
      await expect(
        criarDemanda(admin, {
          projetoId: projeto.id,
          repositorioId: repositorio.id,
          titulo: 'Com anexo',
          descricao: null,
          nivel: 'vai_sozinho',
          temTela: true,
          anexos: [new File([new Uint8Array(10)], 'tela.png', { type: 'image/png' })],
        }),
      ).rejects.toBeInstanceOf(ArmazenamentoNaoConfigurado)
    } finally {
      vi.unstubAllEnvs()
    }
    expect(await db.demanda.count()).toBe(0)
  })

  test('criarDemanda com dois anexos grava dois ArquivoDaDemanda ANEXO e os bytes no volume', async () => {
    const { projeto, repositorio } = await cenario()
    const a = new File([new Uint8Array([1, 2, 3])], 'tela.png', { type: 'image/png' })
    const b = new File([new Uint8Array([9, 8])], 'audio.webm', { type: 'audio/webm' })
    const { id } = await criarDemanda(admin, {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      titulo: 'Com anexos',
      descricao: null,
      nivel: 'vai_sozinho',
      temTela: false,
      anexos: [a, b],
    })
    const arquivos = await db.arquivoDaDemanda.findMany({
      where: { demandaId: id },
      orderBy: { nome: 'asc' },
    })
    expect(arquivos.map((x) => [x.tipo, x.nome, x.conteudo, x.tamanho, x.enviadoPor])).toEqual([
      ['ANEXO', 'audio.webm', 'audio/webm', 2, 'paulo'],
      ['ANEXO', 'tela.png', 'image/png', 3, 'paulo'],
    ])
    const bytes = await readFile(join(dir, 'demandas', id, arquivos[1]!.id))
    expect([...bytes]).toEqual([1, 2, 3])
  })

  test('registrarEvento triagem → aplicado; o mesmo idExterno e dados → repetido sem novo evento; mesmo idExterno com outro destino → conflito', async () => {
    const { projeto, repositorio } = await cenario()
    const { id } = await criarDemanda(admin, {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      titulo: 'T',
      descricao: null,
      nivel: 'vai_sozinho',
      temTela: false,
      anexos: [],
    })
    const idExterno = randomUUID()
    const base = { demandaId: id, idExterno, origem: 'fabrica' as const }

    const r1 = await registrarEvento({ ...base, evento: triagem('urgente'), em: new Date() })
    expect(r1).toMatchObject({ resultado: 'aplicado', estado: { etapaAtual: 'planejada' } })
    const d = await db.demanda.findUniqueOrThrow({ where: { id } })
    expect(d.destino).toBe('URGENTE')
    expect(d.tipo).toBe('AJUSTE')
    expect(d.triagem).toMatchObject({ destino: 'urgente', motivo: 'ajuste simples' })

    const r2 = await registrarEvento({
      ...base,
      evento: triagem('urgente'),
      em: new Date(Date.now() + 60_000),
    })
    expect(r2).toMatchObject({ resultado: 'repetido', estado: { etapaAtual: 'planejada' } })

    const r3 = await registrarEvento({ ...base, evento: triagem('lote_da_noite'), em: new Date() })
    expect(r3).toEqual({ resultado: 'conflito' })

    expect(await db.eventoDaDemanda.count({ where: { idExterno } })).toBe(1)
    expect((await db.demanda.findUniqueOrThrow({ where: { id } })).destino).toBe('URGENTE')
  })

  test('registrarEvento com o mesmo idExterno ao mesmo tempo grava um só evento', async () => {
    const { projeto, repositorio } = await cenario()
    const { id } = await criarDemanda(admin, {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      titulo: 'T',
      descricao: null,
      nivel: 'vai_sozinho',
      temTela: false,
      anexos: [],
    })
    const idExterno = randomUUID()
    const enviar = () =>
      registrarEvento({
        demandaId: id,
        idExterno,
        evento: triagem('urgente'),
        origem: 'fabrica',
        em: new Date(),
      })
    const rs = await Promise.all([enviar(), enviar(), enviar()])
    expect(rs.map((r) => r.resultado).sort()).toEqual(['aplicado', 'repetido', 'repetido'])
    expect(await db.eventoDaDemanda.count({ where: { idExterno } })).toBe(1)
  })

  test('registrarEvento recusado (desenho_pronto em "recebida") não grava evento nem muda a demanda', async () => {
    const { projeto, repositorio } = await cenario()
    const { id } = await criarDemanda(admin, {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      titulo: 'T',
      descricao: null,
      nivel: 'aprovar_desenho',
      temTela: true,
      anexos: [],
    })
    const arquivoId = randomUUID()
    expect(
      (
        await guardarArquivo({
          demandaId: id,
          arquivoId,
          tipo: 'desenho',
          nome: 'd.html',
          conteudo: 'text/html',
          tamanhoDeclarado: 3,
          corpo: corpoDe(new TextEncoder().encode('<p>')),
          tela: null,
          enviadoPor: 'fabrica',
        })
      ).status,
    ).toBe(201)
    const antes = await db.demanda.findUniqueOrThrow({ where: { id } })

    const r = await daFabrica(id, { tipo: 'desenho_pronto', ator: 'fabrica', dados: { arquivoId } })
    expect(r).toEqual({ resultado: 'recusado', motivo: 'A etapa atual não é desenho.' })

    const semArquivo = await daFabrica(id, {
      tipo: 'desenho_pronto',
      ator: 'fabrica',
      dados: { arquivoId: randomUUID() },
    })
    expect(semArquivo).toEqual({
      resultado: 'recusado',
      motivo: 'Arquivo do desenho não encontrado.',
    })

    expect(await db.eventoDaDemanda.count({ where: { demandaId: id } })).toBe(1)
    const depois = await db.demanda.findUniqueOrThrow({ where: { id } })
    expect(depois).toEqual(antes)
    expect((await db.arquivoDaDemanda.findUniqueOrThrow({ where: { id: arquivoId } })).versao).toBe(
      null,
    )
  })

  test('primeira versão do desenho deixa a demanda esperando aprovar_desenho e o arquivo com versao 1', async () => {
    const id = await demandaNoDesenho()
    const d = await db.demanda.findUniqueOrThrow({ where: { id } })
    expect(d).toMatchObject({
      etapaAtual: 'desenho',
      espera: 'aprovar_desenho',
      versaoDoDesenho: 1,
    })
    expect(d.esperaDesde).toBeInstanceOf(Date)
    expect(d.planoCaminho).toBe('.fabrica/planos/botao-exportar.json')
    const desenho = await db.arquivoDaDemanda.findFirstOrThrow({ where: { demandaId: id } })
    expect(desenho.versao).toBe(1)
  })

  test('Review Focus 2: aprovarDesenho(v2) depois de desenho_pronto v3 → ErroDeDominio "Há uma versão mais nova do desenho."', async () => {
    const id = await demandaNoDesenho()
    await pedirAjuste(admin, id, 1, 'mais contraste')
    await enviarDesenho(id)
    // a Fábrica manda a v3 sem esperar a resposta do Paulo à v2
    await enviarDesenho(id)

    await expect(aprovarDesenho(admin, id, 2)).rejects.toThrow(
      new ErroDeDominio('Há uma versão mais nova do desenho.'),
    )
    const d = await db.demanda.findUniqueOrThrow({ where: { id } })
    expect(d).toMatchObject({
      espera: 'aprovar_desenho',
      versaoDoDesenho: 3,
      desenhoAprovado: null,
    })

    await expect(aprovarDesenho(aprovador, id, 3)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await aprovarDesenho(admin, id, 3)
    const aprovada = await db.demanda.findUniqueOrThrow({
      where: { id },
      include: { eventos: { orderBy: { seq: 'desc' }, take: 1 } },
    })
    expect(aprovada).toMatchObject({ etapaAtual: 'desenvolvida', desenhoAprovado: 3, espera: null })
    expect(aprovada.eventos[0]).toMatchObject({
      tipo: 'desenho_aprovado',
      origem: 'paulo',
      usuarioId: admin.usuarioId,
      dados: { versao: 3 },
    })
  })

  test('pedirAjuste três vezes → nivel PLANEJAR_COMIGO e espera planejar_comigo; histórico com três ajuste_pedido e os textos', async () => {
    const id = await demandaNoDesenho()
    await pedirAjuste(admin, id, 1, 'ajuste um')
    await enviarDesenho(id)
    await pedirAjuste(admin, id, 2, 'ajuste dois')
    await enviarDesenho(id)
    await pedirAjuste(admin, id, 3, 'ajuste três')

    await expect(pedirAjuste(admin, id, 3, '')).rejects.toBeInstanceOf(ErroDeDominio)

    const d = await db.demanda.findUniqueOrThrow({ where: { id } })
    expect(d).toMatchObject({
      nivel: 'PLANEJAR_COMIGO',
      espera: 'planejar_comigo',
      recusasDoDesenho: 3,
    })
    const ajustes = await db.eventoDaDemanda.findMany({
      where: { demandaId: id, tipo: 'ajuste_pedido' },
      orderBy: { seq: 'asc' },
    })
    expect(ajustes.map((a) => a.dados)).toEqual([
      { versao: 1, texto: 'ajuste um' },
      { versao: 2, texto: 'ajuste dois' },
      { versao: 3, texto: 'ajuste três' },
    ])
  })

  test('troca de modelo com demandas em curso: definirDemandasDoProjeto com um modelo de 7 etapas → a demanda aberta antes segue com as etapas do retrato; a nova nasce com 7', async () => {
    const { projeto, repositorio } = await cenario()
    const entrada = {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      titulo: 'T',
      descricao: null,
      nivel: null,
      temTela: true,
      anexos: [],
    }
    const antiga = await criarDemanda(admin, entrada)

    const sete: EtapaDefinida[] = [
      ...MODELO_PADRAO.slice(0, 5),
      {
        chave: 'conferencia',
        nome: 'Conferência do Paulo',
        rotulo: 'Conferência',
        marco: null,
        quemConclui: 'paulo',
        puladaSemTela: false,
        esperaEm: [],
      },
      MODELO_PADRAO[5]!,
    ]
    const { id: modeloId } = await criarModeloDeEtapas(admin, 'Com conferência', sete)
    await expect(
      definirDemandasDoProjeto(aprovador, projeto.id, { modeloId, nivelPadrao: 'vai_sozinho' }),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await definirDemandasDoProjeto(admin, projeto.id, { modeloId, nivelPadrao: 'vai_sozinho' })

    expect(await modeloDoProjeto(projeto.id)).toEqual({ modeloId, etapas: sete })
    const nova = await criarDemanda(admin, entrada)

    const a = await db.demanda.findUniqueOrThrow({ where: { id: antiga.id } })
    const n = await db.demanda.findUniqueOrThrow({ where: { id: nova.id } })
    expect((a.etapas as unknown[]).length).toBe(MODELO_PADRAO.length)
    expect(a.nivel).toBe('APROVAR_DESENHO')
    expect(n.etapas).toEqual(sete)
    expect(n.modeloId).toBe(modeloId)
    expect(n.nivel).toBe('VAI_SOZINHO')
  })

  test('sem modelo padrão no banco, criar demanda falha alto', async () => {
    const { projeto, repositorio } = await cenario()
    await db.modeloDeEtapas.deleteMany()
    await expect(modeloDoProjeto(projeto.id)).rejects.toThrow('modelo de etapas padrão')
    await expect(
      criarDemanda(admin, {
        projetoId: projeto.id,
        repositorioId: repositorio.id,
        titulo: 'T',
        descricao: null,
        nivel: null,
        temTela: false,
        anexos: [],
      }),
    ).rejects.toThrow('modelo de etapas padrão')
  })

  test('criarModeloDeEtapas com marco repetido → ErroDeDominio; sem configuracoes.gerenciar → ErroDeAutorizacao', async () => {
    const repetido = [...MODELO_PADRAO.slice(0, 2), MODELO_PADRAO[1]!, ...MODELO_PADRAO.slice(2)]
    const comChaveNova = repetido.map((e, i) => (i === 2 ? { ...e, chave: 'planejada-2' } : e))
    await expect(criarModeloDeEtapas(admin, 'Repetido', comChaveNova)).rejects.toThrow(
      new ErroDeDominio('marco repetido: "planejada"'),
    )
    await expect(
      criarModeloDeEtapas(aprovador, 'Qualquer', [...MODELO_PADRAO]),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
    expect(await db.modeloDeEtapas.count()).toBe(1)
  })

  test('guardarArquivo: dois envios simultâneos que juntos passam de 100 MB na mesma demanda → um 201 e um 413 "A demanda passaria de 100 MB."; o recusado não deixa arquivo', async () => {
    const { projeto, repositorio } = await cenario()
    const { id } = await criarDemanda(admin, {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      titulo: 'T',
      descricao: null,
      nivel: 'vai_sozinho',
      temTela: true,
      anexos: [],
    })
    // 85 MB já usados (só as linhas: o limite conta o que o banco diz)
    for (let i = 0; i < 9; i++) {
      await db.arquivoDaDemanda.create({
        data: {
          id: randomUUID(),
          demandaId: id,
          tipo: 'CAPTURA',
          nome: `c${i}.png`,
          conteudo: 'image/png',
          tamanho: i < 8 ? 10 * MB : 5 * MB,
          tela: 'desktop',
          enviadoPor: 'fabrica',
        },
      })
    }
    const ids = [randomUUID(), randomUUID()]
    const envio = (arquivoId: string) =>
      guardarArquivo({
        demandaId: id,
        arquivoId,
        tipo: 'captura',
        nome: 'tela.png',
        conteudo: 'image/png',
        tamanhoDeclarado: null,
        corpo: corpoEmPedacos(LIMITE_POR_ARQUIVO),
        tela: 'celular',
        enviadoPor: 'fabrica',
      })
    const rs = await Promise.all(ids.map(envio))
    expect(rs.map((r) => r.status).sort()).toEqual([201, 413])
    const recusado = rs.findIndex((r) => r.status === 413)
    expect(rs[recusado]!.corpo).toEqual({ erro: 'A demanda passaria de 100 MB.' })

    const noDisco = await readdir(join(dir, 'demandas', id))
    expect(noDisco).toEqual([ids[1 - recusado]])
    expect(await db.arquivoDaDemanda.findUnique({ where: { id: ids[recusado]! } })).toBeNull()

    const grande = await guardarArquivo({
      demandaId: id,
      arquivoId: randomUUID(),
      tipo: 'captura',
      nome: 'x.png',
      conteudo: 'image/png',
      tamanhoDeclarado: LIMITE_POR_ARQUIVO + 1,
      corpo: corpoDe(new Uint8Array(1)),
      tela: 'celular',
      enviadoPor: 'fabrica',
    })
    expect(grande).toEqual({ status: 413, corpo: { erro: 'Arquivo maior que 10 MB.' } })
  })

  test('guardarArquivo: mesmo arquivoId repetido → 200; mesmo id com outro tamanho → 409', async () => {
    const { projeto, repositorio } = await cenario()
    const { id } = await criarDemanda(admin, {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      titulo: 'T',
      descricao: null,
      nivel: 'vai_sozinho',
      temTela: true,
      anexos: [],
    })
    const arquivoId = randomUUID()
    const envio = (bytes: number[], declarado: number | null) =>
      guardarArquivo({
        demandaId: id,
        arquivoId,
        tipo: 'captura',
        nome: 'tela.png',
        conteudo: 'image/png',
        tamanhoDeclarado: declarado,
        corpo: corpoDe(new Uint8Array(bytes)),
        tela: 'desktop',
        enviadoPor: 'fabrica',
      })
    expect((await envio([1, 2, 3], 3)).status).toBe(201)
    expect(await envio([1, 2, 3], 3)).toEqual({ status: 200, corpo: { id: arquivoId } })
    expect((await envio([1, 2, 3], null)).status).toBe(200)
    expect(await envio([1, 2, 3, 4], 4)).toEqual({
      status: 409,
      corpo: { erro: 'Arquivo com o mesmo id e conteúdo diferente.' },
    })
    expect(
      (
        await guardarArquivo({
          demandaId: id,
          arquivoId: randomUUID(),
          tipo: 'captura',
          nome: 'a.html',
          conteudo: 'text/html',
          tamanhoDeclarado: 3,
          corpo: corpoDe(new Uint8Array(3)),
          tela: 'desktop',
          enviadoPor: 'fabrica',
        })
      ).status,
    ).toBe(415)
    expect(await db.arquivoDaDemanda.count({ where: { demandaId: id } })).toBe(1)
  })

  test('guardarArquivo não segura transação nem trava enquanto lê o corpo', async () => {
    const { projeto, repositorio } = await cenario()
    const { id } = await criarDemanda(admin, {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      titulo: 'T',
      descricao: null,
      nivel: 'vai_sozinho',
      temTela: true,
      anexos: [],
    })
    let liberar!: () => void
    const solto = new Promise<void>((r) => (liberar = r))
    let avisar!: () => void
    const noMeio = new Promise<void>((r) => (avisar = r))
    let parte = 0
    const corpo = new ReadableStream<Uint8Array>({
      async pull(c) {
        parte += 1
        if (parte === 1) return c.enqueue(new Uint8Array(1024))
        if (parte === 2) {
          avisar()
          await solto
          return c.enqueue(new Uint8Array(1024))
        }
        c.close()
      },
    })
    const envio = guardarArquivo({
      demandaId: id,
      arquivoId: randomUUID(),
      tipo: 'captura',
      nome: 'tela.png',
      conteudo: 'image/png',
      tamanhoDeclarado: null,
      corpo,
      tela: 'desktop',
      enviadoPor: 'fabrica',
    })
    await noMeio
    try {
      const [emTransacao] = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_stat_activity
        WHERE datname = current_database() AND state LIKE 'idle in transaction%'`
      const [travas] = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory'`
      expect(Number(emTransacao!.n)).toBe(0)
      expect(Number(travas!.n)).toBe(0)
    } finally {
      liberar()
    }
    expect((await envio).status).toBe(201)
    const noDisco = await readdir(join(dir, 'demandas', id))
    expect(noDisco).toHaveLength(1)
    expect(noDisco[0]).not.toMatch(/\.parcial$/)
  })

  test('desenho_pronto citando um arquivo que já é versão → recusado "Este arquivo já é uma versão do desenho."', async () => {
    const id = await demandaNoDesenho()
    const v1 = await db.arquivoDaDemanda.findFirstOrThrow({ where: { demandaId: id } })
    await pedirAjuste(admin, id, 1, 'mais contraste')

    const r = await daFabrica(id, {
      tipo: 'desenho_pronto',
      ator: 'fabrica',
      dados: { arquivoId: v1.id },
    })
    expect(r).toEqual({
      resultado: 'recusado',
      motivo: 'Este arquivo já é uma versão do desenho.',
    })
    const d = await db.demanda.findUniqueOrThrow({ where: { id } })
    expect(d.versaoDoDesenho).toBe(1)
    expect((await db.arquivoDaDemanda.findUniqueOrThrow({ where: { id: v1.id } })).versao).toBe(1)
  })

  test('aba velha: aprovar a mesma versão duas vezes ao mesmo tempo → uma aprova, a outra é recusada; depois pedir ajuste dela é recusado', async () => {
    const id = await demandaNoDesenho()
    const rs = await Promise.allSettled([
      aprovarDesenho(admin, id, 1),
      aprovarDesenho(admin, id, 1),
    ])
    expect(rs.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const recusa = rs.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(recusa.reason).toBeInstanceOf(ErroDeDominio)
    await expect(pedirAjuste(admin, id, 1, 'tarde demais')).rejects.toBeInstanceOf(ErroDeDominio)

    expect(
      await db.eventoDaDemanda.count({ where: { demandaId: id, tipo: 'desenho_aprovado' } }),
    ).toBe(1)
    expect(
      await db.eventoDaDemanda.count({ where: { demandaId: id, tipo: 'ajuste_pedido' } }),
    ).toBe(0)
    const d = await db.demanda.findUniqueOrThrow({ where: { id } })
    expect(d).toMatchObject({ etapaAtual: 'desenvolvida', desenhoAprovado: 1, espera: null })
  })
})
