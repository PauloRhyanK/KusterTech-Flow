import { autorizar, exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { moduloAtivo } from '@/lib/modulos'
import { idsVisiveis, podeVerVisaoGlobal } from '@/modules/clientes/model'
import type { RetratoV1 } from '@/modules/fabrica/contrato'
import { planosEmCurso, retratoDesatualizado, type ResumoDoPlano } from '@/modules/fabrica/model'
import { obterRetratoMaisRecente, type RetratoRecebido } from '@/modules/fabrica/queries'
import { estadoDoRepositorio, resumirErroParaLog } from '@/modules/github/model'
import { intervaloDaIntegracao } from '@/modules/github/service'
import { avisosDaMaquina, type LeituraDaMaquina } from '@/modules/oficina/model'
import { maquinaLocalConfigurada, obterLeituraDaMaquinaLocal } from '@/modules/oficina/queries'
import {
  ACAO_DE_LEITURA,
  agruparHomologacoes,
  esperasDaFabrica,
  esperasDaOficina,
  indicadoresDeProjetos,
  montarEsperaVoce,
  pendenciaDeAutorizacao,
  pendenciaDeDivergencia,
  pendenciaDeIntegracao,
  type EsperaVoce,
  type FonteDeEspera,
  type Indicador,
  type ItemDeEspera,
  type LinhaDeHomologacao,
  type TipoDeEspera,
} from './model'

const ID_INTEGRACAO = 'github'
// Até a Task 8 a página da máquina é a do inventário de Infraestrutura.
const ROTA_DAS_MAQUINAS = '/infraestrutura/recursos'

export interface ResumoDeProjetos {
  indicadores: Indicador[]
  link: { rotulo: string; href: string }
}

export type PlanoNoInicio = ResumoDoPlano & { nomeDoProjeto: string | null }

export interface Inicio {
  escopo: 'total' | 'cliente'
  espera: EsperaVoce
  fabrica: {
    planos: PlanoNoInicio[]
    vagas: RetratoV1['vagas']
    recebidoEm: Date
    desatualizado: boolean
  } | null
  oficina: { hrefDaMaquina: string | null; leitura: LeituraDaMaquina } | null
  cadastro: { clientes: number; projetos: number; repositorios: number; maquinas: number } | null
  seusProjetos: ResumoDeProjetos | null
}

async function homologacoesPendentes(sujeito: Sujeito): Promise<ItemDeEspera[]> {
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

  return agruparHomologacoes(linhas, sujeito)
}

async function autorizacoesDeProdPendentes(sujeito: Sujeito): Promise<ItemDeEspera[]> {
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

  return composicoes
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
}

async function divergenciasPendentes(sujeito: Sujeito): Promise<ItemDeEspera[]> {
  exigirPermissao(sujeito, 'publicacao.autorizar')

  const divergencias = await db.divergenciaDeDeploy.findMany({
    where: { reconhecidaEm: null, versao: { projeto: { arquivadoEm: null } } },
    orderBy: [{ detectadaEm: 'asc' }, { id: 'asc' }],
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
  })

  return divergencias.map((d) =>
    pendenciaDeDivergencia({
      id: d.id,
      detectadaEm: d.detectadaEm,
      projeto: d.versao.projeto,
      repositorio: d.versao.repositorio.nomeCompleto,
      rotulo: d.versao.rotulo,
    }),
  )
}

async function integracoesPendentes(sujeito: Sujeito, agora: Date): Promise<ItemDeEspera[]> {
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
    return []
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

  return [...porProjeto.values()].flatMap(({ projeto, repositorios: repos }) => {
    const item = pendenciaDeIntegracao(projeto, repos)
    return item ? [item] : []
  })
}

// Nome do projeto de cada repositório do retrato que está vinculado a um projeto ativo.
async function nomesDosProjetos(repos: readonly string[]): Promise<Map<string, string>> {
  if (repos.length === 0) return new Map()
  const vinculados = await db.repositorioGitHub.findMany({
    where: { nomeCompleto: { in: [...repos] }, projeto: { arquivadoEm: null } },
    select: { nomeCompleto: true, projeto: { select: { nome: true } } },
  })
  return new Map(
    vinculados.flatMap((r) => (r.projeto ? [[r.nomeCompleto, r.projeto.nome] as const] : [])),
  )
}

async function lerFabrica(
  sujeito: Sujeito,
): Promise<{ recebido: RetratoRecebido | null; nomes: Map<string, string> }> {
  const recebido = await obterRetratoMaisRecente(sujeito)
  const nomes = await nomesDosProjetos(recebido?.retrato.planos.map((p) => p.repo) ?? [])
  return { recebido, nomes }
}

async function hrefDaMaquinaLocal(): Promise<string | null> {
  const identificador = maquinaLocalConfigurada()
  if (!identificador) return null
  const recurso = await db.recurso.findUnique({
    where: { identificadorExterno: identificador },
    select: { id: true },
  })
  return recurso ? `${ROTA_DAS_MAQUINAS}/${recurso.id}` : null
}

async function obterCadastro(): Promise<NonNullable<Inicio['cadastro']>> {
  const [clientes, projetos, repositorios, maquinas] = await Promise.all([
    db.cliente.count({ where: { arquivadoEm: null } }),
    db.projeto.count({ where: { arquivadoEm: null } }),
    db.repositorioGitHub.count({ where: { projeto: { arquivadoEm: null } } }),
    db.recurso.count({ where: { arquivadoEm: null } }),
  ])
  return { clientes, projetos, repositorios, maquinas }
}

async function obterSeusProjetos(sujeito: Sujeito): Promise<ResumoDeProjetos> {
  exigirPermissao(sujeito, 'projetos.ler')
  const clientes = [...(idsVisiveis(sujeito) ?? [])]
  const [projetosAtivos, homologacoesEmAndamento] = await Promise.all([
    db.projeto.count({
      where: { arquivadoEm: null, clientes: { some: { clienteId: { in: clientes } } } },
    }),
    moduloAtivo('homologacao')
      ? db.homologacao.count({
          where: {
            estado: 'EM_ANDAMENTO',
            clienteId: { in: clientes },
            milestone: { arquivadaEm: null, projeto: { arquivadoEm: null } },
          },
        })
      : Promise.resolve(null),
  ])
  return {
    indicadores: indicadoresDeProjetos({ projetosAtivos, homologacoesEmAndamento }),
    link: { rotulo: 'Ver clientes', href: '/clientes' },
  }
}

function registrarFalha(erro: unknown, fonte: string): void {
  log.error({ erro: resumirErroParaLog(erro), fonte }, 'consulta do Início falhou')
}

// Promessa que nunca rejeita: a falha vira `undefined` e é registrada no log.
async function semFalhar<T>(promessa: Promise<T>, fonte: string): Promise<T | undefined> {
  try {
    return await promessa
  } catch (erro) {
    registrarFalha(erro, fonte)
    return undefined
  }
}

const TIPOS_DA_FABRICA: readonly TipoDeEspera[] = [
  'decisao',
  'plano-pausado',
  'fabrica-sem-noticias',
]

export async function obterInicio(sujeito: Sujeito, agora: Date): Promise<Inicio> {
  const total = podeVerVisaoGlobal(sujeito)
  const pode = (tipo: TipoDeEspera) => autorizar(sujeito, ACAO_DE_LEITURA[tipo])
  const verFabrica = total && moduloAtivo('fabrica') && pode('decisao')
  const verOficina = total && moduloAtivo('maquinas') && pode('aviso-da-oficina')

  // Fontes de lista simples: uma consulta por tipo, só com o módulo ativo e a permissão.
  const consultas: [TipoDeEspera, () => Promise<ItemDeEspera[]>][] = []
  if (moduloAtivo('github') && pode('integracao')) {
    consultas.push(['integracao', () => integracoesPendentes(sujeito, agora)])
  }
  if (moduloAtivo('homologacao') && pode('homologacao')) {
    consultas.push(['homologacao', () => homologacoesPendentes(sujeito)])
  }
  if (moduloAtivo('publicacao') && pode('autorizacao-prod')) {
    consultas.push(['autorizacao-prod', () => autorizacoesDeProdPendentes(sujeito)])
    consultas.push(['divergencia', () => divergenciasPendentes(sujeito)])
  }

  const [retrato, leitura, simples, cadastro, hrefDaMaquina, seusProjetos] = await Promise.all([
    verFabrica
      ? lerFabrica(sujeito).catch((erro: unknown) => {
          registrarFalha(erro, 'fabrica')
          return 'falha' as const
        })
      : null,
    verOficina
      ? obterLeituraDaMaquinaLocal(sujeito, agora).catch((erro: unknown) => {
          registrarFalha(erro, 'aviso-da-oficina')
          return 'falha' as const
        })
      : null,
    Promise.allSettled(consultas.map(([, consulta]) => consulta())),
    total ? semFalhar(obterCadastro(), 'cadastro') : undefined,
    verOficina ? semFalhar(hrefDaMaquinaLocal(), 'maquina-local') : undefined,
    total ? undefined : semFalhar(obterSeusProjetos(sujeito), 'seus-projetos'),
  ])

  const fontes: FonteDeEspera[] = simples.map((r, i) => {
    const tipo = consultas[i]![0]
    if (r.status === 'fulfilled') return { tipo, itens: r.value }
    registrarFalha(r.reason, tipo)
    return { tipo, falha: true }
  })

  const recebido: RetratoRecebido | null =
    retrato === null || retrato === 'falha' ? null : retrato.recebido
  if (retrato === 'falha') {
    fontes.push(...TIPOS_DA_FABRICA.map((tipo) => ({ tipo, falha: true as const })))
  } else if (retrato !== null) {
    const nomeDoProjeto = (repo: string) => retrato.nomes.get(repo) ?? null
    const itens = esperasDaFabrica(recebido, agora, nomeDoProjeto)
    fontes.push(
      ...TIPOS_DA_FABRICA.map((tipo) => ({ tipo, itens: itens.filter((i) => i.tipo === tipo) })),
    )
  }

  if (leitura === 'falha') {
    fontes.push({ tipo: 'aviso-da-oficina', falha: true })
  } else if (leitura) {
    const avisos = avisosDaMaquina(leitura, recebido?.retrato.vagas.ramMinimaMb ?? null, agora)
    fontes.push({
      tipo: 'aviso-da-oficina',
      itens: esperasDaOficina(avisos, hrefDaMaquina ?? ROTA_DAS_MAQUINAS),
    })
  }

  return {
    escopo: total ? 'total' : 'cliente',
    espera: montarEsperaVoce(fontes),
    fabrica:
      recebido && retrato !== null && retrato !== 'falha'
        ? {
            planos: planosEmCurso(recebido.retrato).map((plano) => ({
              ...plano,
              nomeDoProjeto: retrato.nomes.get(plano.repo) ?? null,
            })),
            vagas: recebido.retrato.vagas,
            recebidoEm: recebido.recebidoEm,
            desatualizado: retratoDesatualizado(recebido.recebidoEm, agora),
          }
        : null,
    oficina:
      leitura && leitura !== 'falha' ? { hrefDaMaquina: hrefDaMaquina ?? null, leitura } : null,
    cadastro: cadastro ?? null,
    seusProjetos: seusProjetos ?? null,
  }
}
