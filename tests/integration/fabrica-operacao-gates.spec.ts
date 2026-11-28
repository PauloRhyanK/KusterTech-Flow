import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { MODELO_PADRAO } from '@/modules/demandas/model'
import { avaliarEtapasEmGates } from '@/modules/fabrica-operacao/avaliador'
import { registrarPlanoAprovado } from '@/modules/fabrica-operacao/service'
import type { FonteGitHub, PullRequestParaMerge, ResultadoDoMerge } from '@/modules/github/fonte'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-28T15:00:00.000Z')
const SHA = 'a'.repeat(40)
const NOVO = 'c'.repeat(40)
const PR_URL = 'https://github.com/exemplo/flow/pull/7'

let admin: Sujeito
let etapaId: string

class FonteFalsa {
  pr: PullRequestParaMerge | null = {
    repositorio: 'exemplo/flow',
    estado: 'ABERTO',
    head: SHA,
    base: 'main',
    arquivos: ['src/a.ts'],
    urlHtml: PR_URL,
  }
  checks: { status: string; conclusao: string | null }[] = []
  merge: ResultadoDoMerge = { resultado: 'mergeado' }
  merges: { numero: number; head: string }[] = []
  async lerPullRequestParaMerge() {
    return this.pr
  }
  async listarChecks() {
    return this.checks
  }
  async lerStatusCombinado() {
    return null
  }
  async mergearPullRequest(_ref: unknown, numero: number, head: string) {
    this.merges.push({ numero, head })
    return this.merge
  }
}

const fonte = () => new FonteFalsa()
const como = (f: FonteFalsa) => f as unknown as FonteGitHub

beforeEach(async () => {
  await limparBanco()
  const u = await criarUsuario({
    email: 'admin-gates@local.test',
    nome: 'Admin Gates',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: u.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  const projeto = await db.projeto.create({ data: { nome: 'Flow', nomeNormalizado: 'flow' } })
  const repo = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(9201),
      instalacaoId: BigInt(1),
      nomeCompleto: 'exemplo/flow',
      urlHtml: 'https://github.com/exemplo/flow',
      privado: false,
      projetoId: projeto.id,
      vinculadoEm: AGORA,
      catalogadoEm: AGORA,
    } as never,
  })
  const demanda = await db.demanda.create({
    data: {
      projetoId: projeto.id,
      repositorioId: repo.id,
      titulo: 'Piloto',
      nivel: 'VAI_SOZINHO',
      temTela: false,
      origem: 'FLOW',
      etapas: MODELO_PADRAO as never,
      etapaAtual: 'recebida',
    } as never,
  })
  await registrarPlanoAprovado(admin, {
    demandaId: demanda.id,
    conteudo: { o: 1 },
    etapas: [
      {
        chave: 'a',
        tipo: 'implementacao',
        papel: 'engenheiro',
        instrucoes: 'Faça a.',
        verificacao: 'pnpm test',
        repositorioId: repo.id,
        arquivos: ['src/**'],
        dependeDe: [],
        prioridade: 0,
      },
    ],
  })
  etapaId = (
    await db.etapaOperacional.update({
      where: {
        revisaoId_chave: { revisaoId: (await db.revisaoDoPlano.findFirstOrThrow()).id, chave: 'a' },
      },
      data: { estado: 'aguardando_gates', prUrl: PR_URL, headSha: SHA },
    })
  ).id
})

afterAll(async () => {
  await db.$disconnect()
})

async function evidencias(
  verificacao: number | null,
  revisao: 'aprovado' | 'correcoes' | null,
  sha = SHA,
) {
  if (verificacao !== null) {
    await db.evidenciaDaEtapa.create({
      data: { etapaId, tipo: 'verificacao', sha, dados: { codigo: verificacao } },
    })
  }
  if (revisao !== null) {
    await db.evidenciaDaEtapa.create({
      data: {
        etapaId,
        tipo: 'revisao',
        sha,
        dados: { resultado: revisao, achados: [{ arquivo: 'src/a.ts', motivo: 'falta teste' }] },
      },
    })
  }
}

const etapa = () => db.etapaOperacional.findUniqueOrThrow({ where: { id: etapaId } })

describe('avaliarEtapasEmGates', () => {
  test('sem fonte do GitHub não faz nada', async () => {
    expect(await avaliarEtapasEmGates(null, AGORA)).toEqual({ avaliadas: 0, mergeadas: 0 })
  })

  test('faltando evidência aguarda sem mergear', async () => {
    const f = fonte()
    await evidencias(0, null)
    await avaliarEtapasEmGates(como(f), AGORA)
    expect(f.merges).toEqual([])
    expect((await etapa()).estado).toBe('aguardando_gates')
  })

  test('tudo verde mergeia pelo SHA e confirma a etapa', async () => {
    const f = fonte()
    await evidencias(0, 'aprovado')
    expect(await avaliarEtapasEmGates(como(f), AGORA)).toEqual({ avaliadas: 1, mergeadas: 1 })
    expect(f.merges).toEqual([{ numero: 7, head: SHA }])
    expect((await etapa()).estado).toBe('mergeada')
    expect(await db.eventoOperacional.count({ where: { tipo: 'gate_mergeado' } })).toBe(1)
  })

  test('head novo grava o SHA e não usa evidência antiga', async () => {
    const f = fonte()
    f.pr!.head = NOVO
    await evidencias(0, 'aprovado')
    await avaliarEtapasEmGates(como(f), AGORA)
    expect(f.merges).toEqual([])
    expect((await etapa()).headSha).toBe(NOVO)
  })

  test('GitHub diz que o head mudou: espera o próximo ciclo', async () => {
    const f = fonte()
    f.merge = { resultado: 'recusado', motivo: 'head_mudou' }
    await evidencias(0, 'aprovado')
    await avaliarEtapasEmGates(como(f), AGORA)
    expect((await etapa()).estado).toBe('aguardando_gates')
  })

  test('conflito com a base bloqueia com motivo claro', async () => {
    const f = fonte()
    f.merge = { resultado: 'recusado', motivo: 'nao_mergeavel' }
    await evidencias(0, 'aprovado')
    await avaliarEtapasEmGates(como(f), AGORA)
    expect(await etapa()).toMatchObject({
      estado: 'bloqueada',
      motivo: expect.stringMatching(/recusou o merge/),
    })
  })

  test('PR mergeado fora confirma; PR fechado bloqueia; PR sumido bloqueia', async () => {
    const f = fonte()
    f.pr!.estado = 'MERGEADO'
    await avaliarEtapasEmGates(como(f), AGORA)
    expect((await etapa()).estado).toBe('mergeada')
    expect(f.merges).toEqual([])

    await db.etapaOperacional.update({
      where: { id: etapaId },
      data: { estado: 'aguardando_gates' },
    })
    f.pr!.estado = 'FECHADO'
    f.pr!.head = NOVO
    await avaliarEtapasEmGates(como(f), AGORA)
    expect(await etapa()).toMatchObject({
      estado: 'bloqueada',
      motivo: 'o PR foi fechado sem merge',
    })

    await db.etapaOperacional.update({
      where: { id: etapaId },
      data: { estado: 'aguardando_gates' },
    })
    f.pr = null
    await avaliarEtapasEmGates(como(f), AGORA)
    expect((await etapa()).estado).toBe('bloqueada')
  })

  test('verificação vermelha volta para correção, e repetir o ciclo na mesma rodada não soma de novo', async () => {
    const f = fonte()
    await evidencias(1, null)
    await avaliarEtapasEmGates(como(f), AGORA)
    expect(await etapa()).toMatchObject({
      estado: 'pendente',
      correcoes: 1,
      motivo: 'verificação falhou (código 1)',
      pedidoDeCorrecao: 'verificação falhou (código 1)',
    })
    await avaliarEtapasEmGates(como(f), AGORA)
    expect((await etapa()).correcoes).toBe(1)
  })

  test('revisão pede correções com os achados', async () => {
    const f = fonte()
    await evidencias(0, 'correcoes')
    await avaliarEtapasEmGates(como(f), AGORA)
    expect(await etapa()).toMatchObject({
      estado: 'pendente',
      motivo: 'revisão pediu correções: src/a.ts: falta teste',
    })
  })

  test('arquivo protegido vai para você', async () => {
    const f = fonte()
    f.pr!.arquivos = ['src/a.ts', '.env.production']
    await evidencias(0, 'aprovado')
    await avaliarEtapasEmGates(como(f), AGORA)
    expect(f.merges).toEqual([])
    expect(await etapa()).toMatchObject({
      estado: 'bloqueada',
      motivo: expect.stringMatching(/\.env\.production/),
    })
  })

  test('CI vermelho corrige mesmo com verificação e revisão verdes', async () => {
    const f = fonte()
    f.checks = [{ status: 'completed', conclusao: 'failure' }]
    await evidencias(0, 'aprovado')
    await avaliarEtapasEmGates(como(f), AGORA)
    expect(await etapa()).toMatchObject({ estado: 'pendente', motivo: 'CI vermelho' })
  })

  test('PR de outro repositório bloqueia', async () => {
    await db.etapaOperacional.update({
      where: { id: etapaId },
      data: { prUrl: 'https://github.com/outro/repo/pull/7' },
    })
    await avaliarEtapasEmGates(como(fonte()), AGORA)
    expect((await etapa()).estado).toBe('bloqueada')
  })

  test('volta aos gates no mesmo head depois de uma correção: decide de novo e escala no teto', async () => {
    const f = fonte()
    await evidencias(1, null)
    for (let rodada = 1; rodada <= 3; rodada++) {
      await avaliarEtapasEmGates(como(f), AGORA)
      if (rodada < 3) {
        expect(await etapa()).toMatchObject({ estado: 'pendente', correcoes: rodada })
        // a correção reconciliou sem push: o PR continua no mesmo head
        await db.etapaOperacional.update({
          where: { id: etapaId },
          data: { estado: 'aguardando_gates' },
        })
      }
    }
    expect(await etapa()).toMatchObject({
      estado: 'bloqueada',
      motivo: expect.stringMatching(/^escalar/),
    })
  })

  test('PR sumido bloqueia mesmo antes de existir head gravado', async () => {
    await db.etapaOperacional.update({ where: { id: etapaId }, data: { headSha: null } })
    const f = fonte()
    f.pr = null
    await avaliarEtapasEmGates(como(f), AGORA)
    expect(await etapa()).toMatchObject({
      estado: 'bloqueada',
      motivo: 'o PR não foi encontrado no GitHub',
    })
  })

  test('o pedido de correção fica guardado à parte do motivo', async () => {
    const f = fonte()
    await evidencias(0, 'correcoes')
    await avaliarEtapasEmGates(como(f), AGORA)
    await db.etapaOperacional.update({
      where: { id: etapaId },
      data: { motivo: 'execução terminou sem PR' },
    })
    expect((await etapa()).pedidoDeCorrecao).toBe('revisão pediu correções: src/a.ts: falta teste')
  })
})
