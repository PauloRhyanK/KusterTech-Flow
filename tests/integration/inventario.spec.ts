import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { vincularRepositorio } from '@/modules/github/service'
import { lerFiltrosDoInventario, listarRecursos, obterRecurso } from '@/modules/infra/queries'
import {
  alternarArquivamentoDeRecurso,
  associarProjetoAoRecurso,
  cadastrarRecurso,
  desassociarProjetoDoRecurso,
  editarRecurso,
} from '@/modules/infra/service'
import { arquivarProjeto, criarProjeto } from '@/modules/projetos/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

let admin: Sujeito
let aprovadorEscopado: Sujeito
let testadorGlobal: Sujeito

const todas = { tipo: null, projetoId: null, situacao: 'todas' } as const

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-infra@local.test',
    nome: 'Admin Infra',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }

  const cliente = await db.cliente.create({
    data: { nome: 'Cliente I', nomeNormalizado: 'cliente i' },
  })
  const aprovador = await criarUsuario({
    email: 'aprovador-infra@local.test',
    nome: 'Aprovador Infra',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'APROVADOR', clienteId: cliente.id }],
  })
  aprovadorEscopado = {
    usuarioId: aprovador.id,
    papeis: [{ papel: 'APROVADOR', clienteId: cliente.id }],
  }
  const testador = await criarUsuario({
    email: 'testador-infra@local.test',
    nome: 'Testador Infra',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'TESTADOR', clienteId: null }],
  })
  testadorGlobal = { usuarioId: testador.id, papeis: [{ papel: 'TESTADOR', clienteId: null }] }
})

afterAll(async () => {
  await db.$disconnect()
})

describe('inventário de infraestrutura (integração)', () => {
  test('cadastrar "VPS Produção" e depois "  vps  producao " → "Já existe um recurso com este nome."; identificador externo repetido → mensagem própria; 1 recurso no banco', async () => {
    const { id } = await cadastrarRecurso(admin, {
      tipo: 'SERVIDOR',
      nome: 'VPS Produção',
      identificadorExterno: 'host-01',
    })
    const salvo = await db.recurso.findUniqueOrThrow({ where: { id } })
    expect(salvo.nomeNormalizado).toBe('vps producao')

    await expect(
      cadastrarRecurso(admin, { tipo: 'SERVIDOR', nome: '  vps  producao ' }),
    ).rejects.toThrow('Já existe um recurso com este nome.')
    await expect(
      cadastrarRecurso(admin, {
        tipo: 'BANCO',
        nome: 'Banco outro',
        identificadorExterno: 'host-01',
      }),
    ).rejects.toThrow('Já existe um recurso com este identificador externo.')
    expect(await db.recurso.count()).toBe(1)

    await expect(cadastrarRecurso(admin, { tipo: 'OUTRO', nome: '   ' })).rejects.toThrow(
      'O nome é obrigatório.',
    )
    await expect(
      cadastrarRecurso(admin, { tipo: 'OUTRO', nome: 'Longo', descricao: 'x'.repeat(2001) }),
    ).rejects.toThrow('A descrição não pode ter mais de 2000 caracteres.')
    await expect(
      cadastrarRecurso(admin, {
        tipo: 'OUTRO',
        nome: 'Url ruim',
        urlBeszel: 'javascript:alert(1)',
      }),
    ).rejects.toThrow('O endereço do Beszel')
    expect(await db.recurso.count()).toBe(1)
  })

  test('hospedagem: container em servidor ok; container em container e servidor em servidor recusados; arquivar servidor com container ativo recusado', async () => {
    const servidor = await cadastrarRecurso(admin, { tipo: 'SERVIDOR', nome: 'VPS 01' })
    const outroServidor = await cadastrarRecurso(admin, { tipo: 'SERVIDOR', nome: 'VPS 02' })
    const container = await cadastrarRecurso(admin, {
      tipo: 'CONTAINER',
      nome: 'api',
      hospedadoEmId: servidor.id,
    })
    expect(
      (await db.recurso.findUniqueOrThrow({ where: { id: container.id } })).hospedadoEmId,
    ).toBe(servidor.id)

    await expect(
      cadastrarRecurso(admin, { tipo: 'CONTAINER', nome: 'web', hospedadoEmId: container.id }),
    ).rejects.toThrow('Só servidores podem hospedar outros recursos.')
    await expect(
      cadastrarRecurso(admin, { tipo: 'SERVIDOR', nome: 'VPS 03', hospedadoEmId: servidor.id }),
    ).rejects.toThrow('Um servidor não pode estar hospedado em outro recurso.')
    await expect(
      editarRecurso(admin, servidor.id, { nome: 'VPS 01', hospedadoEmId: servidor.id }),
    ).rejects.toThrow('Um recurso não pode hospedar a si mesmo.')
    await expect(
      editarRecurso(admin, container.id, { nome: 'api', hospedadoEmId: container.id }),
    ).rejects.toThrow('Um recurso não pode hospedar a si mesmo.')

    await expect(alternarArquivamentoDeRecurso(admin, servidor.id, true)).rejects.toThrow(
      'Arquive antes os recursos hospedados neste servidor.',
    )
    await alternarArquivamentoDeRecurso(admin, container.id, true)
    await alternarArquivamentoDeRecurso(admin, servidor.id, true)
    expect(
      (await db.recurso.findUniqueOrThrow({ where: { id: servidor.id } })).arquivadoEm,
    ).not.toBeNull()

    await expect(
      cadastrarRecurso(admin, { tipo: 'CONTAINER', nome: 'worker', hospedadoEmId: servidor.id }),
    ).rejects.toThrow('Servidor arquivado não recebe novos recursos.')

    await alternarArquivamentoDeRecurso(admin, servidor.id, false)
    expect(
      (await db.recurso.findUniqueOrThrow({ where: { id: servidor.id } })).arquivadoEm,
    ).toBeNull()
    await expect(
      editarRecurso(admin, outroServidor.id, { nome: 'VPS 02', hospedadoEmId: servidor.id }),
    ).rejects.toThrow('Um servidor não pode estar hospedado em outro recurso.')
    await expect(alternarArquivamentoDeRecurso(admin, 'inexistente', true)).rejects.toThrow(
      'Recurso não encontrado.',
    )
  })

  test('associar duas vezes deixa 1 RecursoProjeto; projeto arquivado e recurso arquivado recusados; desassociar não toca no recurso', async () => {
    const recurso = await cadastrarRecurso(admin, { tipo: 'BANCO', nome: 'Postgres' })
    const { id: projetoId } = await criarProjeto(admin, { nome: 'Projeto A' })
    const { id: arquivadoId } = await criarProjeto(admin, { nome: 'Projeto Antigo' })
    await arquivarProjeto(admin, arquivadoId)

    await associarProjetoAoRecurso(admin, recurso.id, projetoId)
    await associarProjetoAoRecurso(admin, recurso.id, projetoId)
    expect(await db.recursoProjeto.count()).toBe(1)

    await expect(associarProjetoAoRecurso(admin, recurso.id, arquivadoId)).rejects.toThrow(
      'Projeto arquivado não recebe recursos.',
    )
    await expect(associarProjetoAoRecurso(admin, recurso.id, 'inexistente')).rejects.toThrow(
      'Projeto não encontrado.',
    )
    await expect(associarProjetoAoRecurso(admin, 'inexistente', projetoId)).rejects.toThrow(
      'Recurso não encontrado.',
    )

    const arquivado = await cadastrarRecurso(admin, { tipo: 'STORAGE', nome: 'Bucket' })
    await alternarArquivamentoDeRecurso(admin, arquivado.id, true)
    await expect(associarProjetoAoRecurso(admin, arquivado.id, projetoId)).rejects.toThrow(
      'Recurso arquivado não recebe novos projetos.',
    )
    expect(await db.recursoProjeto.count()).toBe(1)

    await desassociarProjetoDoRecurso(admin, recurso.id, projetoId)
    expect(await db.recursoProjeto.count()).toBe(0)
    expect(await db.recurso.count()).toBe(2)
    expect(await db.projeto.count()).toBe(2)
  })

  test('listarRecursos: filtro tipo CONTAINER devolve 1 de 3; filtro projeto devolve só os associados; arquivado só aparece com situacao=arquivados; situacao de recurso sem alerta é "Sem dados"', async () => {
    const servidor = await cadastrarRecurso(admin, { tipo: 'SERVIDOR', nome: 'VPS 01' })
    const container = await cadastrarRecurso(admin, {
      tipo: 'CONTAINER',
      nome: 'api',
      hospedadoEmId: servidor.id,
    })
    const banco = await cadastrarRecurso(admin, { tipo: 'BANCO', nome: 'Postgres' })
    const velho = await cadastrarRecurso(admin, { tipo: 'STORAGE', nome: 'Bucket antigo' })
    await alternarArquivamentoDeRecurso(admin, velho.id, true)
    const { id: projetoId } = await criarProjeto(admin, { nome: 'Projeto A' })
    await associarProjetoAoRecurso(admin, container.id, projetoId)

    const padrao = await listarRecursos(admin, todas)
    expect(padrao.total).toBe(3)
    expect(padrao.recursos.map((r) => r.nome)).toEqual(['api', 'Postgres', 'VPS 01'])
    expect(padrao.projetos).toEqual([{ id: projetoId, nome: 'Projeto A' }])
    const linhaContainer = padrao.recursos.find((r) => r.id === container.id)
    expect(linhaContainer).toMatchObject({
      hospedadoEm: { id: servidor.id, nome: 'VPS 01' },
      totalDeProjetos: 1,
      situacao: { chave: 'sem-dados', texto: 'Sem dados', tom: 'neutro' },
    })

    const soContainers = await listarRecursos(admin, { ...todas, tipo: 'CONTAINER' })
    expect(soContainers.recursos.map((r) => r.id)).toEqual([container.id])
    expect(soContainers.total).toBe(1)

    const doProjeto = await listarRecursos(admin, { ...todas, projetoId })
    expect(doProjeto.recursos.map((r) => r.id)).toEqual([container.id])

    const arquivados = await listarRecursos(admin, { ...todas, situacao: 'arquivados' })
    expect(arquivados.recursos.map((r) => r.id)).toEqual([velho.id])
    expect(arquivados.recursos[0]?.situacao.chave).toBe('arquivado')

    const semDados = await listarRecursos(admin, { ...todas, situacao: 'sem-dados' })
    expect(semDados.recursos).toHaveLength(3)
    const comAlerta = await listarRecursos(admin, { ...todas, situacao: 'com-alerta' })
    expect(comAlerta.recursos).toHaveLength(0)

    await db.alerta.create({
      data: {
        chaveDedupe: 'manual:1',
        origem: 'MANUAL',
        titulo: 'Disco',
        severidade: 'ALTA',
        estado: 'ATIVO',
        recursoId: banco.id,
        primeiraOcorrenciaEm: new Date(),
        ultimaOcorrenciaEm: new Date(),
        ocorrencias: 1,
      },
    })
    const comAlertaAgora = await listarRecursos(admin, { ...todas, situacao: 'com-alerta' })
    expect(comAlertaAgora.recursos.map((r) => r.id)).toEqual([banco.id])
    expect(comAlertaAgora.recursos[0]?.situacao).toMatchObject({
      chave: 'com-alerta',
      texto: '1 alerta',
      tom: 'erro',
    })
    expect(
      (await listarRecursos(admin, { ...todas, situacao: 'sem-dados' })).recursos,
    ).toHaveLength(2)

    expect(lerFiltrosDoInventario({ tipo: 'CONTAINER', situacao: 'lixo', projeto: 'x' })).toEqual({
      tipo: 'CONTAINER',
      projetoId: 'x',
      situacao: 'todas',
    })
    expect(lerFiltrosDoInventario({ tipo: 'NADA' })).toEqual({
      tipo: null,
      projetoId: null,
      situacao: 'todas',
    })
  })

  test('obterRecurso: ferramentas = Beszel + "GitHub · kustertech-exemplo/portal" (repositório vinculado ao projeto associado, catálogo de fixtures); editar não altera o tipo', async () => {
    await sincronizarCatalogo(criarFonteFixtures(), new Date())
    const { id: projetoId } = await criarProjeto(admin, { nome: 'Projeto A' })
    const portal = await db.repositorioGitHub.findFirstOrThrow({
      where: { nomeCompleto: 'kustertech-exemplo/portal' },
    })
    await vincularRepositorio(admin, projetoId, portal.id)

    const servidor = await cadastrarRecurso(admin, {
      tipo: 'SERVIDOR',
      nome: 'VPS 01',
      urlBeszel: 'https://beszel.exemplo.test/vps',
    })
    const container = await cadastrarRecurso(admin, {
      tipo: 'CONTAINER',
      nome: 'api',
      hospedadoEmId: servidor.id,
      urlBeszel: 'https://beszel.exemplo.test/api',
    })
    await associarProjetoAoRecurso(admin, container.id, projetoId)
    await associarProjetoAoRecurso(admin, servidor.id, projetoId)
    const outro = await criarProjeto(admin, { nome: 'Projeto B' })

    const detalhe = await obterRecurso(admin, container.id)
    expect(detalhe.ferramentas).toEqual([
      { rotulo: 'Beszel', href: 'https://beszel.exemplo.test/api' },
      { rotulo: 'GitHub · kustertech-exemplo/portal', href: portal.urlHtml },
    ])
    expect(detalhe.hospedadoEm).toEqual({ id: servidor.id, nome: 'VPS 01' })
    expect(detalhe.projetos).toEqual([{ id: projetoId, nome: 'Projeto A', arquivado: false }])
    expect(detalhe.projetosDisponiveis).toEqual([{ id: outro.id, nome: 'Projeto B' }])
    expect(detalhe.situacao.chave).toBe('sem-dados')

    const doServidor = await obterRecurso(admin, servidor.id)
    expect(doServidor.hospedados).toEqual([
      { id: container.id, nome: 'api', tipo: 'CONTAINER', arquivado: false },
    ])

    await editarRecurso(admin, container.id, {
      nome: 'api v2',
      descricao: '  Serviço público  ',
      hospedadoEmId: servidor.id,
    })
    const editado = await db.recurso.findUniqueOrThrow({ where: { id: container.id } })
    expect(editado).toMatchObject({
      tipo: 'CONTAINER',
      nome: 'api v2',
      nomeNormalizado: 'api v2',
      descricao: 'Serviço público',
      urlBeszel: null,
    })

    await expect(obterRecurso(admin, 'inexistente')).rejects.toThrow('Recurso não encontrado.')
  })

  test('APROVADOR escopado e TESTADOR global: ErroDeAutorizacao em listar, obter, cadastrar e associar; contarRecursos inalterado', async () => {
    const recurso = await cadastrarRecurso(admin, { tipo: 'SERVIDOR', nome: 'VPS 01' })
    const { id: projetoId } = await criarProjeto(admin, { nome: 'Projeto A' })

    for (const sujeito of [aprovadorEscopado, testadorGlobal]) {
      await expect(listarRecursos(sujeito, todas)).rejects.toBeInstanceOf(ErroDeAutorizacao)
      await expect(obterRecurso(sujeito, recurso.id)).rejects.toBeInstanceOf(ErroDeAutorizacao)
      await expect(
        cadastrarRecurso(sujeito, { tipo: 'SERVIDOR', nome: 'Invasor' }),
      ).rejects.toBeInstanceOf(ErroDeAutorizacao)
      await expect(
        editarRecurso(sujeito, recurso.id, { nome: 'Renomeado' }),
      ).rejects.toBeInstanceOf(ErroDeAutorizacao)
      await expect(alternarArquivamentoDeRecurso(sujeito, recurso.id, true)).rejects.toBeInstanceOf(
        ErroDeAutorizacao,
      )
      await expect(associarProjetoAoRecurso(sujeito, recurso.id, projetoId)).rejects.toBeInstanceOf(
        ErroDeAutorizacao,
      )
      await expect(
        desassociarProjetoDoRecurso(sujeito, recurso.id, projetoId),
      ).rejects.toBeInstanceOf(ErroDeAutorizacao)
    }

    expect(await db.recurso.count()).toBe(1)
    expect(await db.recursoProjeto.count()).toBe(0)
    const intacto = await db.recurso.findUniqueOrThrow({ where: { id: recurso.id } })
    expect(intacto.nome).toBe('VPS 01')
    expect(intacto.arquivadoEm).toBeNull()
  })
})
