import type { ResumoDeChecks } from '@prisma/client'
import { autorizar, exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import type { AvisoDaPublicacaoNaPilha } from '@/modules/decidir/model'
import { esperasDaPublicacao, type ItemDeEspera } from '@/modules/inicio/model'
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
  criadoEm: Date
  iniciadoEm: Date | null
  verificandoDesde: Date | null
  conferindoDesde: Date | null
}): PedidoDaLinha {
  return {
    id: p.id,
    commit: p.commit,
    descricao: p.descricao,
    modo: p.modo.toLowerCase() as ModoDePublicacao,
    estado: p.estado.toLowerCase() as PedidoDaLinha['estado'],
    checks: checksDe(p.checks),
    criadoEm: p.criadoEm,
    iniciadoEm: p.iniciadoEm,
    verificandoDesde: p.verificandoDesde,
    conferindoDesde: p.conferindoDesde,
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
      urlDaVersao: string | null
      versaoNoAr: string | null
      versaoConferidaEm: Date | null
    } | null
  },
  repositoriosDoProjeto: number,
): Promise<LinhaDaFila> {
  const config = repo.configuracaoDePublicacao
  const base = config?.baseRedefinidaEm ?? null
  const depoisDaBase = base ? { concluidoEm: { gt: base } } : {}
  const [noAr, pendentes, conserto, ultimaFalha, ultimoRecusado, duracoes, ultimoDispensado] =
    await Promise.all([
      db.pedidoDePublicacao.findFirst({
        where: filtroDoNoAr(repo.id, base),
        orderBy: ORDEM_DO_NO_AR,
        select: {
          commit: true,
          concluidoEm: true,
          descricao: true,
          demanda: { select: { titulo: true } },
          id: true,
          execucaoUrl: true,
        },
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
        select: { commit: true, execucaoUrl: true, motivo: true },
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
      db.pedidoDePublicacao.findFirst({
        where: {
          repositorioId: repo.id,
          estado: 'DISPENSADO',
          atendidoPorId: null,
          concluidoEm: { not: null },
        },
        orderBy: { concluidoEm: 'desc' },
        select: {
          commit: true,
          descricao: true,
          motivo: true,
          concluidoEm: true,
          demanda: { select: { titulo: true } },
        },
      }),
    ])
  // os pedidos mais antigos que a publicação no ar atendeu: subiram junto com ela
  const subiramJunto = noAr
    ? await db.pedidoDePublicacao.count({ where: { atendidoPorId: noAr.id, estado: 'PUBLICADO' } })
    : 0

  // O PR do conserto pelo link, sem diferenciar maiúsculas (como o worker), para o aviso de revisão.
  const prDoConserto =
    conserto?.estado === 'COM_PR' && conserto.prUrl
      ? await db.pullRequestGitHub.findFirst({
          where: {
            repositorioId: repo.id,
            urlHtml: { equals: conserto.prUrl, mode: 'insensitive' },
          },
          select: { estado: true, shaMerge: true, criadoNoGitHub: true },
        })
      : null

  const publicando = pendentes.find((p) => p.estado === 'PUBLICANDO')
  return {
    repositorioId: repo.id,
    projetoId: repo.projeto.id,
    projeto: repo.projeto.nome,
    repositorio: repo.nomeCompleto,
    rotulo: rotuloDaLinha(repo.projeto.nome, repo.nomeCompleto, repositoriosDoProjeto),
    configuracao: config && {
      pausado: config.pausado,
      horaDoLote: config.horaDoLote,
      situacao: config.situacao.toLowerCase() as SituacaoDaFila,
      situacaoDesde: config.situacaoDesde,
      situacaoMotivo: config.situacaoMotivo,
    },
    noAr:
      noAr?.commit && noAr.concluidoEm
        ? {
            commit: noAr.commit,
            desde: noAr.concluidoEm,
            titulo: noAr.demanda?.titulo || noAr.descricao,
            junto: subiramJunto,
            execucaoUrl: noAr.execucaoUrl,
          }
        : null,
    conferencia: Boolean(config?.urlDaVersao),
    versaoConferida:
      config?.urlDaVersao && config.versaoNoAr && config.versaoConferidaEm
        ? { commit: config.versaoNoAr, em: config.versaoConferidaEm }
        : null,
    ultimoDispensado: ultimoDispensado?.concluidoEm
      ? {
          commit: ultimoDispensado.commit,
          titulo: ultimoDispensado.demanda?.titulo || ultimoDispensado.descricao,
          motivo: ultimoDispensado.motivo,
          concluidoEm: ultimoDispensado.concluidoEm,
        }
      : null,
    // O motivo de um pedido publicando é provisório (disparo não confirmado): não vai para a tela.
    publicando: publicando ? pedidoDaLinha(publicando) : null,
    aguardando: pendentes.filter((p) => p.estado !== 'PUBLICANDO').map(pedidoDaLinha),
    conserto: conserto && {
      estado: conserto.estado.toLowerCase() as EstadoDoConserto,
      prUrl: conserto.prUrl,
      abertoEm: conserto.abertoEm,
      pegoEm: conserto.pegoEm,
      encerradoEm: conserto.encerradoEm,
      correcaoPedida: conserto.shaDaCorrecao !== null,
      pr: prDoConserto && {
        estado: prDoConserto.estado,
        shaMerge: prDoConserto.shaMerge,
        criadoEm: prDoConserto.criadoNoGitHub,
      },
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
      iniciadoEm: true,
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
      iniciadoEm: p.iniciadoEm,
      concluidoEm: p.concluidoEm,
    })),
  )
}

/** Uma linha por repositório vinculado a projeto ativo. */
async function lerLinhas(): Promise<LinhaDaFila[]> {
  const repositorios = await db.repositorioGitHub.findMany({
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
          urlDaVersao: true,
          versaoNoAr: true,
          versaoConferidaEm: true,
        },
      },
    },
  })

  const porProjeto = new Map<string, number>()
  for (const r of repositorios) {
    if (r.projeto) porProjeto.set(r.projeto.id, (porProjeto.get(r.projeto.id) ?? 0) + 1)
  }
  return Promise.all(
    repositorios.flatMap((r) =>
      r.projeto
        ? [montarLinha({ ...r, projeto: r.projeto }, porProjeto.get(r.projeto.id) ?? 1)]
        : [],
    ),
  )
}

export async function obterTelaDePublicacao(
  sujeito: Sujeito,
  agora: Date,
): Promise<TelaDePublicacao> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')

  const [linhas, pausa] = await Promise.all([
    lerLinhas(),
    db.pausaGeralDePublicacao.findUnique({ where: { id: 1 } }),
  ])
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

/** Os mesmos avisos da faixa da tela, como itens do "Espera você". */
export async function esperasDePublicacao(sujeito: Sujeito, agora: Date): Promise<ItemDeEspera[]> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  return esperasDaPublicacao(avisosDaPublicacao(await lerLinhas(), agora))
}

/**
 * Os mesmos avisos para a pilha do Decidir, com o projeto e o repositório de cada um. Sem
 * permissão própria: quem chama (a pilha, o arquivamento das conversas) já conferiu a leitura.
 */
export async function avisosParaODecidir(agora: Date): Promise<AvisoDaPublicacaoNaPilha[]> {
  const linhas = await lerLinhas()
  const porRepositorio = new Map(linhas.map((l) => [l.repositorioId, l]))
  return avisosDaPublicacao(linhas, agora).map((a) => {
    const linha = porRepositorio.get(a.repositorioId)
    return {
      id: a.id,
      repositorioId: a.repositorioId,
      titulo: a.titulo,
      contexto: a.contexto,
      href: a.href,
      externo: a.externo,
      tom: a.tom,
      desde: a.desde,
      projeto: linha?.projeto ?? '',
      repositorio: linha?.repositorio ?? linha?.rotulo ?? '',
    }
  })
}

export interface ConfiguracaoDePublicacao {
  workflow: string
  entradaDoCommit: string
  horaDoLote: string
  modoPadrao: ModoDePublicacao
  automatico: boolean
  pausado: boolean
  urlDaVersao: string | null
}

export interface PublicacaoDoProjeto {
  repositorios: {
    id: string
    nomeCompleto: string
    configuracao: ConfiguracaoDePublicacao | null
  }[]
}

/** A configuração de publicação de cada repositório vinculado ao projeto. */
export async function obterPublicacaoDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
): Promise<PublicacaoDoProjeto> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const projeto = await db.projeto.findUnique({ where: { id: projetoId }, select: { id: true } })
  if (!projeto) throw new ErroDeDominio('Projeto não encontrado.')

  const repositorios = await db.repositorioGitHub.findMany({
    where: { projetoId, removidoDaInstalacaoEm: null },
    orderBy: { nomeCompleto: 'asc' },
    select: {
      id: true,
      nomeCompleto: true,
      configuracaoDePublicacao: {
        select: {
          workflow: true,
          entradaDoCommit: true,
          horaDoLote: true,
          modoPadrao: true,
          automatico: true,
          pausado: true,
          urlDaVersao: true,
        },
      },
    },
  })
  return {
    repositorios: repositorios.map((r) => {
      const c = r.configuracaoDePublicacao
      return {
        id: r.id,
        nomeCompleto: r.nomeCompleto,
        configuracao: c && {
          ...c,
          modoPadrao: c.modoPadrao.toLowerCase() as ModoDePublicacao,
        },
      }
    }),
  }
}
