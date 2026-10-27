import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import {
  arquivarMilestone,
  criarMilestone,
  removerClienteDaMilestone,
} from '@/modules/entregas/service'
import {
  contarMilestonesAtivasPorProjeto,
  obterEntregasParaResumo,
} from '@/modules/entregas/queries'
import { salvarAmbiente } from '@/modules/ambientes/service'
import { obterClienteComProjetos } from '@/modules/clientes/queries'
import { arquivarCliente, criarCliente } from '@/modules/clientes/service'
import {
  listarProjetosParaTela,
  obterProjetoParaConfiguracao,
  obterProjetoParaResumo,
} from '@/modules/projetos/queries'
import {
  associarCliente,
  criarProjeto,
  desassociarCliente,
  editarProjeto,
  listarProjetos,
  obterProjeto,
} from '@/modules/projetos/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

let adminSujeito: Sujeito

beforeEach(async () => {
  await limparBanco()

  const admin = await criarUsuario({
    email: 'admin-proj@local.test',
    nome: 'Admin Projetos',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })

  adminSujeito = {
    usuarioId: admin.id,
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  }
})

afterAll(async () => {
  await db.$disconnect()
})

describe('projetos (integração)', () => {
  test('projeto associado a A e B aparece uma vez em listarProjetos (ADMIN) e em obterClienteComProjetos de cada cliente (A02, UX-02)', async () => {
    const { id: idA } = await criarCliente(adminSujeito, { nome: 'Cliente Alpha' })
    const { id: idB } = await criarCliente(adminSujeito, { nome: 'Cliente Beta' })

    const { id: projetoId } = await criarProjeto(adminSujeito, {
      nome: 'Projeto Compartilhado Alpha-Beta',
      descricao: 'Atende ambos os clientes',
      clientesIds: [idA, idB],
    })

    // 1. listarProjetos pelo ADMIN: projeto aparece UMA vez com ambos os clientes
    const lista = await listarProjetos(adminSujeito)
    expect(lista).toHaveLength(1)
    expect(lista[0]?.id).toBe(projetoId)
    expect(lista[0]?.nome).toBe('Projeto Compartilhado Alpha-Beta')
    expect(lista[0]?.clientes).toHaveLength(2)

    const clientesIdsNoProjeto = lista[0]?.clientes.map((c) => c.id).sort()
    expect(clientesIdsNoProjeto).toEqual([idA, idB].sort())

    // 2. obterClienteComProjetos para Cliente Alpha: projeto aparece
    const clienteAComProjetos = await obterClienteComProjetos(adminSujeito, idA)
    expect(clienteAComProjetos.projetos).toHaveLength(1)
    expect(clienteAComProjetos.projetos[0]?.id).toBe(projetoId)
    expect(clienteAComProjetos.projetos[0]?.nome).toBe('Projeto Compartilhado Alpha-Beta')

    // 3. obterClienteComProjetos para Cliente Beta: projeto aparece com o mesmo id
    const clienteBComProjetos = await obterClienteComProjetos(adminSujeito, idB)
    expect(clienteBComProjetos.projetos).toHaveLength(1)
    expect(clienteBComProjetos.projetos[0]?.id).toBe(projetoId)
    expect(clienteBComProjetos.projetos[0]?.nome).toBe('Projeto Compartilhado Alpha-Beta')

    // 4. listarProjetosParaTela: com clientes mas sem repositório GitHub a configuração segue pendente;
    // com um repositório vinculado deixa de estar
    const tela = await listarProjetosParaTela(adminSujeito)
    expect(tela).toHaveLength(1)
    expect(tela[0]?.configuracaoPendente).toBe(true)

    await db.repositorioGitHub.create({
      data: {
        githubId: BigInt(1),
        instalacaoId: BigInt(1),
        nomeCompleto: 'kustertech-exemplo/portal',
        urlHtml: 'https://github.com/kustertech-exemplo/portal',
        privado: false,
        catalogadoEm: new Date(),
        projetoId,
      },
    })
    // Sem milestone ativa o checklist segue pendente; só deixa de estar com clientes, repositório,
    // milestone e os três ambientes
    const telaComRepositorio = await listarProjetosParaTela(adminSujeito)
    expect(telaComRepositorio[0]?.configuracaoPendente).toBe(true)

    await criarMilestone(adminSujeito, projetoId, { titulo: 'Entrega 1' })
    const telaComMilestone = await listarProjetosParaTela(adminSujeito)
    expect(telaComMilestone[0]?.configuracaoPendente).toBe(true)

    await salvarAmbiente(adminSujeito, projetoId, 'DEV', { nomeNoGitHub: 'dev', url: '' })
    await salvarAmbiente(adminSujeito, projetoId, 'QA', { nomeNoGitHub: 'qa', url: '' })
    const telaComDoisAmbientes = await listarProjetosParaTela(adminSujeito)
    expect(telaComDoisAmbientes[0]?.configuracaoPendente).toBe(true)

    await salvarAmbiente(adminSujeito, projetoId, 'PROD', { nomeNoGitHub: 'production', url: '' })
    const telaCompleta = await listarProjetosParaTela(adminSujeito)
    expect(telaCompleta[0]?.configuracaoPendente).toBe(false)

    // 5. listarProjetosParaTela com projeto sem clientes devolve configuracaoPendente = true
    const { id: projSemClientesId } = await criarProjeto(adminSujeito, {
      nome: 'Projeto Sem Clientes',
    })
    const telaAposNovo = await listarProjetosParaTela(adminSujeito)
    const semClientesNaTela = telaAposNovo.find((p) => p.id === projSemClientesId)
    expect(semClientesNaTela).toBeDefined()
    expect(semClientesNaTela?.configuracaoPendente).toBe(true)
  })

  test('TESTADOR de A: listarProjetos → ErroDeAutorizacao; obterProjeto global → ErroDeAutorizacao; contexto A de projeto só de B → "Projeto não encontrado."; contexto A de projeto [A, B] → devolve o projeto', async () => {
    const { id: idA } = await criarCliente(adminSujeito, { nome: 'Cliente A' })
    const { id: idB } = await criarCliente(adminSujeito, { nome: 'Cliente B' })

    const usuarioTestador = await criarUsuario({
      email: 'testador-a@local.test',
      nome: 'Testador Escopado A',
      senha: 'senha-super-segura-123',
      papeis: [{ papel: 'TESTADOR', clienteId: idA }],
    })

    const testadorSujeitoA: Sujeito = {
      usuarioId: usuarioTestador.id,
      papeis: [{ papel: 'TESTADOR', clienteId: idA }],
    }

    // Projeto só de B
    const { id: projSoBId } = await criarProjeto(adminSujeito, {
      nome: 'Projeto Exclusivo B',
      clientesIds: [idB],
    })

    // Projeto de A e B
    const { id: projABId } = await criarProjeto(adminSujeito, {
      nome: 'Projeto Compartilhado A e B',
      clientesIds: [idA, idB],
    })

    // 1. TESTADOR de A chamando listarProjetos → ErroDeAutorizacao
    await expect(listarProjetos(testadorSujeitoA)).rejects.toThrow(ErroDeAutorizacao)

    // 2. TESTADOR de A chamando obterProjeto global → ErroDeAutorizacao
    await expect(obterProjeto(testadorSujeitoA, projABId, { tipo: 'global' })).rejects.toThrow(
      ErroDeAutorizacao,
    )

    // 3. TESTADOR de A no contexto do cliente A tentando abrir projeto só de B → "Projeto não encontrado."
    await expect(
      obterProjeto(testadorSujeitoA, projSoBId, { tipo: 'cliente', clienteId: idA }),
    ).rejects.toThrow(new ErroDeDominio('Projeto não encontrado.'))

    // 4. ADMIN no contexto do cliente A tentando abrir projeto só de B → "Projeto não associado a este cliente."
    await expect(
      obterProjeto(adminSujeito, projSoBId, { tipo: 'cliente', clienteId: idA }),
    ).rejects.toThrow(new ErroDeDominio('Projeto não associado a este cliente.'))

    // 5. TESTADOR de A no contexto do cliente A abrindo projeto de A e B → devolve com sucesso,
    // com clientes contendo APENAS os clientes visíveis ao usuário (no caso, apenas idA)
    const obtido = await obterProjeto(testadorSujeitoA, projABId, {
      tipo: 'cliente',
      clienteId: idA,
    })
    expect(obtido.id).toBe(projABId)
    expect(obtido.nome).toBe('Projeto Compartilhado A e B')
    expect(obtido.clientes.map((c) => c.id)).toEqual([idA])

    // ADMIN no mesmo contexto de cliente A recebe todos os clientes do projeto [idA, idB]
    const obtidoAdminContextoA = await obterProjeto(adminSujeito, projABId, {
      tipo: 'cliente',
      clienteId: idA,
    })
    expect(obtidoAdminContextoA.clientes.map((c) => c.id).sort()).toEqual([idA, idB].sort())
  })

  test('associar duas vezes → ErroDeDominio; desassociar remove só o vínculo, projeto e cliente permanecem (invariante 1); desassociar não associado → ErroDeDominio', async () => {
    const { id: clienteId } = await criarCliente(adminSujeito, { nome: 'Cliente Vínculo' })
    const { id: projetoId } = await criarProjeto(adminSujeito, { nome: 'Projeto Vínculo' })

    // Associar pela primeira vez
    await associarCliente(adminSujeito, projetoId, clienteId)
    expect(await db.projetoCliente.count({ where: { projetoId, clienteId } })).toBe(1)

    // Associar pela segunda vez → ErroDeDominio('Cliente já associado a este projeto.')
    await expect(associarCliente(adminSujeito, projetoId, clienteId)).rejects.toThrow(
      'Cliente já associado a este projeto.',
    )

    // Desassociar
    await desassociarCliente(adminSujeito, projetoId, clienteId)
    expect(await db.projetoCliente.count({ where: { projetoId, clienteId } })).toBe(0)

    // Invariante 1: projeto e cliente permanecem no banco
    expect(await db.cliente.count({ where: { id: clienteId } })).toBe(1)
    expect(await db.projeto.count({ where: { id: projetoId } })).toBe(1)

    // Desassociar novamente quando não associado → ErroDeDominio('Cliente não está associado a este projeto.')
    await expect(desassociarCliente(adminSujeito, projetoId, clienteId)).rejects.toThrow(
      'Cliente não está associado a este projeto.',
    )
  })

  test('renomear projeto para nome existente com caixa diferente → "Já existe um projeto com este nome."', async () => {
    const { id: p1Id } = await criarProjeto(adminSujeito, { nome: 'Portal Principal' })
    const { id: p2Id } = await criarProjeto(adminSujeito, { nome: 'Portal Secundário' })

    expect(p1Id).toBeDefined()

    // Tentativa de duplicata na criação após Portal Principal já existir
    await expect(criarProjeto(adminSujeito, { nome: ' PORTAL  PRINCIPÁL ' })).rejects.toThrow(
      'Já existe um projeto com este nome.',
    )
    expect(await db.projeto.count()).toBe(2)

    // Tentativa de duplicata na renomeação com variação de caixa e espaços
    await expect(
      editarProjeto(adminSujeito, p2Id, { nome: '  portal  principal  ' }),
    ).rejects.toThrow('Já existe um projeto com este nome.')

    // Tentativa de duplicata na renomeação com acentuação diferente
    await expect(editarProjeto(adminSujeito, p2Id, { nome: 'Pórtal Principál' })).rejects.toThrow(
      'Já existe um projeto com este nome.',
    )

    // O projeto original não foi alterado e o número total de projetos segue 2
    expect((await db.projeto.findUnique({ where: { id: p2Id } }))?.nome).toBe('Portal Secundário')
    expect(await db.projeto.count()).toBe(2)

    // Renomeação válida
    await editarProjeto(adminSujeito, p2Id, {
      nome: 'Portal Secundário Renovado',
      descricao: 'Nova descrição',
    })
    const p2Salvo = await db.projeto.findUnique({ where: { id: p2Id } })
    expect(p2Salvo?.nome).toBe('Portal Secundário Renovado')
    expect(p2Salvo?.nomeNormalizado).toBe('portal secundario renovado')
    expect(p2Salvo?.descricao).toBe('Nova descrição')
  })

  test('obterProjetoParaResumo devolve contagens { clientes: 2, repositorios: 0, ambientes: 0, milestones: 0 }; obterProjetoParaConfiguracao exclui associados e arquivados de clientesDisponiveis', async () => {
    const { id: idA } = await criarCliente(adminSujeito, { nome: 'Cliente A' })
    const { id: idB } = await criarCliente(adminSujeito, { nome: 'Cliente B' })
    const { id: idC } = await criarCliente(adminSujeito, { nome: 'Cliente C' })
    const { id: idD } = await criarCliente(adminSujeito, { nome: 'Cliente D Arquivado' })

    await arquivarCliente(adminSujeito, idD)

    const { id: projetoId } = await criarProjeto(adminSujeito, {
      nome: 'Projeto Completo',
      clientesIds: [idA, idB],
    })

    // 1. obterProjetoParaResumo devolve contagens corretas (visão global com clienteId === null)
    const resumo = await obterProjetoParaResumo(adminSujeito, projetoId, null)
    expect(resumo.id).toBe(projetoId)
    expect(resumo.contagens).toEqual({
      clientes: 2,
      repositorios: 0,
      ambientes: 0,
      milestones: 0,
    })

    // TESTADOR escopado ao cliente A no contexto do cliente A: contagens.clientes = 1 para projeto [A, B]
    const usuarioTestador = await criarUsuario({
      email: 'testador-resumo@local.test',
      nome: 'Testador Resumo A',
      senha: 'senha-super-segura-123',
      papeis: [{ papel: 'TESTADOR', clienteId: idA }],
    })
    const sujeitoTestadorA: Sujeito = {
      usuarioId: usuarioTestador.id,
      papeis: [{ papel: 'TESTADOR', clienteId: idA }],
    }
    const resumoTestador = await obterProjetoParaResumo(sujeitoTestadorA, projetoId, idA)
    expect(resumoTestador.id).toBe(projetoId)
    expect(resumoTestador.contagens.clientes).toBe(1)

    // 2. obterProjetoParaConfiguracao exclui clientes já associados (A e B) e cliente arquivado (D)
    const config = await obterProjetoParaConfiguracao(adminSujeito, projetoId)
    expect(config.id).toBe(projetoId)
    expect(config.clientesDisponiveis).toEqual([{ id: idC, nome: 'Cliente C' }])
  })

  test('desassociarCliente com o cliente em milestone de P → mensagem de recusa e ProjetoCliente mantido; depois de removerClienteDaMilestone desassocia', async () => {
    const { id: clienteId } = await criarCliente(adminSujeito, { nome: 'Cliente Milestone' })
    const { id: projetoId } = await criarProjeto(adminSujeito, {
      nome: 'Projeto Com Milestone',
      clientesIds: [clienteId],
    })
    const { id: milestoneId } = await criarMilestone(adminSujeito, projetoId, {
      titulo: 'Entrega 1',
      clientesIds: [clienteId],
    })

    await expect(desassociarCliente(adminSujeito, projetoId, clienteId)).rejects.toThrow(
      'Este cliente está em milestones do projeto. Remova-o das milestones antes de desassociá-lo.',
    )
    expect(await db.projetoCliente.count({ where: { projetoId, clienteId } })).toBe(1)

    await removerClienteDaMilestone(adminSujeito, milestoneId, clienteId)
    await desassociarCliente(adminSujeito, projetoId, clienteId)
    expect(await db.projetoCliente.count({ where: { projetoId, clienteId } })).toBe(0)
  })

  test('obterProjetoParaResumo: 1 ativa e 1 arquivada → contagens.milestones 1; contexto do cliente sem milestone associada → 0', async () => {
    const { id: idA } = await criarCliente(adminSujeito, { nome: 'Cliente A' })
    const { id: idB } = await criarCliente(adminSujeito, { nome: 'Cliente B' })
    const { id: projetoId } = await criarProjeto(adminSujeito, {
      nome: 'Projeto Contagem',
      clientesIds: [idA, idB],
    })
    await criarMilestone(adminSujeito, projetoId, { titulo: 'Ativa', clientesIds: [idA] })
    const { id: arquivadaId } = await criarMilestone(adminSujeito, projetoId, {
      titulo: 'Arquivada',
      clientesIds: [idA, idB],
    })
    await arquivarMilestone(adminSujeito, arquivadaId)

    const global = await obterProjetoParaResumo(adminSujeito, projetoId, null)
    expect(global.contagens.milestones).toBe(1)

    const doClienteA = await obterProjetoParaResumo(adminSujeito, projetoId, idA)
    expect(doClienteA.contagens.milestones).toBe(1)

    // B só está na milestone arquivada: nenhuma ativa associada
    const doClienteB = await obterProjetoParaResumo(adminSujeito, projetoId, idB)
    expect(doClienteB.contagens.milestones).toBe(0)

    const porProjeto = await contarMilestonesAtivasPorProjeto(adminSujeito)
    expect(porProjeto.get(projetoId)).toBe(1)

    const entregasA = await obterEntregasParaResumo(adminSujeito, projetoId, {
      tipo: 'cliente',
      clienteId: idA,
    })
    expect(entregasA.totalAtivas).toBe(1)
    expect(entregasA.milestones.map((m) => m.titulo)).toEqual(['Ativa'])
    const entregasB = await obterEntregasParaResumo(adminSujeito, projetoId, {
      tipo: 'cliente',
      clienteId: idB,
    })
    expect(entregasB).toEqual({ milestones: [], totalAtivas: 0, issuesAbertasEmMilestones: 0 })
  })
})
