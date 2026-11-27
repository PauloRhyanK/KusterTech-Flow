import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { MODELO_PADRAO } from '@/modules/demandas/model'
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
