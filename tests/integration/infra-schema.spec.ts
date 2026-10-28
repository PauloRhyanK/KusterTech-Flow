import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-10-28T15:00:00.000Z')

async function codigoDoErro(promessa: Promise<unknown>): Promise<string | undefined> {
  try {
    await promessa
  } catch (erro) {
    return (erro as { code?: string }).code
  }
  return undefined
}

function dadosDeAlerta(chaveDedupe: string, extra: Record<string, unknown> = {}) {
  return {
    chaveDedupe,
    origem: 'MANUAL' as const,
    titulo: 'Disco quase cheio',
    severidade: 'ALTA' as const,
    estado: 'ATIVO' as const,
    primeiraOcorrenciaEm: agora,
    ultimaOcorrenciaEm: agora,
    ocorrencias: 1,
    ...extra,
  }
}

describe('schema de infraestrutura', () => {
  beforeEach(async () => {
    await limparBanco()
  })

  test('chaveDedupe repetida e nomeNormalizado repetido falham com P2002; excluir projeto apaga RecursoProjeto e zera Alerta.projetoId; excluir recurso com alerta falha (RESTRICT)', async () => {
    await db.recurso.create({
      data: { tipo: 'SERVIDOR', nome: 'VPS 01', nomeNormalizado: 'vps 01' },
    })
    expect(
      await codigoDoErro(
        db.recurso.create({
          data: { tipo: 'CONTAINER', nome: 'vps  01', nomeNormalizado: 'vps 01' },
        }),
      ),
    ).toBe('P2002')

    const recurso = await db.recurso.create({
      data: { tipo: 'CONTAINER', nome: 'api', nomeNormalizado: 'api' },
    })
    const projeto = await db.projeto.create({
      data: { nome: 'Projeto A', nomeNormalizado: 'projeto a' },
    })
    await db.recursoProjeto.create({ data: { recursoId: recurso.id, projetoId: projeto.id } })

    const alerta = await db.alerta.create({
      data: dadosDeAlerta('manual:1', { recursoId: recurso.id, projetoId: projeto.id }),
    })
    expect(await codigoDoErro(db.alerta.create({ data: dadosDeAlerta('manual:1') }))).toBe('P2002')

    await db.projeto.delete({ where: { id: projeto.id } })
    expect(await db.recursoProjeto.count()).toBe(0)
    expect((await db.alerta.findUniqueOrThrow({ where: { id: alerta.id } })).projetoId).toBeNull()

    expect(await codigoDoErro(db.recurso.delete({ where: { id: recurso.id } }))).toBe('P2003')
    expect(await db.recurso.count({ where: { id: recurso.id } })).toBe(1)
  })

  test('identificadorExterno e tokenHash repetidos falham com P2002; excluir alerta apaga o histórico; recurso hospedado trava a exclusão do servidor', async () => {
    const autor = await db.usuario.create({
      data: { email: 'admin@exemplo.test', nome: 'Admin', senhaHash: 'hash' },
    })
    await db.recurso.create({
      data: { tipo: 'SERVIDOR', nome: 'a', nomeNormalizado: 'a', identificadorExterno: 'host-1' },
    })
    expect(
      await codigoDoErro(
        db.recurso.create({
          data: {
            tipo: 'SERVIDOR',
            nome: 'b',
            nomeNormalizado: 'b',
            identificadorExterno: 'host-1',
          },
        }),
      ),
    ).toBe('P2002')

    await db.fonteDeAlertas.create({
      data: { nome: 'Fonte 1', tokenHash: 'h'.repeat(64), criadaPorId: autor.id },
    })
    expect(
      await codigoDoErro(
        db.fonteDeAlertas.create({
          data: { nome: 'Fonte 2', tokenHash: 'h'.repeat(64), criadaPorId: autor.id },
        }),
      ),
    ).toBe('P2002')

    const alerta = await db.alerta.create({ data: dadosDeAlerta('manual:2') })
    await db.eventoDeAlerta.create({ data: { alertaId: alerta.id, tipo: 'CRIADO', autorId: null } })
    await db.alerta.delete({ where: { id: alerta.id } })
    expect(await db.eventoDeAlerta.count()).toBe(0)

    const servidor = await db.recurso.create({
      data: { tipo: 'SERVIDOR', nome: 'vps', nomeNormalizado: 'vps' },
    })
    await db.recurso.create({
      data: { tipo: 'CONTAINER', nome: 'c', nomeNormalizado: 'c', hospedadoEmId: servidor.id },
    })
    expect(await codigoDoErro(db.recurso.delete({ where: { id: servidor.id } }))).toBe('P2003')
  })

  test('a ordem dos enums é a ordem da fila: severidade e estado ordenam pela declaração', async () => {
    await db.alerta.create({ data: dadosDeAlerta('k1', { severidade: 'BAIXA' }) })
    await db.alerta.create({ data: dadosDeAlerta('k2', { severidade: 'CRITICA' }) })
    await db.alerta.create({
      data: dadosDeAlerta('k3', { severidade: 'CRITICA', estado: 'RECONHECIDO' }),
    })
    const fila = await db.alerta.findMany({
      orderBy: [{ severidade: 'asc' }, { estado: 'asc' }],
    })
    expect(fila.map((a) => a.chaveDedupe)).toEqual(['k2', 'k3', 'k1'])
  })
})
