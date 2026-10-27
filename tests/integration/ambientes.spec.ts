import { beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { formatoDeTokenValido, hashDoTokenDeEvidencia } from '@/modules/ambientes/model'
import {
  contarAmbientesPorProjeto,
  gerarTokenDeEvidencia,
  obterAmbientesDoProjeto,
  revogarTokenDeEvidencia,
  salvarAmbiente,
} from '@/modules/ambientes/service'
import { criarProjeto } from '@/modules/projetos/service'
import { limparBanco } from './banco-de-teste'

const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }

async function prepararProjeto() {
  const { id: projetoId } = await criarProjeto(admin, { nome: 'Portal' })
  const repo = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(1),
      instalacaoId: BigInt(1),
      nomeCompleto: 'kustertech-exemplo/portal',
      urlHtml: 'https://github.com/kustertech-exemplo/portal',
      privado: false,
      catalogadoEm: new Date(),
      projetoId,
      cursorDeployments: new Date('2026-10-20T00:00:00Z'),
    },
  })
  return { projetoId, repo }
}

beforeEach(async () => {
  await limparBanco()
  await db.usuario.create({
    data: { id: admin.usuarioId, email: 'admin@local.test', nome: 'Admin', senhaHash: 'x' },
  })
})

describe('ambientes / service (integração)', () => {
  test('salvarAmbiente: cria QA, atualiza sem duplicar; "QA" em DEV e "qa" em QA → "Outro ambiente deste projeto já usa este nome do GitHub."; URL "ftp://x" recusada; projeto arquivado recusado; mudar o nome zera cursorDeployments dos repositórios do projeto', async () => {
    const { projetoId, repo } = await prepararProjeto()

    await salvarAmbiente(admin, projetoId, 'QA', {
      nomeNoGitHub: 'qa',
      url: 'https://qa.exemplo.test',
    })
    await salvarAmbiente(admin, projetoId, 'QA', {
      nomeNoGitHub: 'qa',
      url: 'https://qa2.exemplo.test',
    })
    const linhas = await db.ambiente.findMany({ where: { projetoId } })
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toMatchObject({
      tipo: 'QA',
      nomeNoGitHub: 'qa',
      url: 'https://qa2.exemplo.test',
    })
    expect(await contarAmbientesPorProjeto(admin)).toEqual(new Map([[projetoId, 1]]))

    // Mudar o nome zera o cursor e pede nova sincronização.
    const criado = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })
    expect(criado.cursorDeployments).toBeNull()
    expect(criado.sincronizacaoSolicitadaEm).not.toBeNull()

    // Salvar o mesmo nome (mesmo com outra caixa) não relê o histórico.
    await db.repositorioGitHub.update({
      where: { id: repo.id },
      data: { cursorDeployments: new Date('2026-10-21T00:00:00Z') },
    })
    await salvarAmbiente(admin, projetoId, 'QA', { nomeNoGitHub: 'QA', url: '' })
    const mantido = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })
    expect(mantido.cursorDeployments).not.toBeNull()

    await expect(
      salvarAmbiente(admin, projetoId, 'DEV', { nomeNoGitHub: 'qa', url: '' }),
    ).rejects.toThrow('Outro ambiente deste projeto já usa este nome do GitHub.')
    expect(await db.ambiente.count({ where: { projetoId } })).toBe(1)

    await expect(
      salvarAmbiente(admin, projetoId, 'PROD', { nomeNoGitHub: 'production', url: 'ftp://x' }),
    ).rejects.toBeInstanceOf(ErroDeDominio)

    await expect(
      salvarAmbiente(admin, '00000000-0000-4000-8000-000000000000', 'DEV', {
        nomeNoGitHub: 'dev',
        url: '',
      }),
    ).rejects.toThrow('Projeto não encontrado.')

    await db.projeto.update({ where: { id: projetoId }, data: { arquivadoEm: new Date() } })
    await expect(
      salvarAmbiente(admin, projetoId, 'DEV', { nomeNoGitHub: 'dev', url: '' }),
    ).rejects.toThrow('Projeto arquivado não recebe ambientes.')
    expect(await db.ambiente.count({ where: { projetoId } })).toBe(1)
  })

  test('gerarTokenDeEvidencia: token casa formatoDeTokenValido; tokenEvidenciaHash = hashDoTokenDeEvidencia(token) com 64 caracteres; nenhuma coluna de Ambiente contém o token; gerar de novo troca o hash', async () => {
    const { projetoId } = await prepararProjeto()
    await expect(gerarTokenDeEvidencia(admin, projetoId, 'QA')).rejects.toThrow(
      'Salve o ambiente antes de gerar o token.',
    )

    await salvarAmbiente(admin, projetoId, 'QA', { nomeNoGitHub: 'qa', url: '' })
    const token = await gerarTokenDeEvidencia(admin, projetoId, 'QA')
    expect(formatoDeTokenValido(token)).toBe(true)

    const ambiente = await db.ambiente.findFirstOrThrow({ where: { projetoId, tipo: 'QA' } })
    expect(ambiente.tokenEvidenciaHash).toBe(hashDoTokenDeEvidencia(token))
    expect(ambiente.tokenEvidenciaHash).toHaveLength(64)
    expect(ambiente.tokenCriadoEm).not.toBeNull()
    expect(JSON.stringify(ambiente)).not.toContain(token)

    const segundo = await gerarTokenDeEvidencia(admin, projetoId, 'QA')
    const depois = await db.ambiente.findFirstOrThrow({ where: { projetoId, tipo: 'QA' } })
    expect(segundo).not.toBe(token)
    expect(depois.tokenEvidenciaHash).toBe(hashDoTokenDeEvidencia(segundo))
    expect(depois.tokenEvidenciaHash).not.toBe(ambiente.tokenEvidenciaHash)

    await revogarTokenDeEvidencia(admin, projetoId, 'QA')
    const revogado = await db.ambiente.findFirstOrThrow({ where: { projetoId, tipo: 'QA' } })
    expect(revogado.tokenEvidenciaHash).toBeNull()
    expect(revogado.tokenCriadoEm).toBeNull()
  })

  test('obterAmbientesDoProjeto: sempre DEV, QA e PROD; leitura de deployments pelos campos deployments*; githubConfigurado e repositoriosVinculados', async () => {
    const { projetoId, repo } = await prepararProjeto()
    await salvarAmbiente(admin, projetoId, 'QA', {
      nomeNoGitHub: 'qa',
      url: 'https://qa.exemplo.test',
    })
    const lidoEm = new Date()
    await db.repositorioGitHub.update({
      where: { id: repo.id },
      data: { deploymentsSincronizadosEm: lidoEm },
    })

    const tela = await obterAmbientesDoProjeto(admin, projetoId)

    expect(tela.ambientes.map((a) => [a.tipo, a.configurado])).toEqual([
      ['DEV', false],
      ['QA', true],
      ['PROD', false],
    ])
    expect(tela.ambientes[1]).toMatchObject({ nomeNoGitHub: 'qa', url: 'https://qa.exemplo.test' })
    expect(tela.leituras).toEqual([
      { repositorio: 'kustertech-exemplo/portal', estado: 'conectada', lidoEm, falhaMotivo: null },
    ])
    expect(tela.githubConfigurado).toBe(false)
    expect(tela.repositoriosVinculados).toBe(1)
  })
})
