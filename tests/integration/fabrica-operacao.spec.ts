import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { MODELO_PADRAO } from '@/modules/demandas/model'
import {
  pedirTarefa,
  receberResultadoDoWorker,
  receberSinal,
} from '@/modules/fabrica-operacao/recepcao'
import { obterPainelDeOperacao } from '@/modules/fabrica-operacao/queries'
import { DURACAO_DA_RESERVA_MS } from '@/modules/fabrica-operacao/reserva'
import {
  autenticarWorker,
  criarWorker,
  pegarTarefa,
  receberResultado,
  registrarPlanoAprovado,
  revogarWorker,
  sinalizar,
  type EtapaDoPlano,
} from '@/modules/fabrica-operacao/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-27T15:00:00.000Z')
const depois = (ms: number) => new Date(AGORA.getTime() + ms)
const MIN = 60_000

let admin: Sujeito
let demandaId: string
let repositorioId: string
let w1: string
let w2: string
let token1: string

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-operacao@local.test',
    nome: 'Admin Operação',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  const projeto = await db.projeto.create({ data: { nome: 'Flow', nomeNormalizado: 'flow' } })
  repositorioId = (
    await db.repositorioGitHub.create({
      data: {
        githubId: BigInt(9101),
        instalacaoId: BigInt(1),
        nomeCompleto: 'exemplo/flow',
        urlHtml: 'https://github.com/exemplo/flow',
        privado: false,
        projetoId: projeto.id,
        vinculadoEm: AGORA,
        catalogadoEm: AGORA,
      } as never,
    })
  ).id
  demandaId = (
    await db.demanda.create({
      data: {
        projetoId: projeto.id,
        repositorioId,
        titulo: 'Piloto',
        nivel: 'VAI_SOZINHO',
        temTela: false,
        origem: 'FLOW',
        etapas: MODELO_PADRAO as never,
        etapaAtual: 'recebida',
      } as never,
    })
  ).id
  const criado1 = await criarWorker(admin, 'oficina-1')
  w1 = criado1.id
  token1 = criado1.token
  w2 = (await criarWorker(admin, 'oficina-2')).id
})

afterAll(async () => {
  await db.$disconnect()
})

const etapa = (chave: string, extra: Partial<EtapaDoPlano> = {}): EtapaDoPlano => ({
  chave,
  tipo: 'implementacao',
  papel: 'engenheiro',
  repositorioId,
  arquivos: [`src/${chave}/**`],
  dependeDe: [],
  prioridade: 0,
  ...extra,
})

async function plano(etapas: EtapaDoPlano[]) {
  return registrarPlanoAprovado(admin, { demandaId, conteudo: { objetivo: 'teste' }, etapas })
}

const estadoDa = async (chave: string) =>
  (await db.etapaOperacional.findFirstOrThrow({ where: { chave } })).estado

describe('workers', () => {
  test('token autentica; revogado deixa de autenticar', async () => {
    expect(await autenticarWorker(`Bearer ${token1}`)).toEqual({ id: w1 })
    expect(await autenticarWorker('Bearer fw_errado')).toBeNull()
    expect(await autenticarWorker(null)).toBeNull()
    await revogarWorker(admin, w1)
    expect(await autenticarWorker(`Bearer ${token1}`)).toBeNull()
  })
})

describe('plano aprovado', () => {
  test('cria revisão aprovada com hash, etapas e marca a demanda como v2', async () => {
    const { revisaoId } = await plano([etapa('a'), etapa('b', { dependeDe: ['a'] })])
    const revisao = await db.revisaoDoPlano.findUniqueOrThrow({ where: { id: revisaoId } })
    expect(revisao).toMatchObject({ numero: 1, aprovadaPorId: admin.usuarioId })
    expect(revisao.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(await db.etapaOperacional.count({ where: { revisaoId } })).toBe(2)
    expect((await db.demanda.findUniqueOrThrow({ where: { id: demandaId } })).motor).toBe('v2')
  })

  test('dependência inexistente é recusada', async () => {
    await expect(plano([etapa('a', { dependeDe: ['fantasma'] })])).rejects.toThrow(/fantasma/)
  })

  test('revisão sem aprovação não oferece trabalho', async () => {
    await plano([etapa('a')])
    await db.revisaoDoPlano.updateMany({ data: { aprovadaEm: null, aprovadaPorId: null } })
    expect(await pegarTarefa(w1, AGORA)).toBeNull()
  })
})

describe('pegarTarefa', () => {
  test('entrega a etapa elegível com reserva e geração 1', async () => {
    await plano([etapa('a')])
    const t = await pegarTarefa(w1, AGORA)
    expect(t).toMatchObject({
      tipo: 'executar',
      geracao: 1,
      papel: 'engenheiro',
      repo: 'exemplo/flow',
      prUrl: null,
      expiraEm: depois(DURACAO_DA_RESERVA_MS).toISOString(),
    })
    expect(await estadoDa('a')).toBe('executando')
    expect(await pegarTarefa(w2, AGORA)).toBeNull()
  })

  test('dois workers ao mesmo tempo nunca levam a mesma etapa', async () => {
    await plano([etapa('a')])
    const [x, y] = await Promise.all([pegarTarefa(w1, AGORA), pegarTarefa(w2, AGORA)])
    expect([x, y].filter((t) => t !== null)).toHaveLength(1)
    expect(await db.execucaoOperacional.count()).toBe(1)
  })

  test('dependente só sai depois de a dependência terminar', async () => {
    await plano([etapa('a', { tipo: 'leitura' }), etapa('b', { dependeDe: ['a'] })])
    const t = await pegarTarefa(w1, AGORA)
    expect(await pegarTarefa(w2, AGORA)).toBeNull()
    await receberResultado(
      w1,
      { idExterno: 'r1', execucaoId: t!.execucaoId, geracao: 1, resultado: { tipo: 'sem_pr' } },
      AGORA,
    )
    expect(await estadoDa('a')).toBe('concluida')
    expect((await pegarTarefa(w2, AGORA))?.etapaId).toBe(
      (await db.etapaOperacional.findFirstOrThrow({ where: { chave: 'b' } })).id,
    )
  })

  test('colisão de arquivos com etapa em execução segura a candidata', async () => {
    await plano([etapa('a', { arquivos: ['src/**'] }), etapa('b', { arquivos: ['src/b.ts'] })])
    expect(await pegarTarefa(w1, AGORA)).not.toBeNull()
    expect(await pegarTarefa(w2, AGORA)).toBeNull()
  })

  test('etapa em recuo não é oferecida antes da hora', async () => {
    await plano([etapa('a')])
    const t = await pegarTarefa(w1, AGORA)
    await receberResultado(
      w1,
      {
        idExterno: 'r1',
        execucaoId: t!.execucaoId,
        geracao: 1,
        resultado: { tipo: 'falha_tecnica', motivo: 'rede' },
      },
      AGORA,
    )
    expect(await pegarTarefa(w1, depois(4 * MIN))).toBeNull()
    expect(await pegarTarefa(w1, depois(5 * MIN))).toMatchObject({ tipo: 'executar' })
  })

  test('worker pausado não recebe tarefa', async () => {
    await plano([etapa('a')])
    await db.workerDaFabrica.update({ where: { id: w1 }, data: { pausado: true } })
    expect(await pegarTarefa(w1, AGORA)).toBeNull()
  })
})

describe('reserva vencida', () => {
  test('outro worker recebe a mesma execução para reconciliar; o envio antigo é obsoleto', async () => {
    await plano([etapa('a')])
    const t1 = await pegarTarefa(w1, AGORA)
    const tarde = depois(DURACAO_DA_RESERVA_MS + 1)
    const t2 = await pegarTarefa(w2, tarde)
    expect(t2).toMatchObject({ tipo: 'reconciliar', execucaoId: t1!.execucaoId, geracao: 2 })
    expect(await sinalizar(w1, t1!.execucaoId, 1, tarde)).toBe('obsoleto')
    expect(
      await receberResultado(
        w1,
        {
          idExterno: 'velho',
          execucaoId: t1!.execucaoId,
          geracao: 1,
          resultado: { tipo: 'sem_pr' },
        },
        tarde,
      ),
    ).toBe('obsoleto')
    expect(await estadoDa('a')).toBe('executando')
  })

  test('sinal renova a reserva e impede a reatribuição', async () => {
    await plano([etapa('a')])
    const t = await pegarTarefa(w1, AGORA)
    expect(await sinalizar(w1, t!.execucaoId, 1, depois(60_000))).toBe('renovado')
    expect(await pegarTarefa(w2, depois(DURACAO_DA_RESERVA_MS + 1))).toBeNull()
  })
})

describe('receberResultado', () => {
  test('PR aberto vai aos gates e libera a vaga', async () => {
    await plano([etapa('a')])
    const t = await pegarTarefa(w1, AGORA)
    const envio = {
      idExterno: 'r1',
      execucaoId: t!.execucaoId,
      geracao: 1,
      resultado: { tipo: 'pr_aberto' as const, prUrl: 'https://github.com/exemplo/flow/pull/7' },
    }
    expect(await receberResultado(w1, envio, AGORA)).toBe('aplicado')
    const e = await db.etapaOperacional.findFirstOrThrow({ where: { chave: 'a' } })
    expect(e).toMatchObject({ estado: 'aguardando_gates', prUrl: envio.resultado.prUrl })
    const ex = await db.execucaoOperacional.findUniqueOrThrow({ where: { id: t!.execucaoId } })
    expect(ex.encerradaEm).not.toBeNull()
  })

  test('mesmo idExterno e conteúdo é repetido; conteúdo diferente é conflito', async () => {
    await plano([etapa('a')])
    const t = await pegarTarefa(w1, AGORA)
    const base = { idExterno: 'r1', execucaoId: t!.execucaoId, geracao: 1 }
    const falha = { tipo: 'falha_tecnica' as const, motivo: 'rede' }
    expect(await receberResultado(w1, { ...base, resultado: falha }, AGORA)).toBe('aplicado')
    expect(await receberResultado(w1, { ...base, resultado: falha }, AGORA)).toBe('repetido')
    expect(await receberResultado(w1, { ...base, resultado: { tipo: 'sem_pr' } }, AGORA)).toBe(
      'conflito',
    )
    const e = await db.etapaOperacional.findFirstOrThrow({ where: { chave: 'a' } })
    expect(e.falhasTecnicas).toBe(1)
    expect(await db.eventoOperacional.count()).toBe(1)
  })

  test('resultado incerto mantém a execução aberta para reconciliar', async () => {
    await plano([etapa('a')])
    const t = await pegarTarefa(w1, AGORA)
    await receberResultado(
      w1,
      { idExterno: 'r1', execucaoId: t!.execucaoId, geracao: 1, resultado: { tipo: 'incerto' } },
      AGORA,
    )
    const ex = await db.execucaoOperacional.findUniqueOrThrow({ where: { id: t!.execucaoId } })
    expect(ex.encerradaEm).toBeNull()
    expect(await estadoDa('a')).toBe('executando')
  })

  test('outro worker não pode enviar resultado da execução', async () => {
    await plano([etapa('a')])
    const t = await pegarTarefa(w1, AGORA)
    expect(
      await receberResultado(
        w2,
        { idExterno: 'r1', execucaoId: t!.execucaoId, geracao: 1, resultado: { tipo: 'sem_pr' } },
        AGORA,
      ),
    ).toBe('obsoleto')
  })
})

describe('recepção HTTP do worker', () => {
  const entrada = (corpo: unknown, o: { auth?: string | null; tipo?: string } = {}) => {
    const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
    return {
      authorization: o.auth === undefined ? `Bearer ${token1}` : o.auth,
      contentType: o.tipo ?? 'application/json',
      contentLength: String(Buffer.byteLength(texto)),
      corpo: async () => texto,
    }
  }

  test('sem token é 401; sem trabalho devolve tarefa nula', async () => {
    expect((await pedirTarefa(null, AGORA)).status).toBe(401)
    expect(await pedirTarefa(`Bearer ${token1}`, AGORA)).toEqual({
      status: 200,
      corpo: { tarefa: null },
    })
  })

  test('fluxo completo: pede, sinaliza, envia; reenvio é repetido', async () => {
    await plano([etapa('a')])
    const { corpo } = await pedirTarefa(`Bearer ${token1}`, AGORA)
    const tarefa = (corpo as { tarefa: { execucaoId: string } }).tarefa
    expect((await receberSinal(tarefa.execucaoId, entrada({ geracao: 1 }), AGORA)).status).toBe(200)
    const envio = {
      idExterno: 'r1',
      geracao: 1,
      resultado: { tipo: 'pr_aberto', prUrl: 'https://github.com/exemplo/flow/pull/7' },
    }
    expect(await receberResultadoDoWorker(tarefa.execucaoId, entrada(envio), AGORA)).toEqual({
      status: 200,
      corpo: { resultado: 'aplicado' },
    })
    expect(await receberResultadoDoWorker(tarefa.execucaoId, entrada(envio), AGORA)).toEqual({
      status: 200,
      corpo: { resultado: 'repetido' },
    })
    const conflito = { ...envio, resultado: { tipo: 'sem_pr' } }
    expect(
      (await receberResultadoDoWorker(tarefa.execucaoId, entrada(conflito), AGORA)).status,
    ).toBe(409)
    // a execução encerrou: o sinal agora é obsoleto e o worker deve parar
    expect((await receberSinal(tarefa.execucaoId, entrada({ geracao: 1 }), AGORA)).status).toBe(409)
  })

  test.each([
    ['não é JSON', '{', 'application/json', 422],
    [
      'tipo desconhecido',
      { idExterno: 'x', geracao: 1, resultado: { tipo: 'talvez' } },
      'application/json',
      422,
    ],
    [
      'geração zero',
      { idExterno: 'x', geracao: 0, resultado: { tipo: 'sem_pr' } },
      'application/json',
      422,
    ],
    [
      'campo a mais',
      { idExterno: 'x', geracao: 1, resultado: { tipo: 'sem_pr', x: 1 } },
      'application/json',
      422,
    ],
    [
      'content-type errado',
      { idExterno: 'x', geracao: 1, resultado: { tipo: 'sem_pr' } },
      'text/plain',
      415,
    ],
  ])('%s é recusado', async (_, corpo, tipo, status) => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect((await receberResultadoDoWorker(id, entrada(corpo, { tipo }), AGORA)).status).toBe(
      status,
    )
  })

  test('id que não é UUID é 404; token de fonte (ff_) não serve', async () => {
    const ok = { idExterno: 'x', geracao: 1, resultado: { tipo: 'sem_pr' } }
    expect((await receberResultadoDoWorker('abc', entrada(ok), AGORA)).status).toBe(404)
    expect(
      (await receberResultadoDoWorker('abc', entrada(ok, { auth: 'Bearer ff_qualquer' }), AGORA))
        .status,
    ).toBe(401)
  })
})

describe('achados da revisão independente', () => {
  test('execução encerrada com reserva vencida nunca é reatribuída', async () => {
    await plano([etapa('a')])
    const t = await pegarTarefa(w1, AGORA)
    await db.execucaoOperacional.update({
      where: { id: t!.execucaoId },
      data: { encerradaEm: AGORA, reservaExpiraEm: AGORA },
    })
    expect(await pegarTarefa(w2, depois(DURACAO_DA_RESERVA_MS + 1))).toBeNull()
  })

  test('etapa de revisão superada que ainda ocupa arquivos segura a nova revisão', async () => {
    await plano([etapa('a', { arquivos: ['src/x/**'] })])
    expect(await pegarTarefa(w1, AGORA)).not.toBeNull()
    await plano([etapa('b', { arquivos: ['src/x/y.ts'] })])
    expect(await pegarTarefa(w2, AGORA)).toBeNull()
  })

  test('reenvio simultâneo do mesmo resultado: um aplicado e um repetido', async () => {
    await plano([etapa('a')])
    const t = await pegarTarefa(w1, AGORA)
    const envio = {
      idExterno: 'r1',
      execucaoId: t!.execucaoId,
      geracao: 1,
      resultado: { tipo: 'incerto' as const },
    }
    const r = await Promise.all([
      receberResultado(w1, envio, AGORA),
      receberResultado(w1, envio, AGORA),
    ])
    expect([...r].sort()).toEqual(['aplicado', 'repetido'])
  })

  test('plano com ciclo é recusado', async () => {
    await expect(
      plano([etapa('a', { dependeDe: ['b'] }), etapa('b', { dependeDe: ['a'] })]),
    ).rejects.toThrow(/ciclo/)
  })

  test('repositório de outro projeto é recusado', async () => {
    const outro = await db.repositorioGitHub.create({
      data: {
        githubId: BigInt(9102),
        instalacaoId: BigInt(1),
        nomeCompleto: 'exemplo/outro',
        urlHtml: 'https://github.com/exemplo/outro',
        privado: false,
        catalogadoEm: AGORA,
      } as never,
    })
    await expect(plano([etapa('a', { repositorioId: outro.id })])).rejects.toThrow(/projeto/)
  })

  test('reconciliação que nunca termina bloqueia a etapa', async () => {
    await plano([etapa('a')])
    let instante = AGORA
    let t = await pegarTarefa(w1, instante)
    for (let i = 0; i < 10 && t !== null; i++) {
      instante = new Date(instante.getTime() + DURACAO_DA_RESERVA_MS + 1)
      t = await pegarTarefa(i % 2 ? w1 : w2, instante)
    }
    const e = await db.etapaOperacional.findFirstOrThrow({ where: { chave: 'a' } })
    expect(e.estado).toBe('bloqueada')
    expect(e.motivo).toMatch(/reconcilia/)
    expect(await db.execucaoOperacional.count({ where: { encerradaEm: null } })).toBe(0)
  })

  test('prUrl que não é PR do GitHub é recusado na recepção', async () => {
    const corpo = JSON.stringify({
      idExterno: 'x',
      geracao: 1,
      resultado: { tipo: 'pr_aberto', prUrl: 'javascript:alert(1)' },
    })
    const r = await receberResultadoDoWorker(
      '11111111-1111-4111-8111-111111111111',
      {
        authorization: `Bearer ${token1}`,
        contentType: 'application/json',
        contentLength: String(corpo.length),
        corpo: async () => corpo,
      },
      AGORA,
    )
    expect(r.status).toBe(422)
  })
})

describe('painel da operação', () => {
  test('reflete a etapa em execução e a máquina ocupada', async () => {
    await plano([
      etapa('a', { papel: 'revisor', tipo: 'leitura' }),
      etapa('b', { dependeDe: ['a'] }),
    ])
    await pegarTarefa(w1, AGORA)
    const p = await obterPainelDeOperacao(admin, depois(6 * MIN))
    expect(p.situacao.tipo).toBe('andando')
    expect(p.emAndamento[0]).toMatchObject({
      titulo: 'Piloto',
      cor: 'conferindo',
      agora: { texto: 'Revisor conferindo o código', desde: 'há 6 min' },
    })
    expect(p.maquinas.find((m) => m.nome === 'oficina-1')).toMatchObject({
      estado: 'sem_sinal',
    })
  })

  test('sem permissão é recusado', async () => {
    await expect(
      obterPainelDeOperacao({ usuarioId: admin.usuarioId, papeis: [] }, AGORA),
    ).rejects.toThrow()
  })
})
