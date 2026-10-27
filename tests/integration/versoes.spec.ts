import { beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { sincronizarDeployments } from '@/modules/ambientes/deployments'
import { listarVersoesDoProjeto, registrarDeployManual } from '@/modules/ambientes/service'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { limparBanco } from './banco-de-teste'

const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const t0 = new Date('2026-10-27T12:00:00.000Z')
const SHA_V2 = `1${'e'.repeat(39)}`
const SEM_FILTRO = { repositorioId: null }

async function prepararProjeto(comAmbientes = true) {
  const fonte = criarFonteFixtures()
  await sincronizarCatalogo(fonte, t0)
  const projeto = await db.projeto.create({ data: { nome: 'Portal', nomeNormalizado: 'portal' } })
  const repos: Record<'portal' | 'api', string> = { portal: '', api: '' }
  for (const nome of ['portal', 'api'] as const) {
    const repo = await db.repositorioGitHub.findFirstOrThrow({
      where: { nomeCompleto: `kustertech-exemplo/${nome}` },
    })
    await db.repositorioGitHub.update({
      where: { id: repo.id },
      data: { projetoId: projeto.id, vinculadoEm: t0 },
    })
    await sincronizarRepositorio(fonte, repo.id, t0)
    repos[nome] = repo.id
  }
  if (comAmbientes) {
    await db.ambiente.createMany({
      data: [
        { projetoId: projeto.id, tipo: 'DEV', nomeNoGitHub: 'dev' },
        { projetoId: projeto.id, tipo: 'QA', nomeNoGitHub: 'qa' },
        { projetoId: projeto.id, tipo: 'PROD', nomeNoGitHub: 'production' },
      ],
    })
  }
  return { fonte, projeto, repos }
}

beforeEach(async () => {
  await limparBanco()
  await db.usuario.create({
    data: { id: admin.usuarioId, email: 'admin@local.test', nome: 'Admin', senhaHash: 'x' },
  })
})

describe('versões do projeto (integração)', () => {
  test('registrarDeployManual: SHA de 39 → mensagem do SHA; repositório de outro projeto → "Repositório não vinculado a este projeto."; ambiente não salvo → "Configure o ambiente antes de registrar um deploy."; amanhã → "A data do deploy não pode estar no futuro."', async () => {
    const { projeto, repos } = await prepararProjeto(false)
    const agora = new Date('2026-10-27T12:00:00Z')
    const dados = {
      tipo: 'QA' as const,
      repositorioId: repos.portal,
      commitSha: SHA_V2,
      rotulo: '',
      ocorridaEm: null,
    }

    await expect(registrarDeployManual(admin, projeto.id, dados, agora)).rejects.toThrow(
      'Configure o ambiente antes de registrar um deploy.',
    )

    await db.ambiente.create({ data: { projetoId: projeto.id, tipo: 'QA', nomeNoGitHub: 'qa' } })
    await expect(
      registrarDeployManual(admin, projeto.id, { ...dados, commitSha: 'a'.repeat(39) }, agora),
    ).rejects.toThrow('Informe o SHA completo do commit (40 caracteres hexadecimais).')

    const outro = await db.projeto.create({ data: { nome: 'Outro', nomeNormalizado: 'outro' } })
    const alheio = await db.repositorioGitHub.findFirstOrThrow({
      where: { nomeCompleto: 'kustertech-exemplo/site' },
    })
    await db.repositorioGitHub.update({ where: { id: alheio.id }, data: { projetoId: outro.id } })
    await expect(
      registrarDeployManual(admin, projeto.id, { ...dados, repositorioId: alheio.id }, agora),
    ).rejects.toThrow('Repositório não vinculado a este projeto.')

    const amanha = new Date(agora.getTime() + 86_400_000)
    await expect(
      registrarDeployManual(admin, projeto.id, { ...dados, ocorridaEm: amanha }, agora),
    ).rejects.toThrow('A data do deploy não pode estar no futuro.')

    await db.projeto.update({ where: { id: projeto.id }, data: { arquivadoEm: agora } })
    await expect(registrarDeployManual(admin, projeto.id, dados, agora)).rejects.toThrow(
      'Projeto arquivado não recebe evidências.',
    )
    expect(await db.versao.count({ where: { projetoId: projeto.id, rotulo: 'v1.4.0' } })).toBe(0)
    expect(await db.evidenciaDeploy.count()).toBe(0)
  })

  test('registrarDeployManual válido (QA, portal, V2, "3.8.0") cria Versao "3.8.0" e evidência MANUAL SUCESSO com autorId; de novo com o mesmo SHA: 1 versão e 2 evidências', async () => {
    const { projeto, repos } = await prepararProjeto()
    const agora = new Date('2026-10-27T12:00:00Z')
    const dados = {
      tipo: 'QA' as const,
      repositorioId: repos.portal,
      commitSha: SHA_V2.toUpperCase(),
      rotulo: ' 3.8.0 ',
      ocorridaEm: null,
    }

    await registrarDeployManual(admin, projeto.id, dados, agora)

    const versoes = await db.versao.findMany({ where: { commitSha: SHA_V2 } })
    expect(versoes).toHaveLength(1)
    expect(versoes[0]?.rotulo).toBe('3.8.0')
    const [evidencia] = await db.evidenciaDeploy.findMany({ where: { versaoId: versoes[0]!.id } })
    expect(evidencia).toMatchObject({
      origem: 'MANUAL',
      situacao: 'SUCESSO',
      autorId: admin.usuarioId,
      idExterno: null,
    })
    expect(evidencia?.ocorridaEm).toEqual(agora)

    await registrarDeployManual(
      admin,
      projeto.id,
      { ...dados, rotulo: 'outro', ocorridaEm: new Date('2026-10-27T11:00:00Z') },
      agora,
    )
    expect(await db.versao.count({ where: { commitSha: SHA_V2 } })).toBe(1)
    expect(await db.evidenciaDeploy.count({ where: { versaoId: versoes[0]!.id } })).toBe(2)
    expect((await db.versao.findUniqueOrThrow({ where: { id: versoes[0]!.id } })).rotulo).toBe(
      '3.8.0',
    )
  })

  test('listarVersoesDoProjeto com fixtures (portal e api, dev/qa/production): 6 versões; QA de portal vigente v1.4.0 GitHub Deployments com ultimoDeploy FALHA "1ffffff"; PROD de api vigente v1.3.0', async () => {
    const { fonte, projeto, repos } = await prepararProjeto()
    await sincronizarDeployments(fonte, t0, 600_000)

    const tela = await listarVersoesDoProjeto(admin, projeto.id, SEM_FILTRO)

    expect(tela.ambientesConfigurados).toEqual(['DEV', 'QA', 'PROD'])
    expect(tela.total).toBe(6)
    expect(tela.versoes).toHaveLength(6)
    expect(tela.repositorios.map((r) => r.nomeCompleto)).toEqual([
      'kustertech-exemplo/api',
      'kustertech-exemplo/portal',
    ])
    expect(tela.leituras).toHaveLength(2)

    const qaPortal = tela.situacoes.find(
      (s) => s.tipo === 'QA' && s.repositorio === 'kustertech-exemplo/portal',
    )
    expect(qaPortal?.vigente).toMatchObject({
      rotulo: 'v1.4.0',
      commitCurto: '1eeeeee',
      origem: 'GITHUB_DEPLOYMENT',
      autor: null,
    })
    expect(qaPortal?.ultimoDeploy).toMatchObject({ situacao: 'FALHA', rotulo: '1ffffff' })
    const prodApi = tela.situacoes.find(
      (s) => s.tipo === 'PROD' && s.repositorio === 'kustertech-exemplo/api',
    )
    expect(prodApi?.vigente?.rotulo).toBe('v1.3.0')
    expect(prodApi?.ultimoDeploy).toBeNull()
    expect(tela.situacoes).toHaveLength(6)

    // Ordem pela última evidência (decrescente) e filtro por repositório.
    const datas = tela.versoes.map((v) => v.ultimaEvidencia.ocorridaEm.getTime())
    expect(datas).toEqual([...datas].sort((a, b) => b - a))
    const v14 = tela.versoes.find(
      (v) => v.repositorio === 'kustertech-exemplo/portal' && v.rotulo === 'v1.4.0',
    )
    expect(v14?.vigenteEm).toEqual(['DEV', 'QA'])

    const soPortal = await listarVersoesDoProjeto(admin, projeto.id, {
      repositorioId: repos.portal,
    })
    expect(soPortal.total).toBe(3)
    expect(soPortal.situacoes).toHaveLength(3)
  })

  test('deploy manual: vigente com origem "MANUAL" e nome do autor; deploy antigo registrado depois não substitui a vigente', async () => {
    const { projeto, repos } = await prepararProjeto()
    const agora = new Date('2026-10-27T12:00:00Z')
    await registrarDeployManual(
      admin,
      projeto.id,
      { tipo: 'DEV', repositorioId: repos.portal, commitSha: SHA_V2, rotulo: '', ocorridaEm: null },
      agora,
    )
    await registrarDeployManual(
      admin,
      projeto.id,
      {
        tipo: 'DEV',
        repositorioId: repos.portal,
        commitSha: `1${'d'.repeat(39)}`,
        rotulo: 'velha',
        ocorridaEm: new Date('2026-10-01T10:00:00Z'),
      },
      new Date('2026-10-27T12:01:00Z'),
    )

    const tela = await listarVersoesDoProjeto(admin, projeto.id, SEM_FILTRO)

    const devPortal = tela.situacoes.find(
      (s) => s.tipo === 'DEV' && s.repositorio === 'kustertech-exemplo/portal',
    )
    expect(devPortal?.vigente).toMatchObject({
      rotulo: '1eeeeee',
      origem: 'MANUAL',
      autor: 'Admin',
    })
    expect(devPortal?.ultimoDeploy).toBeNull()
    const devApi = tela.situacoes.find(
      (s) => s.tipo === 'DEV' && s.repositorio === 'kustertech-exemplo/api',
    )
    expect(devApi?.vigente).toBeNull()
  })

  test('listarVersoesDoProjeto sem ambientes: lista vazia de configurados; repositório desvinculado some', async () => {
    const { projeto, repos } = await prepararProjeto(false)
    expect(
      (await listarVersoesDoProjeto(admin, projeto.id, SEM_FILTRO)).ambientesConfigurados,
    ).toEqual([])

    await db.ambiente.create({ data: { projetoId: projeto.id, tipo: 'QA', nomeNoGitHub: 'qa' } })
    await registrarDeployManual(
      admin,
      projeto.id,
      {
        tipo: 'QA',
        repositorioId: repos.api,
        commitSha: `2${'e'.repeat(39)}`,
        rotulo: '',
        ocorridaEm: null,
      },
      t0,
    )
    await db.repositorioGitHub.update({ where: { id: repos.api }, data: { projetoId: null } })
    const tela = await listarVersoesDoProjeto(admin, projeto.id, SEM_FILTRO)
    expect(tela.versoes).toHaveLength(0)
    expect(tela.total).toBe(0)
  })
})
