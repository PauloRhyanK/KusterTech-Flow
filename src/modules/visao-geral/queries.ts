import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { podeVerVisaoGlobal, idsVisiveis } from '@/modules/clientes/model'
import { estadoDoRepositorio, resumirErroParaLog } from '@/modules/github/model'
import { intervaloDaIntegracao } from '@/modules/github/service'
import { calcularChecklist } from '@/modules/projetos/model'
import {
  LIMITE_EXPANDIDO,
  agruparHomologacoes,
  pendenciaDeAlerta,
  pendenciaDeAutorizacao,
  pendenciaDeConfiguracao,
  pendenciaDeDivergencia,
  pendenciaDeIntegracao,
  priorizarPendencias,
  tiposDePendenciaVisiveis,
  type EntradaDePendencias,
  type GrupoDePendencias,
  type LinhaDeHomologacao,
  type Pendencia,
  type TipoDePendencia,
} from './model'

const ID_INTEGRACAO = 'github'

function entrada(tipo: TipoDePendencia, itens: Pendencia[], total = itens.length) {
  return { tipo, itens, total } satisfies EntradaDePendencias
}

export async function pendenciasDeHomologacao(sujeito: Sujeito): Promise<EntradaDePendencias> {
  exigirPermissao(sujeito, 'clientes.ler')
  const clientes = idsVisiveis(sujeito)

  const itens = await db.homologacaoItem.findMany({
    where: {
      estado: {
        in: [
          'AGUARDANDO_DISPONIBILIZACAO',
          'PENDENTE_DE_TESTE',
          'CORRECAO_SOLICITADA',
          'AGUARDANDO_RETESTE',
        ],
      },
      homologacao: {
        milestone: { arquivadaEm: null, projeto: { arquivadoEm: null } },
        cliente: { arquivadoEm: null, ...(clientes ? { id: { in: [...clientes] } } : {}) },
      },
    },
    select: {
      id: true,
      homologacaoId: true,
      estado: true,
      atualizadoEm: true,
      issue: { select: { id: true, numero: true, titulo: true } },
      homologacao: {
        select: {
          cliente: { select: { id: true, nome: true } },
          milestone: {
            select: { id: true, titulo: true, projeto: { select: { id: true, nome: true } } },
          },
        },
      },
      solicitacoes: {
        where: { estado: { in: ['ABERTA', 'RESPONDIDA_SEM_TAREFA'] } },
        orderBy: { criadoEm: 'desc' },
        take: 1,
        select: {
          estado: true,
          tarefasGitHub: { where: { estado: 'PENDENTE' }, take: 1, select: { id: true } },
        },
      },
    },
  })

  const linhas: LinhaDeHomologacao[] = itens.map((i) => {
    const solicitacao = i.solicitacoes[0]
    return {
      itemId: i.id,
      homologacaoId: i.homologacaoId,
      estado: i.estado,
      solicitacao:
        solicitacao?.estado === 'ABERTA' || solicitacao?.estado === 'RESPONDIDA_SEM_TAREFA'
          ? solicitacao.estado
          : null,
      temTarefaPendente: (solicitacao?.tarefasGitHub.length ?? 0) > 0,
      atualizadoEm: i.atualizadoEm,
      cliente: i.homologacao.cliente,
      projeto: i.homologacao.milestone.projeto,
      milestone: { id: i.homologacao.milestone.id, titulo: i.homologacao.milestone.titulo },
      issue: i.issue,
    }
  })

  return entrada('homologacao', agruparHomologacoes(linhas, sujeito))
}

export async function pendenciasDeAutorizacaoProd(sujeito: Sujeito): Promise<EntradaDePendencias> {
  exigirPermissao(sujeito, 'publicacao.autorizar')

  // A mais recente de cada repositório; o resto é filtrado em memória.
  const composicoes = await db.composicaoDePublicacao.findMany({
    where: { projeto: { arquivadoEm: null } },
    distinct: ['repositorioId'],
    orderBy: [{ repositorioId: 'asc' }, { calculadaEm: 'desc' }],
    select: {
      id: true,
      estado: true,
      calculadaEm: true,
      projeto: { select: { id: true, nome: true } },
      repositorio: { select: { nomeCompleto: true } },
      autorizacoes: { where: { revogadaEm: null }, take: 1, select: { id: true } },
      versaoAlvo: {
        select: {
          id: true,
          rotulo: true,
          evidencias: {
            where: { situacao: 'SUCESSO', ambiente: { tipo: 'PROD' } },
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  })

  const itens = composicoes
    .filter((c) => c.autorizacoes.length === 0 && c.versaoAlvo.evidencias.length === 0)
    .map((c) =>
      pendenciaDeAutorizacao({
        composicaoId: c.id,
        estado: c.estado,
        calculadaEm: c.calculadaEm,
        projeto: c.projeto,
        repositorio: c.repositorio.nomeCompleto,
        versao: { id: c.versaoAlvo.id, rotulo: c.versaoAlvo.rotulo },
      }),
    )
  return entrada('autorizacao-prod', itens)
}

export async function pendenciasDeDivergencia(sujeito: Sujeito): Promise<EntradaDePendencias> {
  exigirPermissao(sujeito, 'publicacao.autorizar')
  const where = { reconhecidaEm: null, versao: { projeto: { arquivadoEm: null } } }

  const [divergencias, total] = await Promise.all([
    db.divergenciaDeDeploy.findMany({
      where,
      orderBy: [{ detectadaEm: 'asc' }, { id: 'asc' }],
      take: LIMITE_EXPANDIDO,
      select: {
        id: true,
        detectadaEm: true,
        versao: {
          select: {
            rotulo: true,
            projeto: { select: { id: true, nome: true } },
            repositorio: { select: { nomeCompleto: true } },
          },
        },
      },
    }),
    db.divergenciaDeDeploy.count({ where }),
  ])

  return entrada(
    'divergencia',
    divergencias.map((d) =>
      pendenciaDeDivergencia({
        id: d.id,
        detectadaEm: d.detectadaEm,
        projeto: d.versao.projeto,
        repositorio: d.versao.repositorio.nomeCompleto,
        rotulo: d.versao.rotulo,
      }),
    ),
    total,
  )
}

export async function pendenciasDeAlerta(sujeito: Sujeito): Promise<EntradaDePendencias> {
  exigirPermissao(sujeito, 'infraestrutura.ler')
  const where = { estado: 'ATIVO' } as const

  const [alertas, total] = await Promise.all([
    db.alerta.findMany({
      where,
      orderBy: [{ severidade: 'asc' }, { primeiraOcorrenciaEm: 'asc' }, { id: 'asc' }],
      take: LIMITE_EXPANDIDO,
      select: {
        id: true,
        titulo: true,
        severidade: true,
        primeiraOcorrenciaEm: true,
        ocorrencias: true,
        recurso: { select: { nome: true } },
        projeto: { select: { nome: true } },
      },
    }),
    db.alerta.count({ where }),
  ])

  return entrada(
    'alerta',
    alertas.map((a) =>
      pendenciaDeAlerta({
        id: a.id,
        titulo: a.titulo,
        severidade: a.severidade,
        primeiraOcorrenciaEm: a.primeiraOcorrenciaEm,
        ocorrencias: a.ocorrencias,
        recurso: a.recurso?.nome ?? null,
        projeto: a.projeto?.nome ?? null,
      }),
    ),
    total,
  )
}

export async function pendenciasDeIntegracao(
  sujeito: Sujeito,
  agora: Date,
): Promise<EntradaDePendencias> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const [integracao, repositorios] = await Promise.all([
    db.integracaoGitHub.findUnique({ where: { id: ID_INTEGRACAO } }),
    db.repositorioGitHub.findMany({
      where: { projeto: { arquivadoEm: null } },
      select: {
        projeto: { select: { id: true, nome: true } },
        sincronizadoEm: true,
        ultimaFalhaEm: true,
        removidoDaInstalacaoEm: true,
      },
    }),
  ])
  if (!integracao?.configurada) {
    return entrada('integracao', [])
  }

  const intervalo = intervaloDaIntegracao()
  const porProjeto = new Map<
    string,
    {
      projeto: { id: string; nome: string }
      repositorios: {
        estado: ReturnType<typeof estadoDoRepositorio>
        sincronizadoEm: Date | null
      }[]
    }
  >()
  for (const r of repositorios) {
    if (!r.projeto) continue
    const atual = porProjeto.get(r.projeto.id) ?? { projeto: r.projeto, repositorios: [] }
    atual.repositorios.push({
      estado: estadoDoRepositorio(r, agora, intervalo),
      sincronizadoEm: r.sincronizadoEm,
    })
    porProjeto.set(r.projeto.id, atual)
  }

  const itens = [...porProjeto.values()].flatMap(({ projeto, repositorios: repos }) => {
    const pendencia = pendenciaDeIntegracao(projeto, repos)
    return pendencia ? [pendencia] : []
  })
  return entrada('integracao', itens)
}

export async function pendenciasDeConfiguracao(sujeito: Sujeito): Promise<EntradaDePendencias> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const projetos = await db.projeto.findMany({
    where: { arquivadoEm: null },
    select: {
      id: true,
      nome: true,
      criadoEm: true,
      _count: {
        select: {
          clientes: true,
          repositorios: true,
          ambientes: true,
          milestones: { where: { arquivadaEm: null } },
        },
      },
    },
  })

  const itens = projetos.flatMap((p) => {
    // Só o item "pendente" interessa; o estado da integração não o altera.
    const checklist = calcularChecklist(p._count, null, 'nao-configurada')
    const pendencia = pendenciaDeConfiguracao(p, checklist)
    return pendencia ? [pendencia] : []
  })
  return entrada('configuracao', itens)
}

export interface VisaoGeral {
  escopo: 'global' | 'cliente'
  grupos: GrupoDePendencias[]
  fontesSemDados: string[]
}

async function fontesSemDados(visiveis: readonly TipoDePendencia[]): Promise<string[]> {
  const faltas: string[] = []
  const [integracao, fontes] = await Promise.all([
    visiveis.includes('integracao')
      ? db.integracaoGitHub.findUnique({ where: { id: ID_INTEGRACAO } })
      : Promise.resolve(undefined),
    visiveis.includes('alerta')
      ? db.fonteDeAlertas.count({ where: { revogadaEm: null } })
      : Promise.resolve(undefined),
  ])
  if (integracao !== undefined && !integracao?.configurada) {
    faltas.push('GitHub: integração não configurada.')
  }
  if (fontes === 0) {
    faltas.push('Alertas: nenhuma fonte de alertas configurada.')
  }
  return faltas
}

export async function obterVisaoGeral(
  sujeito: Sujeito,
  opcoes: { expandido: TipoDePendencia | null; agora: Date },
): Promise<VisaoGeral> {
  const visiveis = tiposDePendenciaVisiveis(sujeito)
  const consultas: Record<TipoDePendencia, () => Promise<EntradaDePendencias>> = {
    homologacao: () => pendenciasDeHomologacao(sujeito),
    'autorizacao-prod': () => pendenciasDeAutorizacaoProd(sujeito),
    divergencia: () => pendenciasDeDivergencia(sujeito),
    alerta: () => pendenciasDeAlerta(sujeito),
    integracao: () => pendenciasDeIntegracao(sujeito, opcoes.agora),
    configuracao: () => pendenciasDeConfiguracao(sujeito),
  }

  const [resultados, faltas] = await Promise.all([
    Promise.allSettled(visiveis.map((tipo) => consultas[tipo]())),
    fontesSemDados(visiveis).catch((err: unknown) => {
      log.error({ erro: resumirErroParaLog(err) }, 'consulta das fontes da visão geral falhou')
      return []
    }),
  ])

  const entradas = resultados.map((r, i): EntradaDePendencias => {
    const tipo = visiveis[i]!
    if (r.status === 'fulfilled') {
      return r.value
    }
    log.error({ erro: resumirErroParaLog(r.reason), tipo }, 'consulta da visão geral falhou')
    return { tipo, falha: true }
  })

  return {
    escopo: podeVerVisaoGlobal(sujeito) ? 'global' : 'cliente',
    grupos: priorizarPendencias(entradas, opcoes.expandido),
    fontesSemDados: faltas,
  }
}
