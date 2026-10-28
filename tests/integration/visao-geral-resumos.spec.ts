import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import type { Indicador } from '@/modules/visao-geral/model'
import {
  obterResumoDeProjetos,
  obterIndicadoresDeInfraestrutura,
} from '@/modules/visao-geral/resumos'
import { limparBanco } from './banco-de-teste'
import {
  AGORA_DA_VISAO_GERAL,
  criarCenarioDaVisaoGeral,
  type CenarioDaVisaoGeral,
} from './fabricas/visao-geral'

let c: CenarioDaVisaoGeral

async function criarRecursos(): Promise<void> {
  const base = { identificadorExterno: null, descricao: null }
  await db.recurso.createMany({
    data: [
      { ...base, tipo: 'SERVIDOR', nome: 'VPS 1', nomeNormalizado: 'vps 1' },
      { ...base, tipo: 'SERVIDOR', nome: 'VPS 2', nomeNormalizado: 'vps 2' },
      { ...base, tipo: 'CONTAINER', nome: 'App', nomeNormalizado: 'app' },
      {
        ...base,
        tipo: 'BANCO',
        nome: 'Antigo',
        nomeNormalizado: 'antigo',
        arquivadoEm: AGORA_DA_VISAO_GERAL,
      },
    ],
  })
}

function indicador(indicadores: readonly Indicador[], rotulo: string): Indicador {
  const achado = indicadores.find((i) => i.rotulo === rotulo)
  if (!achado) throw new Error(`indicador ausente: ${rotulo}`)
  return achado
}

beforeEach(async () => {
  await limparBanco()
})

afterAll(async () => {
  await db.$disconnect()
})

describe('resumos da Visão Geral', () => {
  test('admin: Projetos ativos "2", Configuração incompleta "1", Milestones ativas "1", Homologações em andamento "2", GitHub "2 repositórios" / "1 indisponível"', async () => {
    c = await criarCenarioDaVisaoGeral(AGORA_DA_VISAO_GERAL)

    const resumo = await obterResumoDeProjetos(c.admin, c.agora)

    expect(resumo.escopo).toBe('global')
    expect(resumo.link).toEqual({ rotulo: 'Ver projetos', href: '/projetos' })
    expect(indicador(resumo.indicadores, 'Projetos ativos').valor).toBe('2')
    expect(indicador(resumo.indicadores, 'Configuração incompleta').valor).toBe('1')
    expect(indicador(resumo.indicadores, 'Milestones ativas').valor).toBe('1')
    expect(indicador(resumo.indicadores, 'Homologações em andamento').valor).toBe('2')
    expect(indicador(resumo.indicadores, 'GitHub')).toMatchObject({
      valor: '2 repositórios',
      detalhe: '1 indisponível',
      semDados: false,
    })
  })

  test('admin: Recursos "3" / "2 servidores · 1 container"; Alertas ativos "2" / "1 crítico · 1 reconhecido ainda ativo na origem"; Saúde dos recursos "Sem dados"', async () => {
    c = await criarCenarioDaVisaoGeral(AGORA_DA_VISAO_GERAL)
    await criarRecursos()

    const resumo = await obterIndicadoresDeInfraestrutura(c.admin)

    expect(resumo.link).toEqual({ rotulo: 'Abrir Infraestrutura', href: '/infraestrutura' })
    expect(indicador(resumo.indicadores, 'Recursos')).toMatchObject({
      valor: '3',
      detalhe: '2 servidores · 1 container',
    })
    expect(indicador(resumo.indicadores, 'Alertas ativos')).toMatchObject({
      valor: '2',
      detalhe: '1 crítico · 1 reconhecido ainda ativo na origem',
      semDados: false,
    })
    expect(indicador(resumo.indicadores, 'Saúde dos recursos')).toMatchObject({
      valor: 'Sem dados',
      semDados: true,
    })
  })

  test('banco vazio: GitHub, Alertas ativos e Saúde dos recursos "Sem dados"; Projetos ativos "0"', async () => {
    const admin = {
      usuarioId: '00000000-0000-4000-8000-000000000001',
      papeis: [{ papel: 'ADMIN' as const, clienteId: null }],
    }

    const projetos = await obterResumoDeProjetos(admin, AGORA_DA_VISAO_GERAL)
    const infra = await obterIndicadoresDeInfraestrutura(admin)

    expect(indicador(projetos.indicadores, 'Projetos ativos').valor).toBe('0')
    expect(indicador(projetos.indicadores, 'GitHub')).toMatchObject({
      valor: 'Sem dados',
      semDados: true,
    })
    expect(indicador(infra.indicadores, 'Alertas ativos')).toMatchObject({
      valor: 'Sem dados',
      semDados: true,
    })
    expect(indicador(infra.indicadores, 'Saúde dos recursos')).toMatchObject({
      valor: 'Sem dados',
      semDados: true,
    })
  })

  test('testadorA: Projetos dos seus clientes "1", Homologações em andamento "1"; obterResumoDeInfraestrutura lança ErroDeAutorizacao', async () => {
    c = await criarCenarioDaVisaoGeral(AGORA_DA_VISAO_GERAL)

    const resumo = await obterResumoDeProjetos(c.testadorA, c.agora)

    expect(resumo.escopo).toBe('cliente')
    expect(resumo.link).toEqual({ rotulo: 'Ver clientes', href: '/clientes' })
    expect(resumo.indicadores.map((i) => [i.rotulo, i.valor])).toEqual([
      ['Projetos dos seus clientes', '1'],
      ['Homologações em andamento', '1'],
    ])
    await expect(obterIndicadoresDeInfraestrutura(c.testadorA)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    const { obterResumoDeInfraestrutura } = await import('@/modules/infra/queries')
    await expect(obterResumoDeInfraestrutura(c.testadorA)).rejects.toBeInstanceOf(ErroDeAutorizacao)
  })
})
