import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { registrarIntegracao } from '@/modules/github/reconciliacao'
import {
  obterVisaoGeral,
  pendenciasDeAlerta,
  pendenciasDeAutorizacaoProd,
  pendenciasDeConfiguracao,
  pendenciasDeDivergencia,
  pendenciasDeIntegracao,
} from '@/modules/visao-geral/queries'
import type { EntradaDePendencias, TipoDePendencia } from '@/modules/visao-geral/model'
import { limparBanco } from './banco-de-teste'
import {
  ampliarCenarioDaVisaoGeral,
  criarCenarioDaVisaoGeral,
  AGORA_DA_VISAO_GERAL,
  type CenarioDaVisaoGeral,
} from './fabricas/visao-geral'

let c: CenarioDaVisaoGeral

beforeEach(async () => {
  await limparBanco()
  c = await criarCenarioDaVisaoGeral(AGORA_DA_VISAO_GERAL)
})

afterAll(async () => {
  await db.$disconnect()
})

function itensDe(entrada: EntradaDePendencias) {
  if ('falha' in entrada) throw new Error('entrada com falha')
  return entrada.itens
}

async function grupo(
  sujeito: CenarioDaVisaoGeral['admin'],
  tipo: TipoDePendencia,
  expandido = null,
) {
  const visao = await obterVisaoGeral(sujeito, {
    expandido: expandido as TipoDePendencia | null,
    agora: c.agora,
  })
  return visao.grupos.find((g) => g.tipo === tipo)
}

describe('pendências da Visão Geral', () => {
  test('admin: homologacao com 4 pendências na ordem HB triar (10-19), HA testar "2 issues" (10-20), HA disponibilizar #3 (10-22), HB retestar #2 (10-23); nada de M2', async () => {
    const g = (await grupo(c.admin, 'homologacao'))!
    expect(g.total).toBe(4)
    expect(g.itens.map((i) => [i.estado.texto, i.indicador, i.desde.toISOString()])).toEqual([
      ['Correção a triar', null, '2026-10-19T12:00:00.000Z'],
      ['Pendente de teste', '2 issues', '2026-10-20T12:00:00.000Z'],
      ['Aguardando disponibilização', null, '2026-10-22T12:00:00.000Z'],
      ['Aguardando reteste', null, '2026-10-23T12:00:00.000Z'],
    ])
    expect(g.itens[2]!.titulo).toBe('#3 Item 3 de portal')
    expect(JSON.stringify(g.itens)).not.toContain(c.milestoneArquivadaId)
  })

  test('admin: hrefs exatos — HA testar → /clientes/<A>/projetos/<P>/entregas/milestones/<M>?aba=homologacao; HB retestar → /clientes/<B>/projetos/<P>/entregas/issues/<#2 portal>', async () => {
    const g = (await grupo(c.admin, 'homologacao'))!
    expect(g.itens[1]!.href).toBe(
      `/clientes/${c.clienteAId}/projetos/${c.projetoPId}/entregas/milestones/${c.milestoneId}?aba=homologacao`,
    )
    expect(g.itens[3]!.href).toBe(
      `/clientes/${c.clienteBId}/projetos/${c.projetoPId}/entregas/issues/${c.issuePortal[2]}?milestone=${c.milestoneId}`,
    )
  })

  test('homologacao: solicitação ABERTA com tarefa PENDENTE não é mais "triar"; RESPONDIDA_SEM_TAREFA vira "Reteste a confirmar"', async () => {
    const solicitacao = await db.solicitacaoDeCorrecao.findFirstOrThrow()
    await db.tarefaGitHub.create({
      data: {
        tipo: 'REABRIR_ISSUE',
        repositorioId: c.portalId,
        dados: {},
        estado: 'PENDENTE',
        solicitadaPorId: c.admin.usuarioId,
        solicitacaoId: solicitacao.id,
      },
    })
    let g = (await grupo(c.admin, 'homologacao'))!
    expect(g.itens.map((i) => i.estado.texto)).not.toContain('Correção a triar')

    await db.tarefaGitHub.updateMany({ data: { estado: 'FALHOU' } })
    g = (await grupo(c.admin, 'homologacao'))!
    expect(g.itens.map((i) => i.estado.texto)).toContain('Correção a triar')

    await db.solicitacaoDeCorrecao.update({
      where: { id: solicitacao.id },
      data: { estado: 'RESPONDIDA_SEM_TAREFA' },
    })
    g = (await grupo(c.admin, 'homologacao'))!
    expect(g.itens.map((i) => i.estado.texto)).toContain('Reteste a confirmar')
  })

  test('autorizacao-prod: só C1, título "Autorizar v1.4.0 em PROD", href /projetos/<P>/publicacoes?versao=<V1>; C0 superada e C3 autorizada não aparecem', async () => {
    const itens = itensDe(await pendenciasDeAutorizacaoProd(c.admin))
    expect(itens).toHaveLength(1)
    expect(itens[0]!.id).toBe(`autorizacao-prod:${c.composicoes.c1}`)
    expect(itens[0]!.titulo).toBe('Autorizar v1.4.0 em PROD')
    expect(itens[0]!.href).toBe(`/projetos/${c.projetoPId}/publicacoes?versao=${c.versoes.v1}`)
  })

  test('autorizacao-prod: versão alvo com evidência SUCESSO em PROD deixa de ser pendente; AutorizacaoProd revogada volta a pendente', async () => {
    await db.evidenciaDeploy.create({
      data: {
        ambienteId: c.ambienteProdId,
        versaoId: c.versoes.v1,
        origem: 'MANUAL',
        situacao: 'SUCESSO',
        ocorridaEm: c.agora,
      },
    })
    expect(itensDe(await pendenciasDeAutorizacaoProd(c.admin))).toHaveLength(0)

    await db.autorizacaoProd.updateMany({ data: { revogadaEm: c.agora } })
    const itens = itensDe(await pendenciasDeAutorizacaoProd(c.admin))
    expect(itens.map((i) => i.id)).toEqual([`autorizacao-prod:${c.composicoes.c3}`])
  })

  test('divergencia: só D1 com href /projetos/<P>/publicacoes#divergencia-<D1>; alerta: [AL2, AL1], total 2, href /infraestrutura/alertas#alerta-<AL2>', async () => {
    const divergencias = await pendenciasDeDivergencia(c.admin)
    expect(itensDe(divergencias).map((i) => i.href)).toEqual([
      `/projetos/${c.projetoPId}/publicacoes#divergencia-${c.divergencias.d1}`,
    ])

    const alertas = await grupo(c.admin, 'alerta')
    expect(alertas!.total).toBe(2)
    expect(alertas!.itens.map((i) => i.id)).toEqual([
      `alerta:${c.alertas.al2}`,
      `alerta:${c.alertas.al1}`,
    ])
    expect(alertas!.itens[0]!.href).toBe(`/infraestrutura/alertas#alerta-${c.alertas.al2}`)
  })

  test('integracao: 1 pendência "GitHub — Projeto P", Indisponível, href /projetos/<P>/configuracao#repositorios; com IntegracaoGitHub.configurada false → nenhuma e fontesSemDados contém "GitHub: integração não configurada."', async () => {
    const itens = itensDe(await pendenciasDeIntegracao(c.admin, c.agora))
    expect(itens).toHaveLength(1)
    expect(itens[0]!.titulo).toBe('GitHub — Projeto P')
    expect(itens[0]!.estado).toEqual({ texto: 'Indisponível', tom: 'erro' })
    expect(itens[0]!.href).toBe(`/projetos/${c.projetoPId}/configuracao#repositorios`)

    await registrarIntegracao(null)
    expect(itensDe(await pendenciasDeIntegracao(c.admin, c.agora))).toHaveLength(0)
    const visao = await obterVisaoGeral(c.admin, { expandido: null, agora: c.agora })
    expect(visao.fontesSemDados).toContain('GitHub: integração não configurada.')
    expect(visao.fontesSemDados).toContain('Alertas: nenhuma fonte de alertas configurada.')
  })

  test('configuracao: só Projeto Q, "Falta: Clientes, GitHub, Ambientes, Milestones", "Não configurado", href /projetos/<Q>; Projeto R arquivado ausente', async () => {
    const itens = itensDe(await pendenciasDeConfiguracao(c.admin))
    expect(itens).toHaveLength(1)
    expect(itens[0]!.id).toBe(`configuracao:${c.projetoQId}`)
    expect(itens[0]!.contexto).toBe('Falta: Clientes, GitHub, Ambientes, Milestones')
    expect(itens[0]!.estado.texto).toBe('Não configurado')
    expect(itens[0]!.href).toBe(`/projetos/${c.projetoQId}`)
  })

  test('testadorA: obterVisaoGeral devolve só o grupo homologacao com 1 pendência (HA testar) e fontesSemDados []; nenhum id de B, de alerta ou de projeto Q no JSON serializado', async () => {
    const visao = await obterVisaoGeral(c.testadorA, { expandido: null, agora: c.agora })
    expect(visao.escopo).toBe('cliente')
    expect(visao.fontesSemDados).toEqual([])
    expect(visao.grupos.map((g) => [g.tipo, g.total])).toEqual([['homologacao', 1]])
    expect(visao.grupos[0]!.itens[0]!.estado.texto).toBe('Pendente de teste')

    const json = JSON.stringify(visao)
    for (const proibido of [
      c.clienteBId,
      c.projetoQId,
      c.projetoRId,
      c.alertas.al1,
      c.alertas.al2,
      c.divergencias.d1,
      c.composicoes.c1,
    ]) {
      expect(json).not.toContain(proibido)
    }
  })

  test('aprovadorB: só HB retestar; pendenciasDeAlerta, pendenciasDeAutorizacaoProd, pendenciasDeDivergencia, pendenciasDeIntegracao e pendenciasDeConfiguracao lançam ErroDeAutorizacao para testadorA e aprovadorB', async () => {
    const visao = await obterVisaoGeral(c.aprovadorB, { expandido: null, agora: c.agora })
    expect(visao.grupos).toHaveLength(1)
    expect(visao.grupos[0]!.itens.map((i) => i.estado.texto)).toEqual(['Aguardando reteste'])

    for (const sujeito of [c.testadorA, c.aprovadorB]) {
      await expect(pendenciasDeAlerta(sujeito)).rejects.toBeInstanceOf(ErroDeAutorizacao)
      await expect(pendenciasDeAutorizacaoProd(sujeito)).rejects.toBeInstanceOf(ErroDeAutorizacao)
      await expect(pendenciasDeDivergencia(sujeito)).rejects.toBeInstanceOf(ErroDeAutorizacao)
      await expect(pendenciasDeIntegracao(sujeito, c.agora)).rejects.toBeInstanceOf(
        ErroDeAutorizacao,
      )
      await expect(pendenciasDeConfiguracao(sujeito)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    }
  })

  test('com 7 milestones extras em P, cada uma com homologação de A e um item PENDENTE_DE_TESTE: expandido homologacao → 11 itens, total 11 e recolher; sem expandir → 5 itens e "Ver todas (11)"', async () => {
    await ampliarCenarioDaVisaoGeral(c, 7)

    const expandido = (await grupo(c.admin, 'homologacao', 'homologacao' as never))!
    expect(expandido.itens).toHaveLength(11)
    expect(expandido.total).toBe(11)
    expect(expandido.recolher).not.toBeNull()

    const recolhido = (await grupo(c.admin, 'homologacao'))!
    expect(recolhido.itens).toHaveLength(5)
    expect(recolhido.verTodas?.rotulo).toBe('Ver todas (11)')
  })
})
