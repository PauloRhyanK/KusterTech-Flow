import { autorizar, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import type { OrigemEvidencia } from '@/modules/ambientes/model'
import type { EstadoIntegracao } from '@/modules/github/model'
import { exigirLeituraGlobal } from '@/modules/github/service'
import {
  carregarPublicacaoDoRepositorio,
  composicaoMaisRecenteDaVersao,
  desatualizada,
  estadosDaVersao,
  prepararAvaliacao,
  type AvaliacaoPreparada,
  type LinhaDaComposicao,
} from './avaliacao'
import {
  avaliarAutorizacaoProd,
  type AvaliacaoDeAutorizacao,
  type EstadosDePublicacao,
  type ItemDaComposicao,
} from './model'

export interface ComposicaoApresentada {
  id: string
  estado: 'IDENTIFICADA' | 'INCERTA'
  hash: string
  origemDaBase: 'AUTORIZACAO' | 'EVIDENCIA_PROD' | 'SEM_BASE'
  commitBaseCurto: string | null
  calculadaEm: Date
  desatualizada: boolean
  itens: ItemDaComposicao[]
  tituloPorIssueId: Record<string, string>
  // Avaliada sobre a confirmação vazia: mostra o que falta, não o que o usuário confirmou.
  avaliacao: AvaliacaoDeAutorizacao
}

export interface VersaoCurta {
  id: string
  rotulo: string
  commitCurto: string
}

export interface PublicacaoDoRepositorio {
  repositorio: {
    id: string
    nomeCompleto: string
    estado: EstadoIntegracao
    sincronizadoEm: Date | null
  }
  emProd: {
    versaoId: string
    rotulo: string
    commitCurto: string
    origem: OrigemEvidencia
    ocorridaEm: Date
    estados: EstadosDePublicacao
  } | null
  candidata: {
    versao: VersaoCurta
    composicao: ComposicaoApresentada | null
    autorizacao: { autorNome: string; criadaEm: Date; justificativa: string | null } | null
    estados: EstadosDePublicacao
  } | null
  autorizacoes: {
    id: string
    rotulo: string
    criadaEm: Date
    autorNome: string
    revogadaEm: Date | null
    motivoRevogacao: string | null
  }[]
}

export interface PublicacoesDoProjeto {
  projeto: { id: string; nome: string }
  ambientes: { qa: boolean; prod: boolean }
  podeAutorizar: boolean
  repositorios: PublicacaoDoRepositorio[]
  versaoSelecionada: {
    repositorioId: string
    versao: VersaoCurta
    composicao: ComposicaoApresentada
    somenteLeitura: boolean
  } | null
}

const curto = (sha: string) => sha.slice(0, 7)
const LIMITE_DE_AUTORIZACOES = 10

async function apresentar(
  composicao: LinhaDaComposicao,
  integracao: EstadoIntegracao,
  repositorio: { sincronizadoEm: Date | null },
): Promise<{ apresentada: ComposicaoApresentada; qa: AvaliacaoPreparada['qa'] }> {
  const preparada = await prepararAvaliacao(db, { composicao, integracao })
  return {
    apresentada: {
      id: composicao.id,
      estado: composicao.estado,
      hash: composicao.hashComposicao,
      origemDaBase: composicao.origemDaBase,
      commitBaseCurto: composicao.origemDaBase === 'SEM_BASE' ? null : curto(composicao.commitBase),
      calculadaEm: composicao.calculadaEm,
      desatualizada: desatualizada(repositorio, composicao),
      itens: composicao.itens,
      tituloPorIssueId: preparada.tituloPorIssueId,
      avaliacao: avaliarAutorizacaoProd({
        ...preparada.entrada,
        confirmacao: {
          contextoConferido: false,
          desconhecidosConferidos: false,
          verificadasPorHumano: [],
          justificativa: null,
        },
      }),
    },
    qa: preparada.qa,
  }
}

// Publicações do projeto (D31): leitura da visão global; o contexto de cliente não vê nada daqui.
export async function obterPublicacoesDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
  versaoId: string | null,
  agora: Date = new Date(),
): Promise<PublicacoesDoProjeto> {
  exigirLeituraGlobal(sujeito)

  const projeto = await db.projeto.findUnique({
    where: { id: projetoId },
    select: { id: true, nome: true },
  })
  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }

  const ambientes = await db.ambiente.findMany({
    where: { projetoId, tipo: { in: ['QA', 'PROD'] } },
    select: { tipo: true },
  })
  const repos = await db.repositorioGitHub.findMany({
    where: { projetoId },
    orderBy: { nomeCompleto: 'asc' },
    select: { id: true },
  })

  const repositorios: PublicacaoDoRepositorio[] = []
  for (const { id } of repos) {
    const carregada = await carregarPublicacaoDoRepositorio(db, id, agora)
    if (!carregada) continue
    const { situacao, integracao } = carregada
    const repositorio = {
      id,
      nomeCompleto: situacao.repositorio.nomeCompleto,
      estado: integracao,
      sincronizadoEm: situacao.repositorio.sincronizadoEm,
    }

    const emProd = situacao.emProd
    let candidata: PublicacaoDoRepositorio['candidata'] = null
    if (situacao.candidata) {
      const apresentada = carregada.composicao
        ? await apresentar(carregada.composicao, integracao, situacao.repositorio)
        : null
      candidata = {
        versao: {
          id: situacao.candidata.versaoId,
          rotulo: situacao.candidata.rotulo,
          commitCurto: curto(situacao.candidata.commitSha),
        },
        composicao: apresentada?.apresentada ?? null,
        autorizacao: carregada.autorizacaoVigente,
        estados: await estadosDaVersao(db, {
          versaoId: situacao.candidata.versaoId,
          integracao,
          prod: situacao.prod,
          emProd,
          qa: apresentada?.qa,
        }),
      }
    }

    const autorizacoes = await db.autorizacaoProd.findMany({
      where: { repositorioId: id },
      orderBy: { criadaEm: 'desc' },
      take: LIMITE_DE_AUTORIZACOES,
      select: {
        id: true,
        criadaEm: true,
        revogadaEm: true,
        motivoRevogacao: true,
        versaoAlvo: { select: { rotulo: true } },
        autor: { select: { nome: true } },
      },
    })

    repositorios.push({
      repositorio,
      emProd: emProd
        ? {
            versaoId: emProd.versaoId,
            rotulo: emProd.rotulo,
            commitCurto: curto(emProd.commitSha),
            origem: emProd.origem,
            ocorridaEm: emProd.ocorridaEm,
            estados: await estadosDaVersao(db, {
              versaoId: emProd.versaoId,
              integracao,
              prod: situacao.prod,
              emProd,
            }),
          }
        : null,
      candidata,
      autorizacoes: autorizacoes.map((a) => ({
        id: a.id,
        rotulo: a.versaoAlvo.rotulo,
        criadaEm: a.criadaEm,
        autorNome: a.autor.nome,
        revogadaEm: a.revogadaEm,
        motivoRevogacao: a.motivoRevogacao,
      })),
    })
  }

  return {
    projeto,
    ambientes: {
      qa: ambientes.some((a) => a.tipo === 'QA'),
      prod: ambientes.some((a) => a.tipo === 'PROD'),
    },
    podeAutorizar: autorizar(sujeito, 'publicacao.autorizar'),
    repositorios,
    versaoSelecionada: versaoId ? await versaoSelecionada(projetoId, versaoId, repositorios) : null,
  }
}

// `?versao=` (pedido do Incremento 7): a composição mais recente da versão, no topo. Só leitura
// quando a versão não é a candidata do repositório.
async function versaoSelecionada(
  projetoId: string,
  versaoId: string,
  repositorios: readonly PublicacaoDoRepositorio[],
): Promise<PublicacoesDoProjeto['versaoSelecionada']> {
  const versao = await db.versao.findFirst({
    where: { id: versaoId, projetoId },
    select: { id: true, rotulo: true, commitSha: true, repositorioId: true },
  })
  if (!versao) return null
  const composicao = await composicaoMaisRecenteDaVersao(db, versao.id)
  if (!composicao) return null
  const doRepositorio = repositorios.find((r) => r.repositorio.id === versao.repositorioId)
  if (!doRepositorio) return null
  const { apresentada } = await apresentar(
    composicao,
    doRepositorio.repositorio.estado,
    doRepositorio.repositorio,
  )
  const candidata = doRepositorio.candidata
  return {
    repositorioId: versao.repositorioId,
    versao: { id: versao.id, rotulo: versao.rotulo, commitCurto: curto(versao.commitSha) },
    composicao: apresentada,
    somenteLeitura: candidata?.versao.id !== versao.id,
  }
}
