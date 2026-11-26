import { beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { obterQuadroDeErros } from '@/modules/erros/queries'
import { buscarErrosDoGlitchTip } from '@/modules/erros/service'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-11-26T15:30:00.000Z')
const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const BASE = 'https://erros.exemplo.com'
let env: Record<string, string>

beforeEach(async () => {
  await limparBanco()
  await sincronizarCatalogo(criarFonteFixtures(), agora)
  const repo = await db.repositorioGitHub.findFirstOrThrow()
  const projeto = await db.projeto.create({ data: { nome: 'P', nomeNormalizado: 'p' } })
  await db.repositorioGitHub.update({ where: { id: repo.id }, data: { projetoId: projeto.id } })
  env = {
    GLITCHTIP_URL: BASE,
    GLITCHTIP_ORG: 'minha-org',
    GLITCHTIP_TOKEN: 'tok',
    GLITCHTIP_PROJETOS: `app-vendas:${repo.nomeCompleto}`,
  }
})

describe('obterQuadroDeErros', () => {
  test('sem desenvolvimento.ler é recusado', async () => {
    const escopado: Sujeito = {
      usuarioId: 'u-cliente',
      papeis: [{ papel: 'APROVADOR', clienteId: 'cliente-a' }],
    }
    await expect(obterQuadroDeErros(escopado, agora, env)).rejects.toBeInstanceOf(ErroDeAutorizacao)
  })

  test('traz o erro lido com o estado da demanda e a leitura', async () => {
    await buscarErrosDoGlitchTip(agora, {
      env,
      buscar: async () =>
        new Response(
          JSON.stringify([
            {
              id: '17',
              title: 'TypeError: x',
              culprit: 'a.ts',
              level: 'error',
              status: 'unresolved',
              count: '48',
              userCount: 9,
              firstSeen: '2026-11-26T10:00:00.000Z',
              lastSeen: '2026-11-26T15:29:00.000Z',
              permalink: `${BASE}/minha-org/issues/17`,
            },
          ]),
          { status: 200 },
        ),
    })
    const demanda = await db.demanda.findFirstOrThrow()
    await db.demanda.update({
      where: { id: demanda.id },
      data: { etapaAtual: 'desenvolvida', prs: ['https://github.com/dono/app/pull/88'] },
    })

    const q = await obterQuadroDeErros(admin, new Date(agora.getTime() + 60_000), env)
    expect(q.configurado).toBe(true)
    expect(q.leitura).toMatchObject({ ultimoSucessoEm: agora, velha: false })
    expect(q.linhas).toHaveLength(1)
    expect(q.linhas[0]).toMatchObject({
      issueId: '17',
      estado: 'em_correcao',
      detalhe: 'desenvolvida · PR #88',
      eventos: 48,
      usuarios: 9,
      demandaId: demanda.id,
      link: `${BASE}/minha-org/issues/17`,
    })
  })

  test('não configurado', async () => {
    const q = await obterQuadroDeErros(admin, agora, {})
    expect(q).toMatchObject({ configurado: false, linhas: [] })
  })
})
