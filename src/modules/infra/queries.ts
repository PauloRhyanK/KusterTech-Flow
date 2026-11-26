import type { Prisma } from '@prisma/client'
import { cache } from 'react'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { situacaoDoRecurso, type TipoRecurso } from './model'

const LIMITE_DA_LISTA = 100
const TIPOS: readonly TipoRecurso[] = ['SERVIDOR', 'CONTAINER', 'BANCO', 'STORAGE', 'OUTRO']
const SITUACOES = ['todas', 'arquivados'] as const

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

export interface RecursoNaLista {
  id: string
  nome: string
  tipo: TipoRecurso
  hospedadoEm: { id: string; nome: string } | null
  totalDeProjetos: number
  identificadorExterno: string | null
  provedor: string | null
  endereco: string | null
  especificacao: string | null
  custoMensal: string | null
  situacao: ReturnType<typeof situacaoDoRecurso>
}

type LinhaDeRecurso = Prisma.RecursoGetPayload<{ select: typeof SELECT_DA_LISTA }>

const SELECT_DA_LISTA = {
  id: true,
  nome: true,
  tipo: true,
  arquivadoEm: true,
  identificadorExterno: true,
  provedor: true,
  endereco: true,
  especificacao: true,
  custoMensal: true,
  hospedadoEm: { select: { id: true, nome: true } },
  _count: { select: { projetos: true } },
} as const satisfies Prisma.RecursoSelect

function paraRecursoNaLista(r: LinhaDeRecurso): RecursoNaLista {
  return {
    id: r.id,
    nome: r.nome,
    tipo: r.tipo,
    hospedadoEm: r.hospedadoEm,
    totalDeProjetos: r._count.projetos,
    identificadorExterno: r.identificadorExterno,
    provedor: r.provedor,
    endereco: r.endereco,
    especificacao: r.especificacao,
    custoMensal: r.custoMensal?.toFixed(2) ?? null,
    situacao: situacaoDoRecurso({ arquivado: r.arquivadoEm !== null }),
  }
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

  const [linhas, total, projetos] = await Promise.all([
    db.recurso.findMany({
      where,
      orderBy: { nomeNormalizado: 'asc' },
      take: LIMITE_DA_LISTA,
      select: SELECT_DA_LISTA,
    }),
    db.recurso.count({ where }),
    db.projeto.findMany({ orderBy: { nome: 'asc' }, select: { id: true, nome: true } }),
  ])

  return {
    recursos: linhas.map(paraRecursoNaLista),
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
  provedor: string | null
  endereco: string | null
  especificacao: string | null
  custoMensal: string | null
  arquivadoEm: Date | null
  hospedadoEm: { id: string; nome: string } | null
  hospedados: { id: string; nome: string; tipo: TipoRecurso; arquivado: boolean }[]
  projetos: { id: string; nome: string; arquivado: boolean }[]
  projetosDisponiveis: { id: string; nome: string }[]
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

  const projetosDisponiveis = await db.projeto.findMany({
    where: { arquivadoEm: null, id: { notIn: idsAssociados } },
    orderBy: { nome: 'asc' },
    select: { id: true, nome: true },
  })

  return {
    id: recurso.id,
    tipo: recurso.tipo,
    nome: recurso.nome,
    identificadorExterno: recurso.identificadorExterno,
    descricao: recurso.descricao,
    provedor: recurso.provedor,
    endereco: recurso.endereco,
    especificacao: recurso.especificacao,
    custoMensal: recurso.custoMensal?.toFixed(2) ?? null,
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
    situacao: situacaoDoRecurso({ arquivado: recurso.arquivadoEm !== null }),
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

export interface ResumoDeInfraestrutura {
  recursos: number
  recursosPorTipo: Partial<Record<TipoRecurso, number>>
}

export async function obterResumoDeInfraestrutura(
  sujeito: Sujeito,
): Promise<ResumoDeInfraestrutura> {
  exigirPermissao(sujeito, 'infraestrutura.ler')

  const porTipo = await db.recurso.groupBy({
    by: ['tipo'],
    where: { arquivadoEm: null },
    _count: { _all: true },
  })
  const recursosPorTipo: Partial<Record<TipoRecurso, number>> = {}
  let recursos = 0
  for (const linha of porTipo) {
    recursosPorTipo[linha.tipo] = linha._count._all
    recursos += linha._count._all
  }
  return { recursos, recursosPorTipo }
}

async function exigirProjeto(projetoId: string): Promise<void> {
  const projeto = await db.projeto.findUnique({ where: { id: projetoId }, select: { id: true } })
  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
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
    select: SELECT_DA_LISTA,
  })
  return linhas.map(paraRecursoNaLista)
}
