import type { ResumoDeChecks } from '@prisma/client'
import { autorizar, exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import {
  avisosDaPublicacao,
  itensDoUltimoLote,
  montarResumoDaPublicacao,
  rodapeDoLote,
  rotuloDaLinha,
  sha7,
  type AvisoDePublicacao,
  type ChecksDoPedido,
  type ItemDoLote,
  type LinhaDaFila,
  type PedidoDaLinha,
  type ResumoDaPublicacao,
} from './apresentacao'
import {
  duracaoTipicaEmMin,
  type EstadoDoConserto,
  type ModoDePublicacao,
  type SituacaoDaFila,
} from './model'
import { filtroDoNoAr, ORDEM_DO_NO_AR } from './no-ar'

export interface TelaDePublicacao {
  pausaGeral: boolean
  avisos: AvisoDePublicacao[]
  resumo: ResumoDaPublicacao
  linhas: LinhaDaFila[]
  ultimoLote: ItemDoLote[]
  rodapeDoLote: string | null
  podeGerenciar: boolean
  podeRedefinir: boolean
}

const JANELA_DO_LOTE_MS = 12 * 60 * 60_000
const AMOSTRAS_DA_DURACAO = 5

function checksDe(c: ResumoDeChecks | null): ChecksDoPedido {
  return c === null ? null : (c.toLowerCase() as ChecksDoPedido)
}

function pedidoDaLinha(p: {
  id: string
  commit: string | null
  descricao: string | null
  modo: 'IMEDIATO' | 'LOTE'
  estado: string
  checks: ResumoDeChecks | null
  iniciadoEm: Date | null
  verificandoDesde: Date | null
}): PedidoDaLinha {
  return {
    id: p.id,
    commit: p.commit,
    descricao: p.descricao,
    modo: p.modo.toLowerCase() as ModoDePublicacao,
    estado: p.estado.toLowerCase() as PedidoDaLinha['estado'],
    checks: checksDe(p.checks),
    iniciadoEm: p.iniciadoEm,
    verificandoDesde: p.verificandoDesde,
  }
}

async function montarLinha(
  repo: {
    id: string
    nomeCompleto: string
    projeto: { id: string; nome: string }
    configuracaoDePublicacao: {
      pausado: boolean
      horaDoLote: string
      situacao: 'NORMAL' | 'CONSERTANDO' | 'PARADO'
      situacaoDesde: Date | null
      situacaoMotivo: string | null
      baseRedefinidaEm: Date | null
    } | null
  },
  repositoriosDoProjeto: number,
): Promise<LinhaDaFila> {
  const config = repo.configuracaoDePublicacao
  const base = config?.baseRedefinidaEm ?? null
  const depoisDaBase = base ? { concluidoEm: { gt: base } } : {}
  const [noAr, pendentes, conserto, ultimaFalha, ultimoRecusado, duracoes] = await Promise.all([
    db.pedidoDePublicacao.findFirst({
      where: filtroDoNoAr(repo.id, base),
      orderBy: ORDEM_DO_NO_AR,
      select: { commit: true, concluidoEm: true },
    }),
    db.pedidoDePublicacao.findMany({
      where: {
        repositorioId: repo.id,
        estado: { in: ['NA_FILA', 'VERIFICANDO', 'PUBLICANDO'] },
        atendidoPorId: null,
      },
      orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
    }),
    db.pedidoDeConserto.findFirst({
      where: { repositorioId: repo.id },
      orderBy: { abertoEm: 'desc' },
    }),
    db.pedidoDePublicacao.findFirst({
      where: { repositorioId: repo.id, estado: 'FALHOU', atendidoPorId: null },
      orderBy: [{ concluidoEm: { sort: 'desc', nulls: 'last' } }, { criadoEm: 'desc' }],
      select: { commit: true, execucaoUrl: true },
    }),
    db.pedidoDePublicacao.findFirst({
      where: {
        repositorioId: repo.id,
        estado: 'RECUSADO',
        concluidoEm: base ? { gt: base } : { not: null },
      },
      orderBy: { concluidoEm: 'desc' },
      select: { motivo: true, concluidoEm: true },
    }),
    db.pedidoDePublicacao.findMany({
      where: {
        repositorioId: repo.id,
        estado: 'PUBLICADO',
        atendidoPorId: null,
        iniciadoEm: { not: null },
        concluidoEm: { not: null },
        ...depoisDaBase,
      },
      orderBy: { concluidoEm: 'desc' },
      take: AMOSTRAS_DA_DURACAO,
      select: { iniciadoEm: true, concluidoEm: true },
    }),
  ])

  const publicando = pendentes.find((p) => p.estado === 'PUBLICANDO')
  return {
    repositorioId: repo.id,
    projetoId: repo.projeto.id,
    projeto: repo.projeto.nome,
    rotulo: rotuloDaLinha(repo.projeto.nome, repo.nomeCompleto, repositoriosDoProjeto),
    configuracao: config && {
      pausado: config.pausado,
      horaDoLote: config.horaDoLote,
      situacao: config.situacao.toLowerCase() as SituacaoDaFila,
      situacaoDesde: config.situacaoDesde,
      situacaoMotivo: config.situacaoMotivo,
    },
    noAr:
      noAr?.commit && noAr.concluidoEm ? { commit: noAr.commit, desde: noAr.concluidoEm } : null,
    // O motivo de um pedido publicando é provisório (disparo não confirmado): não vai para a tela.
    publicando: publicando ? pedidoDaLinha(publicando) : null,
    aguardando: pendentes.filter((p) => p.estado !== 'PUBLICANDO').map(pedidoDaLinha),
    conserto: conserto && {
      estado: conserto.estado.toLowerCase() as EstadoDoConserto,
      prUrl: conserto.prUrl,
      abertoEm: conserto.abertoEm,
      pegoEm: conserto.pegoEm,
      encerradoEm: conserto.encerradoEm,
    },
    ultimaFalha,
    ultimoRecusado:
      ultimoRecusado?.concluidoEm && ultimoRecusado.motivo
        ? { motivo: ultimoRecusado.motivo, concluidoEm: ultimoRecusado.concluidoEm }
        : null,
    ultimaPublicacaoEm: noAr?.concluidoEm ?? null,
    duracaoTipicaEmMin: duracaoTipicaEmMin(
      duracoes.reverse().map((d) => d.concluidoEm!.getTime() - d.iniciadoEm!.getTime()),
    ),
  }
}

async function lerUltimoLote(repositorioIds: readonly string[]): Promise<ItemDoLote[]> {
  const onde = {
    repositorioId: { in: [...repositorioIds] },
    estado: {
      in: ['PUBLICADO', 'FALHOU', 'PUBLICANDO'] as ('PUBLICADO' | 'FALHOU' | 'PUBLICANDO')[],
    },
    loteEm: { not: null },
  }
  const ultimo = await db.pedidoDePublicacao.findFirst({
    where: onde,
    orderBy: { loteEm: 'desc' },
    select: { loteEm: true },
  })
  if (!ultimo?.loteEm) return []
  const pedidos = await db.pedidoDePublicacao.findMany({
    where: { ...onde, loteEm: { gt: new Date(ultimo.loteEm.getTime() - JANELA_DO_LOTE_MS) } },
    select: {
      id: true,
      commit: true,
      descricao: true,
      estado: true,
      loteEm: true,
      concluidoEm: true,
      repositorio: { select: { projeto: { select: { nome: true } } } },
    },
  })
  return itensDoUltimoLote(
    pedidos.map((p) => ({
      id: p.id,
      titulo: p.descricao ?? sha7(p.commit),
      projeto: p.repositorio.projeto?.nome ?? '—',
      estado: p.estado.toLowerCase() as ItemDoLote['estado'],
      loteEm: p.loteEm!,
      concluidoEm: p.concluidoEm,
    })),
  )
}

/** Uma linha por repositório vinculado a projeto ativo. */
export async function obterTelaDePublicacao(
  sujeito: Sujeito,
  agora: Date,
): Promise<TelaDePublicacao> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')

  const [repositorios, pausa] = await Promise.all([
    db.repositorioGitHub.findMany({
      where: { removidoDaInstalacaoEm: null, projeto: { is: { arquivadoEm: null } } },
      orderBy: [{ projeto: { nome: 'asc' } }, { nomeCompleto: 'asc' }],
      select: {
        id: true,
        nomeCompleto: true,
        projeto: { select: { id: true, nome: true } },
        configuracaoDePublicacao: {
          select: {
            pausado: true,
            horaDoLote: true,
            situacao: true,
            situacaoDesde: true,
            situacaoMotivo: true,
            baseRedefinidaEm: true,
          },
        },
      },
    }),
    db.pausaGeralDePublicacao.findUnique({ where: { id: 1 } }),
  ])

  const porProjeto = new Map<string, number>()
  for (const r of repositorios) {
    if (r.projeto) porProjeto.set(r.projeto.id, (porProjeto.get(r.projeto.id) ?? 0) + 1)
  }
  const linhas = await Promise.all(
    repositorios.flatMap((r) =>
      r.projeto
        ? [montarLinha({ ...r, projeto: r.projeto }, porProjeto.get(r.projeto.id) ?? 1)]
        : [],
    ),
  )
  const ultimoLote = await lerUltimoLote(linhas.map((l) => l.repositorioId))

  return {
    pausaGeral: pausa?.pausadaEm != null,
    avisos: avisosDaPublicacao(linhas, agora),
    resumo: montarResumoDaPublicacao(linhas, ultimoLote, agora),
    linhas,
    ultimoLote,
    rodapeDoLote: rodapeDoLote(ultimoLote),
    podeGerenciar: autorizar(sujeito, 'projetos.gerenciar'),
    podeRedefinir: autorizar(sujeito, 'configuracoes.gerenciar'),
  }
}
