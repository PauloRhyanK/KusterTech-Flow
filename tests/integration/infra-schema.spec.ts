import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { limparBanco } from './banco-de-teste'

async function codigoDoErro(promessa: Promise<unknown>): Promise<string | undefined> {
  try {
    await promessa
  } catch (erro) {
    return (erro as { code?: string }).code
  }
  return undefined
}

describe('schema de infraestrutura', () => {
  beforeEach(async () => {
    await limparBanco()
  })

  test('as tabelas Alerta, EventoDeAlerta e FonteDeAlertas não existem', async () => {
    const r = await db.$queryRaw<
      { n: bigint }[]
    >`select count(*)::bigint n from information_schema.tables
      where table_name in ('Alerta','EventoDeAlerta','FonteDeAlertas')`
    expect(Number(r[0]?.n)).toBe(0)
  })

  test('Recurso grava provedor, endereço, especificação e custo mensal', async () => {
    const criado = await db.recurso.create({
      data: {
        tipo: 'SERVIDOR',
        nome: 'VPS 01',
        nomeNormalizado: 'vps 01',
        provedor: 'Hetzner',
        endereco: 'vps-01.exemplo.test',
        especificacao: '2 vCPU · 4 GB',
        custoMensal: '48.50',
      },
    })
    const lido = await db.recurso.findUniqueOrThrow({ where: { id: criado.id } })
    expect(lido).toMatchObject({
      provedor: 'Hetzner',
      endereco: 'vps-01.exemplo.test',
      especificacao: '2 vCPU · 4 GB',
    })
    expect(lido.custoMensal?.toFixed(2)).toBe('48.50')
  })

  test('nomeNormalizado repetido falha com P2002; excluir projeto apaga RecursoProjeto', async () => {
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

    await db.projeto.delete({ where: { id: projeto.id } })
    expect(await db.recursoProjeto.count()).toBe(0)
  })

  test('identificadorExterno repetido falha com P2002; recurso hospedado trava a exclusão do servidor', async () => {
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

    const servidor = await db.recurso.create({
      data: { tipo: 'SERVIDOR', nome: 'vps', nomeNormalizado: 'vps' },
    })
    await db.recurso.create({
      data: { tipo: 'CONTAINER', nome: 'c', nomeNormalizado: 'c', hospedadoEmId: servidor.id },
    })
    expect(await codigoDoErro(db.recurso.delete({ where: { id: servidor.id } }))).toBe('P2003')
  })
})
