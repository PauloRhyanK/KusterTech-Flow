import { readFileSync } from 'node:fs'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { arquivoDeCadastroSchema } from '@/modules/cadastro/model'
import { normalizarNome } from '@/modules/clientes/model'
import { importarCadastro } from '@/modules/cadastro/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const exemplo = arquivoDeCadastroSchema.parse(
  JSON.parse(readFileSync('cadastro.exemplo.json', 'utf8')),
)

let admin: Sujeito

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin@local.test',
    nome: 'Admin User',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(1),
      instalacaoId: BigInt(1),
      nomeCompleto: 'exemplo-org/aurora-web',
      urlHtml: 'https://github.com/exemplo-org/aurora-web',
      privado: true,
      catalogadoEm: new Date(),
    },
  })
})

afterAll(async () => {
  await db.$disconnect()
})

async function fotografia() {
  const [clientes, projetos, maquinas, projetoCliente, recursoProjeto, repositorios, recursos] =
    await Promise.all([
      db.cliente.count(),
      db.projeto.count(),
      db.recurso.count(),
      db.projetoCliente.findMany({ select: { projetoId: true, clienteId: true } }),
      db.recursoProjeto.findMany({ select: { recursoId: true, projetoId: true } }),
      db.repositorioGitHub.findMany({ select: { nomeCompleto: true, projetoId: true } }),
      db.recurso.findMany({ select: { nome: true, hospedadoEmId: true, custoMensal: true } }),
    ])
  const ordenar = <T>(itens: T[]): T[] =>
    [...itens].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return {
    clientes,
    projetos,
    maquinas,
    projetoCliente: ordenar(projetoCliente),
    recursoProjeto: ordenar(recursoProjeto),
    repositorios: ordenar(repositorios),
    recursos: ordenar(recursos),
  }
}

describe('importarCadastro (integração)', () => {
  test('importar duas vezes deixa o banco igual', async () => {
    const primeiro = await importarCadastro(admin, exemplo, { simular: false })
    expect(primeiro.erros).toEqual([])
    const antes = await fotografia()
    expect(antes).toMatchObject({ clientes: 2, projetos: 3, maquinas: 3 })
    expect(antes.projetoCliente).toHaveLength(3)
    expect(antes.recursoProjeto).toHaveLength(4)
    expect(antes.repositorios[0]?.projetoId).not.toBeNull()
    expect(antes.recursos.find((r) => r.nome === 'Banco Exemplo')?.hospedadoEmId).not.toBeNull()

    const plano = await importarCadastro(admin, exemplo, { simular: false })
    expect(await fotografia()).toEqual(antes)
    expect(plano.acoes.length).toBeGreaterThan(0)
    expect(plano.acoes.every((a) => a.tipo.startsWith('atualizar'))).toBe(true)
  })

  test('reimportar com grafias alteradas (caixa, acento, espaços duplos) deixa o banco igual', async () => {
    expect((await importarCadastro(admin, exemplo, { simular: false })).erros).toEqual([])
    const antes = await fotografia()

    const trocas: [string, string][] = [
      ['Cliente Exemplo Um', 'CLIENTE  exemplo um'],
      ['Cliente Exemplo Dois', 'cliente exémplo  DOIS'],
      ['Projeto Aurora', 'projeto  AURÓRA'],
      ['Projeto Boreal', 'PROJETO boreal'],
      ['Projeto Interno Exemplo', 'Projeto  Interno  Exêmplo'],
      ['Servidor Exemplo', 'SERVIDOR  exemplo'],
      ['Banco Exemplo', 'banco exêmplo'],
      ['Armazenamento Exemplo', 'Armazenamento  EXEMPLO'],
    ]
    let texto = readFileSync('cadastro.exemplo.json', 'utf8')
    for (const [de, para] of trocas) texto = texto.replaceAll(`"${de}"`, `"${para}"`)
    const alterado = arquivoDeCadastroSchema.parse(JSON.parse(texto))
    expect(alterado.clientes[0]?.nome).toBe('CLIENTE  exemplo um')

    const plano = await importarCadastro(admin, alterado, { simular: false })
    expect(plano.erros).toEqual([])
    expect(plano.acoes.every((a) => a.tipo.startsWith('atualizar'))).toBe(true)
    // Atualizar regrava o nome com a grafia do arquivo; a identidade (nome normalizado),
    // as contagens e os vínculos ficam iguais.
    const depois = await fotografia()
    const comNomeNormalizado = (f: typeof antes) => ({
      ...f,
      recursos: f.recursos
        .map((r) => ({ ...r, nome: normalizarNome(r.nome) }))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    })
    expect(comNomeNormalizado(depois)).toEqual(comNomeNormalizado(antes))
    expect(depois.recursos.map((r) => r.nome)).toContain('banco exêmplo')
  })

  test('simular não grava nada', async () => {
    const plano = await importarCadastro(admin, exemplo, { simular: true })
    expect(plano.acoes.length).toBeGreaterThan(0)
    expect(await db.cliente.count()).toBe(0)
    expect(await db.projeto.count()).toBe(0)
    expect(await db.recurso.count()).toBe(0)
  })

  test('sujeito sem papel de administrador é recusado e nada é gravado', async () => {
    const outro = await criarUsuario({
      email: 'testador@local.test',
      nome: 'Testador',
      senha: 'senha-super-segura-123',
      papeis: [{ papel: 'TESTADOR', clienteId: null }],
    })
    const sujeito: Sujeito = {
      usuarioId: outro.id,
      papeis: [{ papel: 'TESTADOR', clienteId: null }],
    }
    await expect(importarCadastro(sujeito, exemplo, { simular: false })).rejects.toThrow()
    expect(await db.cliente.count()).toBe(0)
    expect(await db.projeto.count()).toBe(0)
    expect(await db.recurso.count()).toBe(0)
  })

  test('plano com erros não grava nada', async () => {
    const invalido = arquivoDeCadastroSchema.parse({
      clientes: [{ nome: 'Só Um' }],
      projetos: [{ nome: 'P', clientes: ['Inexistente'] }],
    })
    const plano = await importarCadastro(admin, invalido, { simular: false })
    expect(plano.erros).toHaveLength(1)
    expect(await db.cliente.count()).toBe(0)
  })
})
