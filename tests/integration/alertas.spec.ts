import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import {
  chaveDedupeManual,
  hashDoTokenDeAlertas,
  type SeveridadeAlerta,
} from '@/modules/infra/model'
import {
  contarAlertasNaoResolvidos,
  lerFiltrosDeAlertas,
  listarAlertas,
  listarAlertasDoRecurso,
  listarAlertasNaoResolvidos,
  listarFontesDeAlertas,
  obterAlerta,
  obterResumoDeInfraestrutura,
} from '@/modules/infra/queries'
import {
  criarFonteDeAlertas,
  reconhecerAlerta,
  registrarAlertaManual,
  registrarResolucaoDoAlerta,
  revogarFonteDeAlertas,
} from '@/modules/infra/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

let admin: Sujeito
let aprovadorEscopado: Sujeito
let testadorEscopado: Sujeito
let testadorGlobal: Sujeito
let adminId: string

const padrao = { estado: 'nao-resolvidos', severidade: null } as const

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-alertas@local.test',
    nome: 'Admin Alertas',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  adminId = usuario.id
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }

  const cliente = await db.cliente.create({
    data: { nome: 'Cliente A', nomeNormalizado: 'cliente a' },
  })
  const aprovador = await criarUsuario({
    email: 'aprovador-alertas@local.test',
    nome: 'Aprovador Alertas',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'APROVADOR', clienteId: cliente.id }],
  })
  aprovadorEscopado = {
    usuarioId: aprovador.id,
    papeis: [{ papel: 'APROVADOR', clienteId: cliente.id }],
  }
  const testadorE = await criarUsuario({
    email: 'testador-e-alertas@local.test',
    nome: 'Testador Escopado',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'TESTADOR', clienteId: cliente.id }],
  })
  testadorEscopado = {
    usuarioId: testadorE.id,
    papeis: [{ papel: 'TESTADOR', clienteId: cliente.id }],
  }
  const testadorG = await criarUsuario({
    email: 'testador-g-alertas@local.test',
    nome: 'Testador Global',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'TESTADOR', clienteId: null }],
  })
  testadorGlobal = { usuarioId: testadorG.id, papeis: [{ papel: 'TESTADOR', clienteId: null }] }
})

afterAll(async () => {
  await db.$disconnect()
})

async function criarProjeto(nome: string): Promise<{ id: string }> {
  return db.projeto.create({
    data: { nome, nomeNormalizado: nome.toLowerCase() },
    select: { id: true },
  })
}

async function criarRecurso(nome: string): Promise<{ id: string }> {
  return db.recurso.create({
    data: { tipo: 'SERVIDOR', nome, nomeNormalizado: nome.toLowerCase() },
    select: { id: true },
  })
}

async function inserirAlerta(d: {
  chave: string
  titulo: string
  severidade: SeveridadeAlerta
  estado?: 'ATIVO' | 'RECONHECIDO' | 'RESOLVIDO_NA_ORIGEM'
  origem?: 'MANUAL' | 'WEBHOOK'
  ultima?: Date
  recursoId?: string
  projetoId?: string
}): Promise<{ id: string }> {
  const ultima = d.ultima ?? new Date('2026-10-27T10:00:00Z')
  return db.alerta.create({
    data: {
      chaveDedupe: d.chave,
      origem: d.origem ?? 'MANUAL',
      titulo: d.titulo,
      severidade: d.severidade,
      estado: d.estado ?? 'ATIVO',
      recursoId: d.recursoId ?? null,
      projetoId: d.projetoId ?? null,
      primeiraOcorrenciaEm: ultima,
      ultimaOcorrenciaEm: ultima,
      ocorrencias: 1,
      resolvidoEm: d.estado === 'RESOLVIDO_NA_ORIGEM' ? ultima : null,
    },
    select: { id: true },
  })
}

describe('alertas (integração)', () => {
  test('registrarAlertaManual: ATIVO, ocorrencias 1, origem MANUAL, chaveDedupe "manual:<id>", 1 evento CRIADO com autor', async () => {
    const { id } = await registrarAlertaManual(admin, {
      titulo: '  Disco cheio  ',
      severidade: 'ALTA',
      detalhe: 'Uso em 95%',
    })

    const alerta = await db.alerta.findUniqueOrThrow({ where: { id } })
    expect(alerta).toMatchObject({
      titulo: 'Disco cheio',
      estado: 'ATIVO',
      origem: 'MANUAL',
      severidade: 'ALTA',
      ocorrencias: 1,
      criadoPorId: adminId,
      detalhe: 'Uso em 95%',
      chaveDedupe: chaveDedupeManual(id),
    })
    expect(alerta.primeiraOcorrenciaEm.getTime()).toBe(alerta.ultimaOcorrenciaEm.getTime())
    const eventos = await db.eventoDeAlerta.findMany({ where: { alertaId: id } })
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({ tipo: 'CRIADO', autorId: adminId })

    await expect(
      registrarAlertaManual(admin, { titulo: ' ', severidade: 'BAIXA' }),
    ).rejects.toThrow('O título é obrigatório.')
    await expect(
      registrarAlertaManual(admin, { titulo: 'x'.repeat(201), severidade: 'BAIXA' }),
    ).rejects.toThrow('O título não pode ter mais de 200 caracteres.')
    await expect(
      registrarAlertaManual(admin, {
        titulo: 'Recurso fantasma',
        severidade: 'BAIXA',
        recursoId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrow('Recurso não encontrado.')
    await expect(
      registrarAlertaManual(admin, {
        titulo: 'Projeto fantasma',
        severidade: 'BAIXA',
        projetoId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrow('Projeto não encontrado.')
    expect(await db.alerta.count()).toBe(1)
  })

  test('reconhecer: RECONHECIDO com reconhecidoPorId e reconhecidoEm, evento RECONHECIDO; segunda vez → "Este alerta já foi reconhecido." e continua 2 eventos', async () => {
    const { id } = await registrarAlertaManual(admin, { titulo: 'CPU alta', severidade: 'MEDIA' })

    await reconhecerAlerta(admin, id)

    const alerta = await db.alerta.findUniqueOrThrow({ where: { id } })
    expect(alerta.estado).toBe('RECONHECIDO')
    expect(alerta.reconhecidoPorId).toBe(adminId)
    expect(alerta.reconhecidoEm).not.toBeNull()
    expect(await db.eventoDeAlerta.count({ where: { alertaId: id, tipo: 'RECONHECIDO' } })).toBe(1)

    await expect(reconhecerAlerta(admin, id)).rejects.toThrow('Este alerta já foi reconhecido.')
    expect(await db.eventoDeAlerta.count({ where: { alertaId: id } })).toBe(2)

    await expect(reconhecerAlerta(admin, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      'Alerta não encontrado.',
    )
  })

  test('dois reconhecimentos simultâneos gravam um único evento', async () => {
    const { id } = await registrarAlertaManual(admin, { titulo: 'Corrida', severidade: 'ALTA' })

    const resultados = await Promise.allSettled([
      reconhecerAlerta(admin, id),
      reconhecerAlerta(admin, id),
    ])

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await db.eventoDeAlerta.count({ where: { alertaId: id, tipo: 'RECONHECIDO' } })).toBe(1)
  })

  test('estado mudou entre a leitura e a gravação (resolvido por outro caminho): reconhecer recusa "Alerta resolvido não precisa de reconhecimento."', async () => {
    const { id } = await registrarAlertaManual(admin, {
      titulo: 'Já resolvido',
      severidade: 'ALTA',
    })
    await db.alerta.update({
      where: { id },
      data: { estado: 'RESOLVIDO_NA_ORIGEM', resolvidoEm: new Date() },
    })

    await expect(reconhecerAlerta(admin, id)).rejects.toThrow(
      'Alerta resolvido não precisa de reconhecimento.',
    )
    const alerta = await db.alerta.findUniqueOrThrow({ where: { id } })
    expect(alerta.estado).toBe('RESOLVIDO_NA_ORIGEM')
    expect(alerta.reconhecidoPorId).toBeNull()
    expect(await db.eventoDeAlerta.count({ where: { alertaId: id } })).toBe(1)
  })

  test('registrarResolucao em alerta WEBHOOK recusa com a mensagem fixa; em MANUAL grava resolvidoPorId, resolvidoEm e evento RESOLVIDO', async () => {
    const webhook = await inserirAlerta({
      chave: 'fonte-x:disco',
      titulo: 'Disco pelo webhook',
      severidade: 'ALTA',
      origem: 'WEBHOOK',
    })
    await expect(registrarResolucaoDoAlerta(admin, webhook.id)).rejects.toThrow(
      'Alertas recebidos por webhook são resolvidos pela própria fonte.',
    )
    expect((await db.alerta.findUniqueOrThrow({ where: { id: webhook.id } })).estado).toBe('ATIVO')

    const manual = await registrarAlertaManual(admin, { titulo: 'Manual', severidade: 'BAIXA' })
    await reconhecerAlerta(admin, manual.id)
    await registrarResolucaoDoAlerta(admin, manual.id)

    const alerta = await db.alerta.findUniqueOrThrow({ where: { id: manual.id } })
    expect(alerta.estado).toBe('RESOLVIDO_NA_ORIGEM')
    expect(alerta.resolvidoPorId).toBe(adminId)
    expect(alerta.resolvidoEm).not.toBeNull()
    expect(
      await db.eventoDeAlerta.count({ where: { alertaId: manual.id, tipo: 'RESOLVIDO' } }),
    ).toBe(1)

    await expect(registrarResolucaoDoAlerta(admin, manual.id)).rejects.toThrow(
      'Este alerta já está resolvido.',
    )
  })

  test('listarAlertas padrão: BAIXA ativo, CRITICA reconhecido, CRITICA ativo, MEDIA ativo e um resolvido → CRITICA ativo, CRITICA reconhecido, MEDIA ativo, BAIXA ativo; total 4', async () => {
    await inserirAlerta({ chave: 'a', titulo: 'BAIXA ativo', severidade: 'BAIXA' })
    await inserirAlerta({
      chave: 'b',
      titulo: 'CRITICA reconhecido',
      severidade: 'CRITICA',
      estado: 'RECONHECIDO',
    })
    await inserirAlerta({ chave: 'c', titulo: 'CRITICA ativo', severidade: 'CRITICA' })
    await inserirAlerta({ chave: 'd', titulo: 'MEDIA ativo', severidade: 'MEDIA' })
    await inserirAlerta({
      chave: 'e',
      titulo: 'ALTA resolvido',
      severidade: 'ALTA',
      estado: 'RESOLVIDO_NA_ORIGEM',
    })

    const { alertas, total } = await listarAlertas(admin, padrao)

    expect(alertas.map((a) => a.titulo)).toEqual([
      'CRITICA ativo',
      'CRITICA reconhecido',
      'MEDIA ativo',
      'BAIXA ativo',
    ])
    expect(total).toBe(4)
    expect(await contarAlertasNaoResolvidos(admin)).toBe(4)

    const resolvidos = await listarAlertas(admin, { estado: 'resolvidos', severidade: null })
    expect(resolvidos.alertas.map((a) => a.titulo)).toEqual(['ALTA resolvido'])
    const todos = await listarAlertas(admin, { estado: 'todos', severidade: 'CRITICA' })
    expect(todos.total).toBe(2)

    expect(lerFiltrosDeAlertas({})).toEqual(padrao)
    expect(lerFiltrosDeAlertas({ estado: 'reconhecidos', severidade: 'ALTA' })).toEqual({
      estado: 'reconhecidos',
      severidade: 'ALTA',
    })
    expect(lerFiltrosDeAlertas({ estado: 'lixo', severidade: 'x' })).toEqual(padrao)
  })

  test('obterAlerta: projetosAfetados une projeto do alerta e projetos do recurso sem repetir (projeto P nos dois → 1 vez)', async () => {
    const p = await criarProjeto('Projeto P')
    const q = await criarProjeto('Projeto Q')
    const recurso = await criarRecurso('VPS Alerta')
    await db.recursoProjeto.createMany({
      data: [
        { recursoId: recurso.id, projetoId: p.id },
        { recursoId: recurso.id, projetoId: q.id },
      ],
    })
    const { id } = await registrarAlertaManual(admin, {
      titulo: 'Com projetos',
      severidade: 'ALTA',
      recursoId: recurso.id,
      projetoId: p.id,
    })
    await reconhecerAlerta(admin, id)

    const alerta = await obterAlerta(admin, id)

    expect(alerta.projetosAfetados.map((x) => x.nome)).toEqual(['Projeto P', 'Projeto Q'])
    expect(alerta.recurso).toEqual({ id: recurso.id, nome: 'VPS Alerta' })
    expect(alerta.origemTexto).toBe('Registro manual · Admin Alertas')
    expect(alerta.reconhecido?.por).toBe('Admin Alertas')
    expect(alerta.resolucao).toBeNull()
    expect(alerta.podeRegistrarResolucao).toBe(true)
    expect(alerta.historico.map((h) => h.tipo)).toEqual(['CRIADO', 'RECONHECIDO'])
    expect(alerta.historico[0]?.autor).toBe('Admin Alertas')

    expect((await listarAlertasDoRecurso(admin, recurso.id)).map((a) => a.id)).toEqual([id])
    await expect(obterAlerta(admin, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      'Alerta não encontrado.',
    )

    const resumo = await obterResumoDeInfraestrutura(admin)
    expect(resumo).toEqual({
      recursos: 1,
      recursosPorTipo: { SERVIDOR: 1 },
      recursosComAlerta: 1,
      alertasAtivos: 0,
      alertasCriticos: 0,
      alertasReconhecidos: 1,
      fontesDeAlertas: 0,
      alertasJaRegistrados: 1,
    })
    expect((await listarAlertasNaoResolvidos(admin, 5)).map((a) => a.id)).toEqual([id])
  })

  test('criarFonteDeAlertas: token começa por "fa_" e não está em nenhuma coluna; tokenHash = hashDoTokenDeAlertas(token); listarFontes não devolve o hash; revogar duas vezes → "Esta fonte já foi revogada."', async () => {
    const { id, token } = await criarFonteDeAlertas(admin, '  Grafana  ')

    expect(token.startsWith('fa_')).toBe(true)
    const fonte = await db.fonteDeAlertas.findUniqueOrThrow({ where: { id } })
    expect(fonte.nome).toBe('Grafana')
    expect(fonte.tokenHash).toBe(hashDoTokenDeAlertas(token))
    expect(fonte.criadaPorId).toBe(adminId)
    expect(JSON.stringify(fonte)).not.toContain(token)

    const fontes = await listarFontesDeAlertas(admin)
    expect(fontes).toHaveLength(1)
    expect(Object.keys(fontes[0] ?? {}).sort()).toEqual([
      'criadoEm',
      'id',
      'nome',
      'revogadaEm',
      'ultimoUsoEm',
    ])
    expect(JSON.stringify(fontes)).not.toContain(fonte.tokenHash)

    await expect(criarFonteDeAlertas(admin, ' ')).rejects.toThrow('O nome é obrigatório.')
    await expect(criarFonteDeAlertas(admin, 'x'.repeat(81))).rejects.toThrow(
      'O nome não pode ter mais de 80 caracteres.',
    )

    await revogarFonteDeAlertas(admin, id)
    expect((await db.fonteDeAlertas.findUniqueOrThrow({ where: { id } })).revogadaEm).not.toBeNull()
    await expect(revogarFonteDeAlertas(admin, id)).rejects.toThrow('Esta fonte já foi revogada.')
  })

  test('APROVADOR e TESTADOR (escopado e global): ErroDeAutorizacao em listar, obter, registrar, reconhecer e criar fonte; contarAlertas e estados inalterados', async () => {
    const { id } = await registrarAlertaManual(admin, { titulo: 'Intocável', severidade: 'ALTA' })
    const fonte = await criarFonteDeAlertas(admin, 'Fonte')

    for (const sujeito of [aprovadorEscopado, testadorEscopado, testadorGlobal]) {
      await expect(listarAlertas(sujeito, padrao)).rejects.toThrow(ErroDeAutorizacao)
      await expect(obterAlerta(sujeito, id)).rejects.toThrow(ErroDeAutorizacao)
      await expect(contarAlertasNaoResolvidos(sujeito)).rejects.toThrow(ErroDeAutorizacao)
      await expect(listarFontesDeAlertas(sujeito)).rejects.toThrow(ErroDeAutorizacao)
      await expect(
        registrarAlertaManual(sujeito, { titulo: 'Forjado', severidade: 'BAIXA' }),
      ).rejects.toThrow(ErroDeAutorizacao)
      await expect(reconhecerAlerta(sujeito, id)).rejects.toThrow(ErroDeAutorizacao)
      await expect(registrarResolucaoDoAlerta(sujeito, id)).rejects.toThrow(ErroDeAutorizacao)
      await expect(criarFonteDeAlertas(sujeito, 'Forjada')).rejects.toThrow(ErroDeAutorizacao)
      await expect(revogarFonteDeAlertas(sujeito, fonte.id)).rejects.toThrow(ErroDeAutorizacao)
    }

    expect(await db.alerta.count()).toBe(1)
    expect((await db.alerta.findUniqueOrThrow({ where: { id } })).estado).toBe('ATIVO')
    expect(await db.eventoDeAlerta.count()).toBe(1)
    expect(await db.fonteDeAlertas.count()).toBe(1)
    expect(
      (await db.fonteDeAlertas.findUniqueOrThrow({ where: { id: fonte.id } })).revogadaEm,
    ).toBeNull()
  })
})
