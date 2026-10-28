import type { Prisma } from '@prisma/client'
import { cache } from 'react'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import {
  type EstadoAlerta,
  linksDeFerramentas,
  resumoDeSaude,
  type OrigemAlerta,
  type SeveridadeAlerta,
  situacaoDoRecurso,
  type TipoRecurso,
} from './model'

const LIMITE_DA_LISTA = 100
const TIPOS: readonly TipoRecurso[] = ['SERVIDOR', 'CONTAINER', 'BANCO', 'STORAGE', 'OUTRO']
const SITUACOES = ['todas', 'com-alerta', 'sem-dados', 'arquivados'] as const

export interface FiltrosDoInventario {
  tipo: TipoRecurso | null
  projetoId: string | null
  situacao: (typeof SITUACOES)[number]
}

function primeiro(valor: string | string[] | undefined): string {
  return ((Array.isArray(valor) ? valor[0] : valor) ?? '').trim()
}

export function lerFiltrosDoInventario(
  sp: Record<string, string | string[] | undefined>,
): FiltrosDoInventario {
  const tipo = primeiro(sp.tipo)
  const situacao = primeiro(sp.situacao)
  const projeto = primeiro(sp.projeto)
  return {
    tipo: TIPOS.find((t) => t === tipo) ?? null,
    projetoId: projeto === '' ? null : projeto.slice(0, 64),
    situacao: SITUACOES.find((s) => s === situacao) ?? 'todas',
  }
}

const NAO_RESOLVIDO = { estado: { not: 'RESOLVIDO_NA_ORIGEM' } } as const

export interface RecursoNaLista {
  id: string
  nome: string
  tipo: TipoRecurso
  hospedadoEm: { id: string; nome: string } | null
  totalDeProjetos: number
  situacao: ReturnType<typeof situacaoDoRecurso>
}

export async function listarRecursos(
  sujeito: Sujeito,
  filtros: FiltrosDoInventario,
): Promise<{
  recursos: RecursoNaLista[]
  total: number
  projetos: { id: string; nome: string }[]
}> {
  exigirPermissao(sujeito, 'infraestrutura.ler')

  const where: Prisma.RecursoWhereInput = {
    arquivadoEm: filtros.situacao === 'arquivados' ? { not: null } : null,
  }
  if (filtros.tipo !== null) {
    where.tipo = filtros.tipo
  }
  if (filtros.projetoId !== null) {
    where.projetos = { some: { projetoId: filtros.projetoId } }
  }
  if (filtros.situacao === 'com-alerta') {
    where.alertas = { some: NAO_RESOLVIDO }
  } else if (filtros.situacao === 'sem-dados') {
    where.alertas = { none: NAO_RESOLVIDO }
  }

  const [linhas, total, projetos] = await Promise.all([
    db.recurso.findMany({
      where,
      orderBy: { nomeNormalizado: 'asc' },
      take: LIMITE_DA_LISTA,
      select: {
        id: true,
        nome: true,
        tipo: true,
        arquivadoEm: true,
        hospedadoEm: { select: { id: true, nome: true } },
        alertas: { where: NAO_RESOLVIDO, select: { severidade: true } },
        _count: { select: { projetos: true } },
      },
    }),
    db.recurso.count({ where }),
    db.projeto.findMany({ orderBy: { nome: 'asc' }, select: { id: true, nome: true } }),
  ])

  return {
    recursos: linhas.map((r) => ({
      id: r.id,
      nome: r.nome,
      tipo: r.tipo,
      hospedadoEm: r.hospedadoEm,
      totalDeProjetos: r._count.projetos,
      situacao: situacaoDoRecurso({
        arquivado: r.arquivadoEm !== null,
        alertasNaoResolvidos: r.alertas,
      }),
    })),
    total,
    projetos,
  }
}

export interface RecursoDetalhado {
  id: string
  tipo: TipoRecurso
  nome: string
  identificadorExterno: string | null
  descricao: string | null
  urlBeszel: string | null
  urlGlitchTip: string | null
  urlHostDocker: string | null
  arquivadoEm: Date | null
  hospedadoEm: { id: string; nome: string } | null
  hospedados: { id: string; nome: string; tipo: TipoRecurso; arquivado: boolean }[]
  projetos: { id: string; nome: string; arquivado: boolean }[]
  projetosDisponiveis: { id: string; nome: string }[]
  ferramentas: { rotulo: string; href: string }[]
  situacao: ReturnType<typeof situacaoDoRecurso>
}

export async function obterRecurso(sujeito: Sujeito, recursoId: string): Promise<RecursoDetalhado> {
  exigirPermissao(sujeito, 'infraestrutura.ler')

  const recurso = await db.recurso.findUnique({
    where: { id: recursoId },
    include: {
      hospedadoEm: { select: { id: true, nome: true } },
      hospedados: { orderBy: { nomeNormalizado: 'asc' } },
      projetos: {
        select: { projeto: { select: { id: true, nome: true, arquivadoEm: true } } },
      },
      alertas: { where: NAO_RESOLVIDO, select: { severidade: true } },
    },
  })
  if (!recurso) {
    throw new ErroDeDominio('Recurso não encontrado.')
  }

  const projetos = recurso.projetos
    .map((v) => ({
      id: v.projeto.id,
      nome: v.projeto.nome,
      arquivado: v.projeto.arquivadoEm !== null,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  const idsAssociados = projetos.map((p) => p.id)

  const [repositorios, projetosDisponiveis] = await Promise.all([
    db.repositorioGitHub.findMany({
      where: { projetoId: { in: idsAssociados } },
      select: { nomeCompleto: true, urlHtml: true },
    }),
    db.projeto.findMany({
      where: { arquivadoEm: null, id: { notIn: idsAssociados } },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true },
    }),
  ])

  return {
    id: recurso.id,
    tipo: recurso.tipo,
    nome: recurso.nome,
    identificadorExterno: recurso.identificadorExterno,
    descricao: recurso.descricao,
    urlBeszel: recurso.urlBeszel,
    urlGlitchTip: recurso.urlGlitchTip,
    urlHostDocker: recurso.urlHostDocker,
    arquivadoEm: recurso.arquivadoEm,
    hospedadoEm: recurso.hospedadoEm,
    hospedados: recurso.hospedados.map((h) => ({
      id: h.id,
      nome: h.nome,
      tipo: h.tipo,
      arquivado: h.arquivadoEm !== null,
    })),
    projetos,
    projetosDisponiveis,
    ferramentas: linksDeFerramentas(recurso, repositorios),
    situacao: situacaoDoRecurso({
      arquivado: recurso.arquivadoEm !== null,
      alertasNaoResolvidos: recurso.alertas,
    }),
  }
}

// A página e o generateMetadata leem o recurso uma vez por requisição (sujeito vem de obterSessao, também em cache).
export const obterRecursoDaPagina = cache(obterRecurso)

export async function listarHospedeirosDisponiveis(
  sujeito: Sujeito,
  excetoRecursoId?: string,
): Promise<{ id: string; nome: string }[]> {
  exigirPermissao(sujeito, 'infraestrutura.ler')

  return db.recurso.findMany({
    where: {
      tipo: 'SERVIDOR',
      arquivadoEm: null,
      ...(excetoRecursoId ? { id: { not: excetoRecursoId } } : {}),
    },
    orderBy: { nomeNormalizado: 'asc' },
    select: { id: true, nome: true },
  })
}

const FILTROS_DE_ESTADO = [
  'nao-resolvidos',
  'ativos',
  'reconhecidos',
  'resolvidos',
  'todos',
] as const
const SEVERIDADES: readonly SeveridadeAlerta[] = ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA']

export interface FiltrosDeAlertas {
  estado: (typeof FILTROS_DE_ESTADO)[number]
  severidade: SeveridadeAlerta | null
}

export function lerFiltrosDeAlertas(
  sp: Record<string, string | string[] | undefined>,
): FiltrosDeAlertas {
  const estado = primeiro(sp.estado)
  const severidade = primeiro(sp.severidade)
  return {
    estado: FILTROS_DE_ESTADO.find((e) => e === estado) ?? 'nao-resolvidos',
    severidade: SEVERIDADES.find((s) => s === severidade) ?? null,
  }
}

// Ordem da fila (decisão 12): o Postgres ordena enums pela ordem de declaração no schema.
const ORDEM_DA_FILA = [
  { severidade: 'asc' },
  { estado: 'asc' },
  { ultimaOcorrenciaEm: 'desc' },
] as const satisfies Prisma.AlertaOrderByWithRelationInput[]

const SELECT_DA_LISTA = {
  id: true,
  titulo: true,
  severidade: true,
  estado: true,
  origem: true,
  ocorrencias: true,
  ultimaOcorrenciaEm: true,
  recurso: { select: { id: true, nome: true } },
} as const satisfies Prisma.AlertaSelect

export interface AlertaNaLista {
  id: string
  titulo: string
  severidade: SeveridadeAlerta
  estado: EstadoAlerta
  origem: OrigemAlerta
  ocorrencias: number
  ultimaOcorrenciaEm: Date
  recurso: { id: string; nome: string } | null
}

function estadosDoFiltro(estado: FiltrosDeAlertas['estado']): Prisma.AlertaWhereInput {
  switch (estado) {
    case 'nao-resolvidos':
      return NAO_RESOLVIDO
    case 'ativos':
      return { estado: 'ATIVO' }
    case 'reconhecidos':
      return { estado: 'RECONHECIDO' }
    case 'resolvidos':
      return { estado: 'RESOLVIDO_NA_ORIGEM' }
    case 'todos':
      return {}
  }
}

export async function listarAlertas(
  sujeito: Sujeito,
  filtros: FiltrosDeAlertas,
): Promise<{ alertas: AlertaNaLista[]; total: number }> {
  exigirPermissao(sujeito, 'infraestrutura.ler')

  const where: Prisma.AlertaWhereInput = {
    ...estadosDoFiltro(filtros.estado),
    ...(filtros.severidade !== null ? { severidade: filtros.severidade } : {}),
  }
  const [alertas, total] = await Promise.all([
    db.alerta.findMany({
      where,
      orderBy: [...ORDEM_DA_FILA],
      take: LIMITE_DA_LISTA,
      select: SELECT_DA_LISTA,
    }),
    db.alerta.count({ where }),
  ])
  return { alertas, total }
}

export async function listarAlertasDoRecurso(
  sujeito: Sujeito,
  recursoId: string,
): Promise<AlertaNaLista[]> {
  exigirPermissao(sujeito, 'infraestrutura.ler')

  return db.alerta.findMany({
    where: { recursoId, ...NAO_RESOLVIDO },
    orderBy: [...ORDEM_DA_FILA],
    take: LIMITE_DA_LISTA,
    select: SELECT_DA_LISTA,
  })
}

export async function listarAlertasNaoResolvidos(
  sujeito: Sujeito,
  limite: number,
): Promise<AlertaNaLista[]> {
  exigirPermissao(sujeito, 'infraestrutura.ler')

  return db.alerta.findMany({
    where: NAO_RESOLVIDO,
    orderBy: [...ORDEM_DA_FILA],
    take: limite,
    select: SELECT_DA_LISTA,
  })
}

export async function contarAlertasNaoResolvidos(sujeito: Sujeito): Promise<number> {
  exigirPermissao(sujeito, 'infraestrutura.ler')

  return db.alerta.count({ where: NAO_RESOLVIDO })
}

export interface AlertaDetalhado extends AlertaNaLista {
  detalhe: string | null
  primeiraOcorrenciaEm: Date
  origemTexto: string
  reconhecido: { por: string; em: Date } | null
  resolucao: { por: string | null; em: Date } | null
  projetosAfetados: { id: string; nome: string }[]
  historico: {
    tipo: 'CRIADO' | 'RECONHECIDO' | 'RESOLVIDO' | 'REABERTO'
    autor: string | null
    em: Date
  }[]
  podeRegistrarResolucao: boolean
}

export async function obterAlerta(sujeito: Sujeito, alertaId: string): Promise<AlertaDetalhado> {
  exigirPermissao(sujeito, 'infraestrutura.ler')

  const alerta = await db.alerta.findUnique({
    where: { id: alertaId },
    include: {
      recurso: {
        select: {
          id: true,
          nome: true,
          projetos: { select: { projeto: { select: { id: true, nome: true } } } },
        },
      },
      projeto: { select: { id: true, nome: true } },
      fonte: { select: { nome: true } },
      criadoPor: { select: { nome: true } },
      reconhecidoPor: { select: { nome: true } },
      resolvidoPor: { select: { nome: true } },
      eventos: {
        orderBy: { criadoEm: 'asc' },
        select: { tipo: true, criadoEm: true, autor: { select: { nome: true } } },
      },
    },
  })
  if (!alerta) {
    throw new ErroDeDominio('Alerta não encontrado.')
  }

  // Projeto do alerta ∪ projetos do recurso, sem repetição (decisão 8).
  const afetados = new Map<string, { id: string; nome: string }>()
  if (alerta.projeto) {
    afetados.set(alerta.projeto.id, alerta.projeto)
  }
  for (const v of alerta.recurso?.projetos ?? []) {
    afetados.set(v.projeto.id, v.projeto)
  }

  const origemTexto =
    alerta.origem === 'WEBHOOK'
      ? `Webhook · ${alerta.fonte?.nome ?? 'fonte removida'}`
      : `Registro manual · ${alerta.criadoPor?.nome ?? 'autor desconhecido'}`

  return {
    id: alerta.id,
    titulo: alerta.titulo,
    severidade: alerta.severidade,
    estado: alerta.estado,
    origem: alerta.origem,
    ocorrencias: alerta.ocorrencias,
    ultimaOcorrenciaEm: alerta.ultimaOcorrenciaEm,
    recurso: alerta.recurso ? { id: alerta.recurso.id, nome: alerta.recurso.nome } : null,
    detalhe: alerta.detalhe,
    primeiraOcorrenciaEm: alerta.primeiraOcorrenciaEm,
    origemTexto,
    reconhecido:
      alerta.reconhecidoEm !== null
        ? { por: alerta.reconhecidoPor?.nome ?? 'Sistema', em: alerta.reconhecidoEm }
        : null,
    resolucao:
      alerta.resolvidoEm !== null
        ? { por: alerta.resolvidoPor?.nome ?? null, em: alerta.resolvidoEm }
        : null,
    projetosAfetados: [...afetados.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    historico: alerta.eventos.map((e) => ({
      tipo: e.tipo,
      autor: e.autor?.nome ?? null,
      em: e.criadoEm,
    })),
    podeRegistrarResolucao: alerta.origem === 'MANUAL' && alerta.estado !== 'RESOLVIDO_NA_ORIGEM',
  }
}

export async function listarFontesDeAlertas(sujeito: Sujeito): Promise<
  {
    id: string
    nome: string
    criadoEm: Date
    ultimoUsoEm: Date | null
    revogadaEm: Date | null
  }[]
> {
  exigirPermissao(sujeito, 'infraestrutura.ler')

  return db.fonteDeAlertas.findMany({
    orderBy: { criadoEm: 'desc' },
    select: { id: true, nome: true, criadoEm: true, ultimoUsoEm: true, revogadaEm: true },
  })
}

export interface ResumoDeInfraestrutura {
  recursos: number
  recursosPorTipo: Partial<Record<TipoRecurso, number>>
  recursosComAlerta: number
  alertasAtivos: number
  alertasCriticos: number
  alertasReconhecidos: number
  fontesDeAlertas: number
  alertasJaRegistrados: number
}

export async function obterResumoDeInfraestrutura(
  sujeito: Sujeito,
): Promise<ResumoDeInfraestrutura> {
  exigirPermissao(sujeito, 'infraestrutura.ler')

  const [
    porTipo,
    recursosComAlerta,
    alertasAtivos,
    alertasCriticos,
    alertasReconhecidos,
    fontesDeAlertas,
    alertasJaRegistrados,
  ] = await Promise.all([
    db.recurso.groupBy({ by: ['tipo'], where: { arquivadoEm: null }, _count: { _all: true } }),
    db.recurso.count({ where: { arquivadoEm: null, alertas: { some: NAO_RESOLVIDO } } }),
    db.alerta.count({ where: { estado: 'ATIVO' } }),
    db.alerta.count({ where: { estado: 'ATIVO', severidade: 'CRITICA' } }),
    db.alerta.count({ where: { estado: 'RECONHECIDO' } }),
    db.fonteDeAlertas.count({ where: { revogadaEm: null } }),
    db.alerta.count(),
  ])
  const recursosPorTipo: Partial<Record<TipoRecurso, number>> = {}
  let recursos = 0
  for (const linha of porTipo) {
    recursosPorTipo[linha.tipo] = linha._count._all
    recursos += linha._count._all
  }
  return {
    recursos,
    recursosPorTipo,
    recursosComAlerta,
    alertasAtivos,
    alertasCriticos,
    alertasReconhecidos,
    fontesDeAlertas,
    alertasJaRegistrados,
  }
}

async function exigirProjeto(projetoId: string): Promise<void> {
  const projeto = await db.projeto.findUnique({ where: { id: projetoId }, select: { id: true } })
  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }
}

// Decisão 8: alerta do projeto ∪ alerta de recurso associado a ele; o OR devolve cada linha uma vez.
function alertasNaoResolvidosDoProjeto(projetoId: string): Prisma.AlertaWhereInput {
  return {
    ...NAO_RESOLVIDO,
    OR: [{ projetoId }, { recurso: { projetos: { some: { projetoId } } } }],
  }
}

export async function listarRecursosDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
): Promise<RecursoNaLista[]> {
  exigirPermissao(sujeito, 'infraestrutura.ler')
  await exigirProjeto(projetoId)

  const linhas = await db.recurso.findMany({
    where: { projetos: { some: { projetoId } } },
    orderBy: { nomeNormalizado: 'asc' },
    take: LIMITE_DA_LISTA,
    select: {
      id: true,
      nome: true,
      tipo: true,
      arquivadoEm: true,
      hospedadoEm: { select: { id: true, nome: true } },
      alertas: { where: NAO_RESOLVIDO, select: { severidade: true } },
      _count: { select: { projetos: true } },
    },
  })
  return linhas.map((r) => ({
    id: r.id,
    nome: r.nome,
    tipo: r.tipo,
    hospedadoEm: r.hospedadoEm,
    totalDeProjetos: r._count.projetos,
    situacao: situacaoDoRecurso({
      arquivado: r.arquivadoEm !== null,
      alertasNaoResolvidos: r.alertas,
    }),
  }))
}

export async function obterSaudeDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
): Promise<{
  alertas: AlertaNaLista[]
  resumo: ReturnType<typeof resumoDeSaude>
  glitchTip: { recurso: string; href: string }[]
}> {
  exigirPermissao(sujeito, 'infraestrutura.ler')
  await exigirProjeto(projetoId)

  const where = alertasNaoResolvidosDoProjeto(projetoId)
  const [alertas, severidades, recursos] = await Promise.all([
    db.alerta.findMany({
      where,
      orderBy: [...ORDEM_DA_FILA],
      take: LIMITE_DA_LISTA,
      select: SELECT_DA_LISTA,
    }),
    db.alerta.findMany({ where, select: { severidade: true } }),
    db.recurso.findMany({
      where: { projetos: { some: { projetoId } }, urlGlitchTip: { not: null } },
      orderBy: { nomeNormalizado: 'asc' },
      select: { nome: true, urlGlitchTip: true },
    }),
  ])

  return {
    alertas,
    resumo: resumoDeSaude(severidades),
    glitchTip: recursos.flatMap((r) =>
      r.urlGlitchTip !== null ? [{ recurso: r.nome, href: r.urlGlitchTip }] : [],
    ),
  }
}

export async function obterResumoDeSaudeDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
): Promise<ReturnType<typeof resumoDeSaude>> {
  exigirPermissao(sujeito, 'infraestrutura.ler')
  await exigirProjeto(projetoId)

  const severidades = await db.alerta.findMany({
    where: alertasNaoResolvidosDoProjeto(projetoId),
    select: { severidade: true },
  })
  return resumoDeSaude(severidades)
}
