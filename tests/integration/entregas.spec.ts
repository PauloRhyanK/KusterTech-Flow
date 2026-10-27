import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { criarCliente, arquivarCliente } from '@/modules/clientes/service'
import {
  adicionarIssuesAMilestone,
  arquivarMilestone,
  associarClienteAMilestone,
  criarMilestone,
  editarMilestone,
  marcarForaDoEscopo,
  reativarMilestone,
  registrarCorrecao,
  removerClienteDaMilestone,
  removerIssueDaMilestone,
  voltarAoEscopo,
} from '@/modules/entregas/service'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { arquivarProjeto, associarCliente, criarProjeto } from '@/modules/projetos/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-10-26T15:00:00.000Z')

let admin: Sujeito
let testadorDeA: Sujeito
let clienteA: string
let clienteB: string
let projetoP: string
let projetoQ: string
let repoPortal: string
let repoApi: string
let repoSite: string

async function issue(repositorioId: string, numero: number) {
  return db.issueGitHub.findUniqueOrThrow({
    where: { repositorioId_numero: { repositorioId, numero } },
  })
}

async function issueId(repositorioId: string, numero: number) {
  return (await issue(repositorioId, numero)).id
}

async function vincularESincronizar(nomeCompleto: string, projetoId: string): Promise<string> {
  const fonte = criarFonteFixtures()
  const repo = await db.repositorioGitHub.findFirstOrThrow({ where: { nomeCompleto } })
  await db.repositorioGitHub.update({
    where: { id: repo.id },
    data: { projetoId, vinculadoEm: agora },
  })
  await sincronizarRepositorio(fonte, repo.id, agora)
  return repo.id
}

async function contagens() {
  return {
    milestones: await db.milestone.count(),
    clientes: await db.milestoneCliente.count(),
    issues: await db.milestoneIssue.count(),
    vinculos: await db.issueVinculo.count(),
  }
}

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-entregas@local.test',
    nome: 'Admin Entregas',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }

  clienteA = (await criarCliente(admin, { nome: 'Acme' })).id
  clienteB = (await criarCliente(admin, { nome: 'Beta' })).id
  const testador = await criarUsuario({
    email: 'testador-entregas@local.test',
    nome: 'Testador Acme',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'TESTADOR', clienteId: clienteA }],
  })
  testadorDeA = {
    usuarioId: testador.id,
    papeis: [{ papel: 'TESTADOR', clienteId: clienteA }],
  }

  projetoP = (await criarProjeto(admin, { nome: 'Projeto P', clientesIds: [clienteA, clienteB] }))
    .id
  projetoQ = (await criarProjeto(admin, { nome: 'Projeto Q' })).id

  await sincronizarCatalogo(criarFonteFixtures(), agora)
  repoPortal = await vincularESincronizar('kustertech-exemplo/portal', projetoP)
  repoApi = await vincularESincronizar('kustertech-exemplo/api', projetoP)
  repoSite = await vincularESincronizar('kustertech-exemplo/site', projetoQ)
})

afterAll(async () => {
  await db.$disconnect()
})

describe('service de entregas (integração)', () => {
  test('criarMilestone: sem prazo, clientes e issues cria (D19); "Entrega 1" e " entrega   1 " no mesmo projeto → "Já existe uma milestone com este título neste projeto."; cliente fora de P → "O cliente precisa estar associado ao projeto."; P arquivado → "Projeto arquivado não recebe milestones."', async () => {
    const { id } = await criarMilestone(admin, projetoP, { titulo: 'Entrega 1' })
    const criada = await db.milestone.findUniqueOrThrow({ where: { id } })
    expect(criada.prazo).toBeNull()
    expect(criada.tituloNormalizado).toBe('entrega 1')
    expect(await db.milestoneCliente.count()).toBe(0)
    expect(await db.milestoneIssue.count()).toBe(0)

    await expect(criarMilestone(admin, projetoP, { titulo: ' entrega   1 ' })).rejects.toThrow(
      'Já existe uma milestone com este título neste projeto.',
    )
    await expect(
      criarMilestone(admin, projetoQ, { titulo: 'Entrega 2', clientesIds: [clienteA] }),
    ).rejects.toThrow('O cliente precisa estar associado ao projeto.')
    expect(await db.milestone.count()).toBe(1)

    const comClientes = await criarMilestone(admin, projetoP, {
      titulo: 'Entrega 3',
      prazo: new Date('2026-11-30T00:00:00.000Z'),
      clientesIds: [clienteA, clienteB],
    })
    expect(await db.milestoneCliente.count({ where: { milestoneId: comClientes.id } })).toBe(2)

    await arquivarProjeto(admin, projetoP)
    await expect(criarMilestone(admin, projetoP, { titulo: 'Entrega 4' })).rejects.toThrow(
      'Projeto arquivado não recebe milestones.',
    )
  })

  test('adicionarIssuesAMilestone(portal#1, portal#4, api#1) → {adicionadas: 3}; repetir → {adicionadas: 0} e 3 linhas MANUAL; com site#1 → "Issue não encontrada neste projeto." e continuam 3 linhas; 51 ids → "Adicione no máximo 50 issues por vez."', async () => {
    const { id } = await criarMilestone(admin, projetoP, { titulo: 'Entrega 1' })
    const ids = [
      await issueId(repoPortal, 1),
      await issueId(repoPortal, 4),
      await issueId(repoApi, 1),
    ]

    expect(await adicionarIssuesAMilestone(admin, id, ids)).toEqual({ adicionadas: 3 })
    expect(await adicionarIssuesAMilestone(admin, id, ids)).toEqual({ adicionadas: 0 })
    const linhas = await db.milestoneIssue.findMany({ where: { milestoneId: id } })
    expect(linhas).toHaveLength(3)
    expect(linhas.every((l) => l.origem === 'MANUAL')).toBe(true)

    await expect(
      adicionarIssuesAMilestone(admin, id, [
        await issueId(repoSite, 1),
        await issueId(repoPortal, 2),
      ]),
    ).rejects.toThrow('Issue não encontrada neste projeto.')
    expect(await db.milestoneIssue.count({ where: { milestoneId: id } })).toBe(3)

    const cinquentaEUm = Array.from({ length: 51 }, (_, i) => `id-${i}`)
    await expect(adicionarIssuesAMilestone(admin, id, cinquentaEUm)).rejects.toThrow(
      'Adicione no máximo 50 issues por vez.',
    )
    await expect(adicionarIssuesAMilestone(admin, id, [])).rejects.toThrow(
      'Selecione ao menos uma issue.',
    )
  })

  test('registrarCorrecao(api#3 corrige portal#1) com portal#1 em M1 ativa e em M2 arquivada → {milestonesHerdadas: 1}; linha (M1, api#3) HERANCA_CORRECAO, nenhuma em M2; criadoPorId = admin', async () => {
    const m1 = await criarMilestone(admin, projetoP, { titulo: 'M1' })
    const m2 = await criarMilestone(admin, projetoP, { titulo: 'M2' })
    const portal1 = await issueId(repoPortal, 1)
    const api3 = await issueId(repoApi, 3)
    await adicionarIssuesAMilestone(admin, m1.id, [portal1])
    await adicionarIssuesAMilestone(admin, m2.id, [portal1])
    await arquivarMilestone(admin, m2.id)

    const resultado = await registrarCorrecao(admin, {
      projetoId: projetoP,
      issueCorrecaoId: api3,
      repositorioOriginalId: repoPortal,
      numeroOriginal: 1,
    })

    expect(resultado).toEqual({ milestonesHerdadas: 1 })
    const herdada = await db.milestoneIssue.findUniqueOrThrow({
      where: { milestoneId_issueId: { milestoneId: m1.id, issueId: api3 } },
    })
    expect(herdada.origem).toBe('HERANCA_CORRECAO')
    expect(herdada.foraDoEscopo).toBe(false)
    expect(await db.milestoneIssue.count({ where: { milestoneId: m2.id, issueId: api3 } })).toBe(0)
    const vinculo = await db.issueVinculo.findFirstOrThrow({ where: { issueCorrecaoId: api3 } })
    expect(vinculo.issueOriginalId).toBe(portal1)
    expect(vinculo.criadoPorId).toBe(admin.usuarioId)
  })

  test('registrarCorrecao(api#2 corrige portal#1) com api#2 já MANUAL em M1 → {milestonesHerdadas: 0} e a linha continua MANUAL', async () => {
    const m1 = await criarMilestone(admin, projetoP, { titulo: 'M1' })
    const portal1 = await issueId(repoPortal, 1)
    const api2 = await issueId(repoApi, 2)
    await adicionarIssuesAMilestone(admin, m1.id, [portal1, api2])

    const resultado = await registrarCorrecao(admin, {
      projetoId: projetoP,
      issueCorrecaoId: api2,
      repositorioOriginalId: repoPortal,
      numeroOriginal: 1,
    })

    expect(resultado).toEqual({ milestonesHerdadas: 0 })
    const linha = await db.milestoneIssue.findUniqueOrThrow({
      where: { milestoneId_issueId: { milestoneId: m1.id, issueId: api2 } },
    })
    expect(linha.origem).toBe('MANUAL')
  })

  test('registrarCorrecao recusa: portal#1 corrige portal#1; repetido; portal#1 corrige api#3 depois de api#3 corrige portal#1 → "A issue #3 já é registrada como correção desta issue."; número 99 → "Issue #99 não encontrada neste repositório."; repositório site → "Issue #1 não encontrada neste repositório."', async () => {
    const portal1 = await issueId(repoPortal, 1)
    const api3 = await issueId(repoApi, 3)
    const corrige = (
      issueCorrecaoId: string,
      repositorioOriginalId: string,
      numeroOriginal: number,
    ) =>
      registrarCorrecao(admin, {
        projetoId: projetoP,
        issueCorrecaoId,
        repositorioOriginalId,
        numeroOriginal,
      })

    await expect(corrige(portal1, repoPortal, 1)).rejects.toThrow(
      'Uma issue não pode corrigir a si mesma.',
    )
    await corrige(api3, repoPortal, 1)
    await expect(corrige(api3, repoPortal, 1)).rejects.toThrow(
      'Este vínculo de correção já existe.',
    )
    await expect(corrige(portal1, repoApi, 3)).rejects.toThrow(
      'A issue #3 já é registrada como correção desta issue.',
    )
    await expect(corrige(api3, repoPortal, 99)).rejects.toThrow(
      'Issue #99 não encontrada neste repositório.',
    )
    await expect(corrige(api3, repoSite, 1)).rejects.toThrow(
      'Issue #1 não encontrada neste repositório.',
    )
    expect(await db.issueVinculo.count()).toBe(1)
  })

  test('fora do escopo: em linha MANUAL recusa; justificativa "  " → "A justificativa é obrigatória."; com "Pertence à próxima entrega." grava foraDoEscopo e texto; repetir → "Esta correção já está fora do escopo."; voltarAoEscopo limpa a justificativa; removerIssueDaMilestone na herdada → "Correções herdadas não são removidas; marque como fora do escopo."', async () => {
    const m1 = await criarMilestone(admin, projetoP, { titulo: 'Entrega 1' })
    const portal1 = await issueId(repoPortal, 1)
    const api3 = await issueId(repoApi, 3)
    await adicionarIssuesAMilestone(admin, m1.id, [portal1])
    await registrarCorrecao(admin, {
      projetoId: projetoP,
      issueCorrecaoId: api3,
      repositorioOriginalId: repoPortal,
      numeroOriginal: 1,
    })
    const justificativa = 'Pertence à próxima entrega.'
    const chave = { milestoneId: m1.id, issueId: api3 }

    await expect(
      marcarForaDoEscopo(admin, { milestoneId: m1.id, issueId: portal1, justificativa }),
    ).rejects.toThrow('Só correções herdadas podem ser marcadas como fora do escopo.')
    await expect(marcarForaDoEscopo(admin, { ...chave, justificativa: '  ' })).rejects.toThrow(
      'A justificativa é obrigatória.',
    )

    expect(await marcarForaDoEscopo(admin, { ...chave, justificativa })).toEqual({
      tituloDaMilestone: 'Entrega 1',
    })
    const fora = await db.milestoneIssue.findUniqueOrThrow({
      where: { milestoneId_issueId: chave },
    })
    expect(fora.foraDoEscopo).toBe(true)
    expect(fora.justificativaForaDoEscopo).toBe(justificativa)
    await expect(marcarForaDoEscopo(admin, { ...chave, justificativa })).rejects.toThrow(
      'Esta correção já está fora do escopo.',
    )

    await expect(voltarAoEscopo(admin, chave)).resolves.toEqual({ tituloDaMilestone: 'Entrega 1' })
    const dentro = await db.milestoneIssue.findUniqueOrThrow({
      where: { milestoneId_issueId: chave },
    })
    expect(dentro.foraDoEscopo).toBe(false)
    expect(dentro.justificativaForaDoEscopo).toBeNull()
    await expect(voltarAoEscopo(admin, chave)).rejects.toThrow('Esta correção já está no escopo.')

    await expect(removerIssueDaMilestone(admin, m1.id, api3)).rejects.toThrow(
      'Correções herdadas não são removidas; marque como fora do escopo.',
    )
    expect(await db.milestoneIssue.count({ where: { milestoneId: m1.id } })).toBe(2)
    await removerIssueDaMilestone(admin, m1.id, portal1)
    expect(await db.milestoneIssue.count({ where: { milestoneId: m1.id } })).toBe(1)
  })

  test('milestone arquivada recusa editar, adicionar issue e associar cliente com "Milestone arquivada não recebe alterações."; reativar permite de novo', async () => {
    const { id } = await criarMilestone(admin, projetoP, { titulo: 'Entrega 1' })
    const portal1 = await issueId(repoPortal, 1)
    await arquivarMilestone(admin, id)
    await arquivarMilestone(admin, id)
    const mensagem = 'Milestone arquivada não recebe alterações.'

    await expect(editarMilestone(admin, id, { titulo: 'Outro' })).rejects.toThrow(mensagem)
    await expect(adicionarIssuesAMilestone(admin, id, [portal1])).rejects.toThrow(mensagem)
    await expect(associarClienteAMilestone(admin, id, clienteA)).rejects.toThrow(mensagem)
    expect(await contagens()).toMatchObject({ clientes: 0, issues: 0 })

    await reativarMilestone(admin, id)
    await reativarMilestone(admin, id)
    await editarMilestone(admin, id, { titulo: 'Outro', descricao: 'Texto' })
    await associarClienteAMilestone(admin, id, clienteA)
    expect(await adicionarIssuesAMilestone(admin, id, [portal1])).toEqual({ adicionadas: 1 })
    expect((await db.milestone.findUniqueOrThrow({ where: { id } })).titulo).toBe('Outro')
  })

  test('associar cliente arquivado → "Cliente arquivado não pode ser associado."; repetido → "Cliente já associado a esta milestone."; removerClienteDaMilestone remove só o vínculo', async () => {
    const { id } = await criarMilestone(admin, projetoP, { titulo: 'Entrega 1' })
    const clienteC = (await criarCliente(admin, { nome: 'Gama' })).id
    await associarCliente(admin, projetoP, clienteC)
    await arquivarCliente(admin, clienteC)

    await expect(associarClienteAMilestone(admin, id, clienteC)).rejects.toThrow(
      'Cliente arquivado não pode ser associado.',
    )
    await associarClienteAMilestone(admin, id, clienteA)
    await expect(associarClienteAMilestone(admin, id, clienteA)).rejects.toThrow(
      'Cliente já associado a esta milestone.',
    )

    await removerClienteDaMilestone(admin, id, clienteA)
    expect(await db.milestoneCliente.count()).toBe(0)
    expect(
      await db.projetoCliente.count({ where: { projetoId: projetoP, clienteId: clienteA } }),
    ).toBe(1)
    expect(await db.milestone.count({ where: { id } })).toBe(1)
  })

  test('TESTADOR de A: criar, editar, arquivar, associar cliente, adicionar e remover issue, registrar correção e marcar fora do escopo → ErroDeAutorizacao; contagens de Milestone, MilestoneCliente, MilestoneIssue e IssueVinculo inalteradas', async () => {
    const { id } = await criarMilestone(admin, projetoP, {
      titulo: 'Entrega 1',
      clientesIds: [clienteA],
    })
    const portal1 = await issueId(repoPortal, 1)
    const api3 = await issueId(repoApi, 3)
    await adicionarIssuesAMilestone(admin, id, [portal1])
    const antes = await contagens()

    const chamadas = [
      () => criarMilestone(testadorDeA, projetoP, { titulo: 'Forjada' }),
      () => editarMilestone(testadorDeA, id, { titulo: 'Forjada' }),
      () => arquivarMilestone(testadorDeA, id),
      () => associarClienteAMilestone(testadorDeA, id, clienteB),
      () => removerClienteDaMilestone(testadorDeA, id, clienteA),
      () => adicionarIssuesAMilestone(testadorDeA, id, [api3]),
      () => removerIssueDaMilestone(testadorDeA, id, portal1),
      () =>
        registrarCorrecao(testadorDeA, {
          projetoId: projetoP,
          issueCorrecaoId: api3,
          repositorioOriginalId: repoPortal,
          numeroOriginal: 1,
        }),
      () =>
        marcarForaDoEscopo(testadorDeA, {
          milestoneId: id,
          issueId: api3,
          justificativa: 'Forjada.',
        }),
    ]
    for (const chamada of chamadas) {
      await expect(chamada()).rejects.toBeInstanceOf(ErroDeAutorizacao)
    }

    expect(await contagens()).toEqual(antes)
    expect((await db.milestone.findUniqueOrThrow({ where: { id } })).arquivadaEm).toBeNull()
  })

  test('revalida o estado atual: milestone inexistente → "Milestone não encontrada."; projeto inexistente → "Projeto não encontrado."', async () => {
    await expect(arquivarMilestone(admin, 'inexistente')).rejects.toBeInstanceOf(ErroDeDominio)
    await expect(editarMilestone(admin, 'inexistente', { titulo: 'X' })).rejects.toThrow(
      'Milestone não encontrada.',
    )
    await expect(criarMilestone(admin, 'inexistente', { titulo: 'X' })).rejects.toThrow(
      'Projeto não encontrado.',
    )
  })
})
