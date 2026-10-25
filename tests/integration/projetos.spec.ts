import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
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

    // 4. listarProjetosParaTela devolve configuracaoPendente = false
    const tela = await listarProjetosParaTela(adminSujeito)
    expect(tela).toHaveLength(1)
    expect(tela[0]?.configuracaoPendente).toBe(false)
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

    // 5. TESTADOR de A no contexto do cliente A abrindo projeto de A e B → devolve com sucesso
    const obtido = await obterProjeto(testadorSujeitoA, projABId, {
      tipo: 'cliente',
      clienteId: idA,
    })
    expect(obtido.id).toBe(projABId)
    expect(obtido.nome).toBe('Projeto Compartilhado A e B')
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

    // 1. obterProjetoParaResumo devolve contagens corretas
    const resumo = await obterProjetoParaResumo(adminSujeito, projetoId, { tipo: 'global' })
    expect(resumo.id).toBe(projetoId)
    expect(resumo.contagens).toEqual({
      clientes: 2,
      repositorios: 0,
      ambientes: 0,
      milestones: 0,
    })

    // 2. obterProjetoParaConfiguracao exclui clientes já associados (A e B) e cliente arquivado (D)
    const config = await obterProjetoParaConfiguracao(adminSujeito, projetoId)
    expect(config.id).toBe(projetoId)
    expect(config.clientesDisponiveis).toEqual([{ id: idC, nome: 'Cliente C' }])
  })
})
