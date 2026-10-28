import type { Prisma } from '@prisma/client'
import { cache } from 'react'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { linksDeFerramentas, situacaoDoRecurso, type TipoRecurso } from './model'

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
