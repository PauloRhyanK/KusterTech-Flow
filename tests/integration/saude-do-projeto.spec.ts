import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import {
  listarRecursosDoProjeto,
  obterResumoDeSaudeDoProjeto,
  obterSaudeDoProjeto,
} from '@/modules/infra/queries'
import { associarProjetoAoRecurso, cadastrarRecurso } from '@/modules/infra/service'
import { criarProjeto } from '@/modules/projetos/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

let admin: Sujeito
let testadorGlobal: Sujeito

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-saude@local.test',
    nome: 'Admin Saúde',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  const testador = await criarUsuario({
    email: 'testador-saude@local.test',
    nome: 'Testador Saúde',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'TESTADOR', clienteId: null }],
  })
  testadorGlobal = { usuarioId: testador.id, papeis: [{ papel: 'TESTADOR', clienteId: null }] }
})

afterAll(async () => {
  await db.$disconnect()
})

async function inserirAlerta(d: {
  chave: string
  titulo: string
  estado?: 'ATIVO' | 'RECONHECIDO' | 'RESOLVIDO_NA_ORIGEM'
  recursoId?: string
  projetoId?: string
}): Promise<{ id: string }> {
  const agora = new Date('2026-10-27T10:00:00Z')
  return db.alerta.create({
    data: {
      chaveDedupe: d.chave,
      origem: 'MANUAL',
      titulo: d.titulo,
      severidade: 'ALTA',
      estado: d.estado ?? 'ATIVO',
      recursoId: d.recursoId ?? null,
      projetoId: d.projetoId ?? null,
      primeiraOcorrenciaEm: agora,
      ultimaOcorrenciaEm: agora,
      ocorrencias: 1,
      resolvidoEm: d.estado === 'RESOLVIDO_NA_ORIGEM' ? agora : null,
    },
    select: { id: true },
  })
}

describe('saúde do projeto (integração)', () => {
  test('alerta com projetoId = P e alerta do recurso associado a P aparecem; alerta com os dois vínculos aparece 1 vez; resolvidos não aparecem; resumo "2 alertas não resolvidos"', async () => {
    const { id: projetoId } = await criarProjeto(admin, { nome: 'Projeto P' })
    const { id: outroId } = await criarProjeto(admin, { nome: 'Projeto Outro' })
    const recurso = await cadastrarRecurso(admin, { tipo: 'CONTAINER', nome: 'API P' })
    const alheio = await cadastrarRecurso(admin, { tipo: 'CONTAINER', nome: 'API Outro' })
    await associarProjetoAoRecurso(admin, recurso.id, projetoId)
    await associarProjetoAoRecurso(admin, alheio.id, outroId)

    const direto = await inserirAlerta({ chave: 'm:1', titulo: 'Direto no projeto', projetoId })
    const doRecurso = await inserirAlerta({
      chave: 'm:2',
      titulo: 'Do recurso',
      recursoId: recurso.id,
    })
    await inserirAlerta({
      chave: 'm:3',
      titulo: 'Com os dois vínculos',
      recursoId: recurso.id,
      projetoId,
      estado: 'RESOLVIDO_NA_ORIGEM',
    })
    await inserirAlerta({ chave: 'm:4', titulo: 'De outro projeto', recursoId: alheio.id })

    let saude = await obterSaudeDoProjeto(admin, projetoId)
    expect(saude.alertas.map((a) => a.id).sort()).toEqual([direto.id, doRecurso.id].sort())
    expect(saude.resumo.texto).toBe('2 alertas não resolvidos')
    expect((await obterResumoDeSaudeDoProjeto(admin, projetoId)).texto).toBe(
      '2 alertas não resolvidos',
    )

    // Reabre o alerta com os dois vínculos: continua uma linha só.
    await db.alerta.updateMany({
      where: { chaveDedupe: 'm:3' },
      data: { estado: 'RECONHECIDO', resolvidoEm: null },
    })
    saude = await obterSaudeDoProjeto(admin, projetoId)
    expect(saude.alertas).toHaveLength(3)
    expect(saude.alertas.filter((a) => a.titulo === 'Com os dois vínculos')).toHaveLength(1)
    expect(saude.resumo.texto).toBe('3 alertas não resolvidos')
  })

  test('recursos do projeto incluem arquivados; GlitchTip lista os links dos recursos associados', async () => {
    const { id: projetoId } = await criarProjeto(admin, { nome: 'Projeto G' })
    const ativo = await cadastrarRecurso(admin, {
      tipo: 'CONTAINER',
      nome: 'Com GlitchTip',
      urlGlitchTip: 'https://glitchtip.exemplo.test/p',
    })
    const arquivado = await cadastrarRecurso(admin, { tipo: 'BANCO', nome: 'Banco antigo' })
    await associarProjetoAoRecurso(admin, ativo.id, projetoId)
    await associarProjetoAoRecurso(admin, arquivado.id, projetoId)
    await db.recurso.update({ where: { id: arquivado.id }, data: { arquivadoEm: new Date() } })

    const recursos = await listarRecursosDoProjeto(admin, projetoId)
    expect(recursos.map((r) => [r.nome, r.situacao.texto])).toEqual([
      ['Banco antigo', 'Arquivado'],
      ['Com GlitchTip', 'Sem dados'],
    ])
    const saude = await obterSaudeDoProjeto(admin, projetoId)
    expect(saude.glitchTip).toEqual([
      { recurso: 'Com GlitchTip', href: 'https://glitchtip.exemplo.test/p' },
    ])
    expect(saude.resumo.texto).toBe('Sem dados')
  })

  test('TESTADOR global (clienteId null): ErroDeAutorizacao em obterSaudeDoProjeto e listarRecursosDoProjeto', async () => {
    const { id: projetoId } = await criarProjeto(admin, { nome: 'Projeto T' })
    await expect(obterSaudeDoProjeto(testadorGlobal, projetoId)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(listarRecursosDoProjeto(testadorGlobal, projetoId)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(obterResumoDeSaudeDoProjeto(testadorGlobal, projetoId)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
  })

  test('projeto inexistente → "Projeto não encontrado."', async () => {
    await expect(obterSaudeDoProjeto(admin, 'nao-existe')).rejects.toThrow(
      'Projeto não encontrado.',
    )
    await expect(listarRecursosDoProjeto(admin, 'nao-existe')).rejects.toThrow(
      'Projeto não encontrado.',
    )
  })
})
