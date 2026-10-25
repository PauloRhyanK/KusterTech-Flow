import { Prisma } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import {
  listarClientesParaSelecao,
  listarClientesParaTela,
  obterClienteComProjetos,
} from '@/modules/clientes/queries'
import {
  arquivarCliente,
  criarCliente,
  desarquivarCliente,
  editarCliente,
  listarClientes,
  obterCliente,
} from '@/modules/clientes/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

let adminSujeito: Sujeito

beforeEach(async () => {
  await limparBanco()

  const admin = await criarUsuario({
    email: 'admin@local.test',
    nome: 'Admin User',
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

describe('clientes (integração)', () => {
  test('ADMIN cria, edita, arquiva e desarquiva; nome repetido com caixa/acentos diferentes é recusado na criação e na renomeação sem criar duplicata (count)', async () => {
    // 1. Criação
    const { id: acmeId } = await criarCliente(adminSujeito, {
      nome: '  Acme  Ltda  ',
      observacoes: 'Primeiro cliente',
    })

    const acmeSalvo = await db.cliente.findUnique({ where: { id: acmeId } })
    expect(acmeSalvo).not.toBeNull()
    expect(acmeSalvo?.nome).toBe('Acme  Ltda')
    expect(acmeSalvo?.nomeNormalizado).toBe('acme ltda')
    expect(acmeSalvo?.observacoes).toBe('Primeiro cliente')
    expect(acmeSalvo?.arquivadoEm).toBeNull()

    // 2. Tentativas de duplicatas com variações de espaços, caixa e acentos
    await expect(criarCliente(adminSujeito, { nome: 'acme ltda' })).rejects.toThrow(
      'Já existe um cliente com este nome.',
    )

    await expect(criarCliente(adminSujeito, { nome: '  ACME   LTDA  ' })).rejects.toThrow(
      'Já existe um cliente com este nome.',
    )

    await expect(criarCliente(adminSujeito, { nome: 'Acmé Ltdá' })).rejects.toThrow(
      'Já existe um cliente com este nome.',
    )

    // Confere que a contagem no banco continua 1
    expect(await db.cliente.count()).toBe(1)

    // 3. Cria um segundo cliente
    const { id: betaId } = await criarCliente(adminSujeito, {
      nome: 'Beta Corp',
    })
    expect(await db.cliente.count()).toBe(2)

    // 4. Renomear para nome já existente é recusado
    await expect(editarCliente(adminSujeito, betaId, { nome: '  acme  ltda  ' })).rejects.toThrow(
      'Já existe um cliente com este nome.',
    )

    // 5. Renomear com sucesso e atualizar observações
    await editarCliente(adminSujeito, betaId, {
      nome: 'Beta Corp Internacional',
      observacoes: 'Atualizado',
    })
    const betaAtualizado = await db.cliente.findUnique({ where: { id: betaId } })
    expect(betaAtualizado?.nome).toBe('Beta Corp Internacional')
    expect(betaAtualizado?.nomeNormalizado).toBe('beta corp internacional')
    expect(betaAtualizado?.observacoes).toBe('Atualizado')

    // 6. Arquivamento e desarquivamento com idempotência
    await arquivarCliente(adminSujeito, acmeId)
    const acmeArquivado = await db.cliente.findUnique({ where: { id: acmeId } })
    expect(acmeArquivado?.arquivadoEm).not.toBeNull()

    // Arquivar novamente não lança erro
    await expect(arquivarCliente(adminSujeito, acmeId)).resolves.toBeUndefined()

    // Desarquivar
    await desarquivarCliente(adminSujeito, acmeId)
    const acmeDesarquivado = await db.cliente.findUnique({ where: { id: acmeId } })
    expect(acmeDesarquivado?.arquivadoEm).toBeNull()

    // Desarquivar novamente não lança erro
    await expect(desarquivarCliente(adminSujeito, acmeId)).resolves.toBeUndefined()
  })

  test('TESTADOR escopado a A lista só A (e com dois escopos lista A e B) e recebe ErroDeAutorizacao ao obter C (A16)', async () => {
    const { id: idA } = await criarCliente(adminSujeito, { nome: 'Cliente A' })
    const { id: idB } = await criarCliente(adminSujeito, { nome: 'Cliente B' })
    const { id: idC } = await criarCliente(adminSujeito, { nome: 'Cliente C' })

    const usuarioTestador = await criarUsuario({
      email: 'testador@local.test',
      nome: 'Testador',
      senha: 'senha-super-segura-123',
      papeis: [{ papel: 'TESTADOR', clienteId: idA }],
    })

    const sujeitoA: Sujeito = {
      usuarioId: usuarioTestador.id,
      papeis: [{ papel: 'TESTADOR', clienteId: idA }],
    }

    // Escopado apenas a A: lista só A
    const listaA = await listarClientes(sujeitoA)
    expect(listaA).toHaveLength(1)
    expect(listaA[0]?.id).toBe(idA)
    expect(listaA[0]?.nome).toBe('Cliente A')

    // Testador obtendo cliente A com sucesso
    const clienteAObtido = await obterCliente(sujeitoA, idA)
    expect(clienteAObtido.id).toBe(idA)

    // Testador tenta obter C: ErroDeAutorizacao antes de tocar dados
    await expect(obterCliente(sujeitoA, idC)).rejects.toThrow(ErroDeAutorizacao)

    // Com dois escopos (A e B): lista A e B
    const sujeitoAB: Sujeito = {
      usuarioId: usuarioTestador.id,
      papeis: [
        { papel: 'TESTADOR', clienteId: idA },
        { papel: 'TESTADOR', clienteId: idB },
      ],
    }

    const listaAB = await listarClientes(sujeitoAB)
    expect(listaAB).toHaveLength(2)
    expect(listaAB.map((c) => c.id).sort()).toEqual([idA, idB].sort())

    // Ainda recebe ErroDeAutorizacao para C
    await expect(obterCliente(sujeitoAB, idC)).rejects.toThrow(ErroDeAutorizacao)
  })

  test('UsuarioPapel.clienteId referencia Cliente: papel com clienteId inexistente falha no banco (P2003)', async () => {
    const usuario = await db.usuario.create({
      data: {
        email: 'usuario-fk@local.test',
        nome: 'Usuario FK',
        senhaHash: 'hash',
      },
    })

    await expect(
      db.usuarioPapel.create({
        data: {
          usuarioId: usuario.id,
          papel: 'TESTADOR',
          clienteId: '00000000-0000-0000-0000-000000000000',
        },
      }),
    ).rejects.toSatisfy((erro: unknown) => {
      return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2003'
    })
  })

  test('listarClientesParaSelecao não inclui arquivados; listarClientesParaTela devolve totalDeProjetos 0', async () => {
    const { id: idAtivo } = await criarCliente(adminSujeito, { nome: 'Cliente Ativo' })
    const { id: idArquivado } = await criarCliente(adminSujeito, { nome: 'Cliente Arquivado' })

    await arquivarCliente(adminSujeito, idArquivado)

    // listarClientesParaSelecao não inclui arquivados
    const selecao = await listarClientesParaSelecao(adminSujeito)
    expect(selecao).toHaveLength(1)
    expect(selecao[0]).toEqual({
      id: idAtivo,
      nome: 'Cliente Ativo',
    })

    // listarClientesParaTela devolve ambos e totalDeProjetos = 0
    const tela = await listarClientesParaTela(adminSujeito)
    expect(tela).toHaveLength(2)

    const ativoNaTela = tela.find((c) => c.id === idAtivo)
    const arquivadoNaTela = tela.find((c) => c.id === idArquivado)

    expect(ativoNaTela).toBeDefined()
    expect(ativoNaTela?.totalDeProjetos).toBe(0)
    expect(ativoNaTela?.arquivadoEm).toBeNull()

    expect(arquivadoNaTela).toBeDefined()
    expect(arquivadoNaTela?.totalDeProjetos).toBe(0)
    expect(arquivadoNaTela?.arquivadoEm).not.toBeNull()

    // Testar obterClienteComProjetos também
    const comProjetos = await obterClienteComProjetos(adminSujeito, idAtivo)
    expect(comProjetos.id).toBe(idAtivo)
    expect(comProjetos.projetos).toEqual([])
  })
})
