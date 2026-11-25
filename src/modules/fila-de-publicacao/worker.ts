import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { moduloAtivo } from '@/lib/modulos'
import {
  fecharDemandaSeNoAr,
  fecharPartesNoAr,
  marcarResultadoNaParte,
  travarDemandas,
} from '@/modules/demandas/partes-no-ar'
import type { resultadoDoPedido } from '@/modules/demandas/partes'
import { ErroDeIntegracao } from '@/modules/github/erros'
import type {
  ComparacaoDaFonte,
  ExecucaoDaFonte,
  FonteGitHub,
  RefRepositorio,
} from '@/modules/github/fonte'
import { resumirChecks, resumirErroParaLog } from '@/modules/github/model'
import { avancarConsertosComPr } from './consertos'
import {
  aposFalha,
  avaliarPedido,
  contarPublicacoesAusentes,
  decidirConferencia,
  decidirConserto,
  escolherCandidato,
  escolherProximo,
  ESPERA_PELA_EXECUCAO_MS,
  MOTIVOS,
  noArParaAvaliar,
  procurarExecucaoDoCommit,
  relacaoDoCompare,
  resultadoDaExecucao,
  type Avaliacao,
  type EntradaDaAvaliacao,
  type EntradaDaEscolha,
  type EstadoDoConserto,
  type PedidoNaFila,
  type Relacao,
  type SituacaoDaFila,
} from './model'
import { filtroDoNoAr, ORDEM_DO_NO_AR } from './no-ar'
import { lerVersaoNoAr, type LerVersaoNoAr } from './versao-no-ar'

export interface ResumoDaFila {
  repositorios: number
  recusados: number
  dispensados: number
  disparados: number
  publicados: number
  falhas: number
  consertosAbertos: number
  parados: number
}

/** `verificadoContra` de um pedido verificado quando nada estava no ar. */
const SEM_NO_AR = 'inicio'
const LIMITE_DO_LOG = 4000
const MAXIMO_PARA_JUNTAR = 10
const FOLGA_DA_BUSCA_MS = 60_000
const PREFIXO_DO_DISPARO = 'o GitHub não confirmou o disparo: '

const EM_ESPERA = ['NA_FILA', 'VERIFICANDO'] as const
const PENDENTES = ['NA_FILA', 'VERIFICANDO', 'PUBLICANDO'] as const
const CONSERTO_ATIVO = ['ABERTO', 'EM_CURSO', 'COM_PR'] as const
const CONSERTO_SEM_PR = ['ABERTO', 'EM_CURSO'] as const

type Tx = Prisma.TransactionClient

// A mesma trava por repositório da recepção (POST): uma chegada nunca se intercala com uma
// mudança de estado feita pelo worker.
function comTrava<T>(repositorioId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${repositorioId}))`
    return fn(tx)
  })
}

/**
 * O commit no ar para avaliar pedidos: com a versão no ar configurada, o último conferido no site;
 * sem ela, o do último publicado depois da redefinição (ou de sempre, sem redefinição).
 */
export async function commitNoAr(repositorioId: string): Promise<string | null> {
  const config = await db.configuracaoDePublicacao.findUnique({
    where: { repositorioId },
    select: { baseRedefinidaEm: true, urlDaVersao: true, versaoNoAr: true },
  })
  const urlDaVersao = config?.urlDaVersao ?? null
  const ultimo = urlDaVersao
    ? null
    : await db.pedidoDePublicacao.findFirst({
        where: filtroDoNoAr(repositorioId, config?.baseRedefinidaEm ?? null),
        orderBy: ORDEM_DO_NO_AR,
        select: { commit: true },
      })
  return noArParaAvaliar({
    urlDaVersao,
    versaoNoAr: config?.versaoNoAr ?? null,
    ultimoPublicado: ultimo?.commit ?? null,
  })
}

async function publicadosRecentes(
  repositorioId: string,
  baseRedefinidaEm: Date | null,
): Promise<string[]> {
  const linhas = await db.pedidoDePublicacao.findMany({
    where: filtroDoNoAr(repositorioId, baseRedefinidaEm),
    orderBy: ORDEM_DO_NO_AR,
    select: { commit: true },
  })
  return linhas.flatMap((l) => (l.commit ? [l.commit] : []))
}

function origemDe(p: { consertoId: string | null; usuarioId: string | null }) {
  if (p.consertoId !== null) return 'conserto' as const
  if (p.usuarioId !== null) return 'usuario' as const
  return 'fonte' as const
}

function ehNaMain(r: Relacao | 'desconhecido'): boolean {
  return r === 'a_frente' || r === 'identico'
}

interface Repositorio extends RefRepositorio {
  id: string
}

type Configuracao = Awaited<ReturnType<typeof lerConfiguracao>>

function lerConfiguracao(repositorioId: string) {
  return db.configuracaoDePublicacao.findUniqueOrThrow({ where: { repositorioId } })
}

async function pausaGeralAtiva(cliente: Tx | typeof db = db): Promise<boolean> {
  const pausa = await cliente.pausaGeralDePublicacao.findUnique({ where: { id: 1 } })
  return pausa?.pausadaEm != null
}

/** Um ciclo de um repositório: as chamadas ao GitHub ficam memorizadas até o fim do ciclo. */
class CicloDoRepositorio {
  private cabeca: { branch: string; sha: string } | null = null
  private readonly comparacoes = new Map<string, ComparacaoDaFonte>()
  private noAr: string | null = null
  private publicados: string[] | null = null

  constructor(
    private readonly fonte: FonteGitHub,
    private readonly repo: Repositorio,
    private readonly agora: Date,
    private readonly resumo: ResumoDaFila,
    private config: Configuracao,
    private readonly lerVersao: LerVersaoNoAr,
  ) {}

  async executar(): Promise<void> {
    await this.fila()
    // O lado das demandas nunca segura a fila: o que falhar aqui o ciclo seguinte refaz.
    for (const passo of [() => this.fecharPartesContidas(), () => this.fecharDemandasCompletas()]) {
      try {
        if (moduloAtivo('demandas')) await passo()
      } catch (erro) {
        log.error(
          { tarefa: 'processar-fila-de-publicacao', erro: resumirErroParaLog(erro) },
          'partes da demanda não reconciliadas',
        )
      }
    }
  }

  private async fila(): Promise<void> {
    const pendentes = await db.pedidoDePublicacao.count({
      where: { repositorioId: this.repo.id, estado: { in: [...PENDENTES] } },
    })
    if (pendentes === 0) return
    const candidato = await db.pedidoDePublicacao.findFirst({
      where: { repositorioId: this.repo.id, estado: 'PUBLICANDO', atendidoPorId: null },
    })
    // O relógio da verificação (30 min até "Espera você") começa antes de qualquer chamada ao
    // GitHub: se ele estiver fora desde o início do ciclo, o pedido da vez já fica VERIFICANDO.
    if (!candidato) await this.marcarAVez()
    await this.atualizarNoAr()
    await this.resolverCommits()
    await this.preVerificar()
    await this.lerChecks()
    if (candidato) {
      const terminou = await this.acompanhar(candidato)
      if (!terminou) return
      this.config = await lerConfiguracao(this.repo.id)
      await this.atualizarNoAr()
    }
    await this.escolherEDisparar()
  }

  private get ref(): RefRepositorio {
    const { githubId, instalacaoId, nomeCompleto } = this.repo
    return { githubId, instalacaoId, nomeCompleto }
  }

  private get marca(): string {
    return this.noAr ?? SEM_NO_AR
  }

  private async atualizarNoAr() {
    this.noAr = await commitNoAr(this.repo.id)
    this.publicados = null
  }

  private async lerCabeca() {
    this.cabeca ??= await this.fonte.lerCabecaDoBranchPadrao(this.ref)
    return this.cabeca
  }

  private async comparar(base: string, cabeca: string): Promise<ComparacaoDaFonte> {
    const chave = `${base}...${cabeca}`
    const memo = this.comparacoes.get(chave)
    if (memo) return memo
    const c = await this.fonte.compararCommits(this.ref, base, cabeca)
    this.comparacoes.set(chave, c)
    return c
  }

  /** Contém = a versão conferida é o próprio commit ou está à frente dele (mesma convenção da conferência). */
  private async versaoContem(commit: string, versaoNoAr: string): Promise<boolean> {
    if (commit === versaoNoAr) return true
    const r = await this.relacao(commit, versaoNoAr)
    return r === 'a_frente' || r === 'identico'
  }

  /**
   * A versão conferida fecha as partes do repositório que ela contém, venha ou não de um pedido
   * deste ciclo. As consultas ao GitHub ficam fora da transação; falha delas deixa a parte como
   * está e o ciclo seguinte tenta de novo.
   */
  private async fecharPartesContidas() {
    const { versaoNoAr } = await lerConfiguracao(this.repo.id)
    if (versaoNoAr === null) return
    const partes = await db.parteDaDemanda.findMany({
      where: {
        repositorioId: this.repo.id,
        estado: { in: ['FEITA', 'PUBLICANDO', 'NAO_CHEGOU'] },
        commitAlvo: { not: null },
      },
      select: { commitAlvo: true },
      distinct: ['commitAlvo'],
    })
    if (partes.length === 0) return
    const veredito = new Map<string, boolean>()
    for (const { commitAlvo } of partes) {
      try {
        veredito.set(commitAlvo!, await this.versaoContem(commitAlvo!, versaoNoAr))
      } catch (erro) {
        if (!(erro instanceof ErroDeIntegracao)) throw erro
        log.warn(
          { tarefa: 'processar-fila-de-publicacao', erro: resumirErroParaLog(erro) },
          'partes não conferidas contra a versão no ar',
        )
      }
    }
    await comTrava(this.repo.id, (tx) =>
      fecharPartesNoAr(tx, {
        repositorioId: this.repo.id,
        versaoNoAr,
        contem: async (c) => {
          const v = veredito.get(c)
          if (v === undefined) throw new Error('commit não comparado')
          return v
        },
        agora: this.agora,
      }),
    )
  }

  /**
   * Demandas abertas deste repositório com todas as partes no ar: tenta fechar. A transição recusa
   * enquanto a etapa atual não é a do no ar; o ciclo seguinte tenta de novo.
   */
  private async fecharDemandasCompletas() {
    const demandas = await db.demanda.findMany({
      where: {
        encerrada: null,
        partes: {
          some: { repositorioId: this.repo.id },
          none: { estado: { notIn: ['NO_AR', 'DESCARTADA'] } },
        },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    })
    for (const { id } of demandas) {
      await comTrava(this.repo.id, (tx) => fecharDemandaSeNoAr(tx, id, this.agora))
    }
  }

  /**
   * O resultado de cada pedido que terminou sem conferência volta para a parte dele. Roda num
   * SAVEPOINT: se o lado das demandas falhar, a mudança de estado do pedido ainda é gravada.
   */
  private async marcarPartes(
    tx: Tx,
    candidatos: readonly string[],
    resultado: Parameters<typeof resultadoDoPedido>[0],
  ) {
    if (!moduloAtivo('demandas')) return
    await tx.$executeRaw`SAVEPOINT partes_da_demanda`
    try {
      // Pedidos repetidos (DISPENSADO na chegada, atendidos por estes) levam o mesmo resultado.
      const repetidos = await tx.pedidoDePublicacao.findMany({
        where: {
          atendidoPorId: { in: [...candidatos] },
          estado: 'DISPENSADO',
          parteId: { not: null },
        },
        select: { id: true },
      })
      const ids = [...new Set([...candidatos, ...repetidos.map((r) => r.id)])]
      const partes = await tx.parteDaDemanda.findMany({
        where: { pedidos: { some: { id: { in: [...ids] } } } },
        select: { demandaId: true },
      })
      await travarDemandas(tx, [...new Set(partes.map((x) => x.demandaId))])
      for (const id of ids) await marcarResultadoNaParte(tx, id, resultado, this.agora)
      await tx.$executeRaw`RELEASE SAVEPOINT partes_da_demanda`
    } catch (erro) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT partes_da_demanda`
      log.error(
        { tarefa: 'processar-fila-de-publicacao', erro: resumirErroParaLog(erro) },
        'resultado do pedido não gravado na parte',
      )
    }
  }

  /** Da cabeça em relação à base; `desconhecido` quando o GitHub não conhece um dos commits. */
  private async relacao(base: string, cabeca: string): Promise<Relacao | 'desconhecido'> {
    try {
      return relacaoDoCompare((await this.comparar(base, cabeca)).status)
    } catch (erro) {
      if (erro instanceof ErroDeIntegracao && erro.categoria === 'commit-desconhecido') {
        return 'desconhecido'
      }
      throw erro
    }
  }

  // Convenção do compare: base = commit pedido (ou no ar), cabeça = main (ou commit pedido).
  private async avaliar(commit: string): Promise<Avaliacao> {
    const main = (await this.lerCabeca()).sha
    const e: EntradaDaAvaliacao = {
      commitNoAr: this.noAr,
      noArEmMain: true,
      relacaoComMain: await this.relacao(commit, main),
      relacaoComNoAr: null,
      publicacoesAusentes: 0,
    }
    if (!ehNaMain(e.relacaoComMain) || this.noAr === null) return avaliarPedido(e)
    e.noArEmMain = ehNaMain(await this.relacao(this.noAr, main))
    if (!e.noArEmMain) return avaliarPedido(e)
    const comNoAr = await this.relacao(this.noAr, commit)
    e.relacaoComNoAr = comNoAr === 'desconhecido' ? null : comNoAr
    if (comNoAr === 'divergente') {
      const ausentes = (await this.comparar(commit, this.noAr)).commits
      this.publicados ??= await publicadosRecentes(this.repo.id, this.config.baseRedefinidaEm)
      e.publicacoesAusentes = contarPublicacoesAusentes(this.publicados, ausentes)
    }
    return avaliarPedido(e)
  }

  /** Grava a avaliação se o pedido ainda está como foi lido. */
  private async aplicar(
    id: string,
    estado: 'NA_FILA' | 'VERIFICANDO',
    av: Avaliacao,
  ): Promise<'aceito' | 'saiu' | 'tentar_de_novo'> {
    if (av.resultado === 'tentar_de_novo') return 'tentar_de_novo'
    let conferidoContendo = false
    if (av.resultado === 'dispensado' && moduloAtivo('demandas')) {
      const { versaoNoAr } = await lerConfiguracao(this.repo.id)
      const linha = await db.pedidoDePublicacao.findUnique({
        where: { id },
        select: { commit: true },
      })
      if (versaoNoAr !== null && linha?.commit) {
        try {
          conferidoContendo = await this.versaoContem(linha.commit, versaoNoAr)
        } catch (erro) {
          if (!(erro instanceof ErroDeIntegracao)) throw erro
        }
      }
    }
    return comTrava(this.repo.id, async (tx) => {
      const onde = { id, estado, atendidoPorId: null }
      if (av.resultado === 'aceito') {
        const { count } = await tx.pedidoDePublicacao.updateMany({
          where: onde,
          data: { verificadoContra: this.marca },
        })
        return count > 0 ? 'aceito' : 'saiu'
      }
      const { count } = await tx.pedidoDePublicacao.updateMany({
        where: onde,
        data: {
          estado: av.resultado === 'recusado' ? 'RECUSADO' : 'DISPENSADO',
          motivo: av.motivo,
          concluidoEm: this.agora,
          verificandoDesde: null,
        },
      })
      if (count > 0) {
        if (av.resultado === 'recusado') this.resumo.recusados += 1
        else this.resumo.dispensados += 1
        // Dispensado contendo o commit: `reconciliarPartes` fecha a parte com o commit conferido.
        await this.marcarPartes(tx, [id], {
          estado: av.resultado === 'recusado' ? 'RECUSADO' : 'DISPENSADO',
          motivo: av.motivo,
          conserto: null,
          conferidoContendo,
        })
      }
      return 'saiu'
    })
  }

  /** Passo 2: "Publicar agora" pede a cabeça de main sem saber qual é. */
  private async resolverCommits() {
    const semCommit = await db.pedidoDePublicacao.findMany({
      where: { repositorioId: this.repo.id, estado: { in: [...EM_ESPERA] }, commit: null },
      select: { id: true },
    })
    if (semCommit.length === 0) return
    const { sha } = await this.lerCabeca()
    await comTrava(this.repo.id, (tx) =>
      tx.pedidoDePublicacao.updateMany({
        where: { id: { in: semCommit.map((p) => p.id) }, commit: null },
        data: { commit: sha },
      }),
    )
  }

  /** Passo 3: recusa e dispensa já na fila, sem esperar a vez (vale com a fila pausada). */
  private async preVerificar() {
    const naFila = await db.pedidoDePublicacao.findMany({
      where: {
        repositorioId: this.repo.id,
        estado: 'NA_FILA',
        atendidoPorId: null,
        commit: { not: null },
        OR: [{ verificadoContra: null }, { verificadoContra: { not: this.marca } }],
      },
      orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
      select: { id: true, commit: true },
    })
    for (const p of naFila) {
      await this.aplicar(p.id, 'NA_FILA', await this.avaliar(p.commit!))
    }
  }

  /** Passo 4: só informa; nenhum resultado de checks segura a publicação. */
  private async lerChecks() {
    const semResumo = await db.pedidoDePublicacao.findMany({
      where: {
        repositorioId: this.repo.id,
        estado: { in: [...PENDENTES] },
        commit: { not: null },
        OR: [{ checks: null }, { checks: 'PENDENTE' }],
      },
      select: { id: true, commit: true },
    })
    const porCommit = new Map<string, ReturnType<typeof resumirChecks>>()
    try {
      for (const p of semResumo) {
        const commit = p.commit!
        let checks = porCommit.get(commit)
        if (checks === undefined) {
          checks = resumirChecks(await this.fonte.listarChecks(this.ref, commit))
          porCommit.set(commit, checks)
        }
        await db.pedidoDePublicacao.update({ where: { id: p.id }, data: { checks } })
      }
    } catch (erro) {
      if (!(erro instanceof ErroDeIntegracao)) throw erro
      log.warn(
        { tarefa: 'processar-fila-de-publicacao', erro: resumirErroParaLog(erro) },
        'checks do commit não lidos',
      )
    }
  }

  /** Passo 5. Devolve `true` quando a publicação terminou (com sucesso ou falha). */
  private async acompanhar(candidato: {
    id: string
    commit: string | null
    execucaoId: bigint | null
    execucaoUrl: string | null
    disparoTentadoEm: Date | null
    iniciadoEm: Date | null
    consertoId: string | null
    motivo: string | null
    conferindoDesde: Date | null
  }): Promise<boolean> {
    const commit = candidato.commit!
    let execucao: ExecucaoDaFonte | null
    if (candidato.execucaoId === null) {
      const tentado = candidato.disparoTentadoEm ?? candidato.iniciadoEm ?? this.agora
      const achada = await this.buscarExecucao(candidato.id, commit, tentado)
      if (!achada) {
        if (this.agora.getTime() - tentado.getTime() <= ESPERA_PELA_EXECUCAO_MS) return false
        await this.falhar(candidato, MOTIVOS.execucaoNaoEncontrada, null)
        return true
      }
      execucao = achada
    } else {
      execucao = await this.fonte.lerExecucao(this.ref, candidato.execucaoId)
    }
    const resultado = resultadoDaExecucao(execucao)
    if (resultado === 'andando') return false
    if (resultado === 'sucesso') {
      if (this.config.urlDaVersao === null) {
        await this.publicado(candidato.id, null)
        return true
      }
      return this.conferir(candidato, this.config.urlDaVersao, execucao)
    }
    const sumiu = execucao === null || execucao.conclusao === 'cancelled'
    await this.falhar(candidato, sumiu ? MOTIVOS.execucaoSumiu : null, execucao)
    return true
  }

  /** PUBLICADO para o candidato e os atendidos; com a versão conferida, ela vira o no ar. */
  private async publicado(candidatoId: string, noArConferido: string | null) {
    await comTrava(this.repo.id, async (tx) => {
      const { count } = await tx.pedidoDePublicacao.updateMany({
        where: { id: candidatoId, estado: 'PUBLICANDO' },
        data: { estado: 'PUBLICADO', concluidoEm: this.agora },
      })
      if (count === 0) return
      const atendidos = await tx.pedidoDePublicacao.findMany({
        where: { atendidoPorId: candidatoId, estado: 'PUBLICANDO' },
        select: { id: true },
      })
      await tx.pedidoDePublicacao.updateMany({
        where: { atendidoPorId: candidatoId, estado: 'PUBLICANDO' },
        data: { estado: 'PUBLICADO', concluidoEm: this.agora },
      })
      if (noArConferido === null) {
        await this.marcarPartes(tx, [candidatoId, ...atendidos.map((a) => a.id)], {
          estado: 'PUBLICADO',
          motivo: null,
          conserto: null,
          conferidoContendo: false,
        })
      }
      if (noArConferido !== null) {
        await tx.configuracaoDePublicacao.update({
          where: { repositorioId: this.repo.id },
          data: { versaoNoAr: noArConferido, versaoConferidaEm: this.agora },
        })
      }
      this.resumo.publicados += 1
    })
  }

  /**
   * Workflow verde com a versão no ar configurada: lê o site a cada ciclo, por até
   * `LIMITE_DA_CONFERENCIA_MS`. Devolve `true` quando a publicação terminou.
   */
  private async conferir(
    candidato: {
      id: string
      commit: string | null
      execucaoUrl: string | null
      consertoId: string | null
      motivo: string | null
      conferindoDesde: Date | null
    },
    url: string,
    execucao: ExecucaoDaFonte | null,
  ): Promise<boolean> {
    const commit = candidato.commit!
    const desde = candidato.conferindoDesde ?? this.agora
    if (candidato.conferindoDesde === null) {
      await db.pedidoDePublicacao.updateMany({
        where: { id: candidato.id, estado: 'PUBLICANDO', conferindoDesde: null },
        data: { conferindoDesde: desde, execucaoUrl: execucao?.urlHtml ?? candidato.execucaoUrl },
      })
    }
    const leitura = await this.lerVersao(url)
    // Base = commit pedido, cabeça = o commit no site: a_frente ou identico quer dizer que o site o contém.
    const relacao =
      leitura.tipo === 'lida' && leitura.commit !== commit
        ? await this.relacao(commit, leitura.commit)
        : null
    const decisao = decidirConferencia({ commit, leitura, relacao, desde, agora: this.agora })
    if (decisao.acao === 'esperar') return false
    if (decisao.acao === 'publicado') {
      await this.publicado(candidato.id, decisao.noAr)
      return true
    }
    await this.falharNaConferencia(candidato.id, decisao.motivo)
    return true
  }

  /**
   * O site não mostra o que foi publicado: o código não é o problema (servidor errado, cache,
   * deploy que não trocou o build), então não há conserto para a Fábrica. A fila para e espera o
   * Paulo; sem isso a próxima publicação cairia no mesmo lugar.
   */
  private async falharNaConferencia(candidatoId: string, motivo: string) {
    await comTrava(this.repo.id, async (tx) => {
      const { count } = await tx.pedidoDePublicacao.updateMany({
        where: { id: candidatoId, estado: 'PUBLICANDO' },
        data: { estado: 'FALHOU', motivo, concluidoEm: this.agora },
      })
      if (count === 0) return
      const atendidos = await tx.pedidoDePublicacao.findMany({
        where: { atendidoPorId: candidatoId, estado: 'PUBLICANDO' },
        select: { id: true },
      })
      await tx.pedidoDePublicacao.updateMany({
        where: { atendidoPorId: candidatoId, estado: 'PUBLICANDO' },
        data: { estado: 'FALHOU', motivo, concluidoEm: this.agora },
      })
      await this.marcarPartes(tx, [candidatoId, ...atendidos.map((a) => a.id)], {
        estado: 'FALHOU',
        motivo,
        conserto: null,
        conferidoContendo: false,
      })
      await tx.configuracaoDePublicacao.update({
        where: { repositorioId: this.repo.id },
        data: { situacao: 'PARADO', situacaoDesde: this.agora, situacaoMotivo: motivo },
      })
      this.resumo.falhas += 1
      this.resumo.parados += 1
    })
  }

  /** Procura a execução disparada pelo commit no título e grava o id. */
  private async buscarExecucao(
    pedidoId: string,
    commit: string,
    tentado: Date,
  ): Promise<ExecucaoDaFonte | null> {
    const desde = new Date(tentado.getTime() - FOLGA_DA_BUSCA_MS)
    const execucoes = await this.fonte.listarExecucoesDoWorkflow(
      this.ref,
      this.config.workflow,
      desde,
    )
    const achada = procurarExecucaoDoCommit(execucoes, commit)
    if (achada) {
      await db.pedidoDePublicacao.updateMany({
        where: { id: pedidoId, execucaoId: null },
        data: { execucaoId: achada.id, execucaoUrl: achada.urlHtml, motivo: null },
      })
    }
    return achada
  }

  private async falhar(
    candidato: {
      id: string
      commit: string | null
      execucaoUrl: string | null
      consertoId: string | null
      motivo: string | null
    },
    motivo: string | null,
    execucao: ExecucaoDaFonte | null,
  ) {
    const atendidos = await db.pedidoDePublicacao.findMany({
      where: { atendidoPorId: candidato.id, estado: 'PUBLICANDO' },
      select: { consertoId: true },
    })
    const eraDoConserto =
      candidato.consertoId !== null || atendidos.some((a) => a.consertoId !== null)
    const config = await lerConfiguracao(this.repo.id)
    const decisao = aposFalha(config.situacao.toLowerCase() as SituacaoDaFila, eraDoConserto)
    const semLog = [motivo, candidato.motivo].filter(Boolean).join('\n')
    let trecho = ''
    if (decisao.abrirConserto) {
      try {
        trecho = execucao
          ? await this.fonte.lerFimDoLog(this.ref, execucao.id, LIMITE_DO_LOG)
          : semLog
      } catch (erro) {
        // Log ilegível de vez (job que nunca rodou, logs expirados): a falha segue sem o trecho,
        // senão o pedido ficaria PUBLICANDO para sempre.
        log.warn(
          { tarefa: 'processar-fila-de-publicacao', erro: resumirErroParaLog(erro) },
          'fim do log da execução não lido',
        )
        trecho = semLog
      }
    }

    await comTrava(this.repo.id, async (tx) => {
      const { count } = await tx.pedidoDePublicacao.updateMany({
        where: { id: candidato.id, estado: 'PUBLICANDO' },
        data: { estado: 'FALHOU', motivo, concluidoEm: this.agora },
      })
      if (count === 0) return
      const fundidos = await tx.pedidoDePublicacao.findMany({
        where: { atendidoPorId: candidato.id, estado: 'PUBLICANDO' },
        select: { id: true, demandaId: true, parteId: true },
      })
      await tx.pedidoDePublicacao.updateMany({
        where: { atendidoPorId: candidato.id, estado: 'PUBLICANDO' },
        data: { estado: 'FALHOU', motivo, concluidoEm: this.agora },
      })
      await this.marcarPartes(tx, [candidato.id, ...fundidos.map((a) => a.id)], {
        estado: 'FALHOU',
        motivo,
        conserto: decisao.abrirConserto ? 'em_curso' : null,
        conferidoContendo: false,
      })
      // O conserto leva a demanda e a parte do pedido que estava publicando (ou de um que ele atendeu).
      const proprio = await tx.pedidoDePublicacao.findUniqueOrThrow({
        where: { id: candidato.id },
        select: { demandaId: true, parteId: true },
      })
      const ligado = proprio.parteId ? proprio : (fundidos.find((a) => a.parteId) ?? proprio)
      this.resumo.falhas += 1
      if (decisao.abrirConserto) {
        await tx.configuracaoDePublicacao.update({
          where: { repositorioId: this.repo.id },
          data: { situacao: 'CONSERTANDO', situacaoDesde: this.agora, situacaoMotivo: null },
        })
        await tx.pedidoDeConserto.create({
          data: {
            repositorioId: this.repo.id,
            pedidoId: candidato.id,
            commit: candidato.commit!,
            execucaoUrl: execucao?.urlHtml ?? candidato.execucaoUrl,
            trechoDoLog: trecho,
            abertoEm: this.agora,
            demandaId: ligado.demandaId,
            parteId: ligado.parteId,
          },
        })
        this.resumo.consertosAbertos += 1
      } else {
        await tx.configuracaoDePublicacao.update({
          where: { repositorioId: this.repo.id },
          data: { situacao: 'PARADO', situacaoDesde: this.agora, situacaoMotivo: decisao.motivo },
        })
        this.resumo.parados += 1
      }
    })
  }

  private async voltarParaFila(id: string) {
    await comTrava(this.repo.id, (tx) =>
      tx.pedidoDePublicacao.updateMany({
        where: { id, estado: 'VERIFICANDO' },
        data: { estado: 'NA_FILA', verificandoDesde: null },
      }),
    )
  }

  private async montarEscolha(comCommit: boolean) {
    const linhas = await db.pedidoDePublicacao.findMany({
      where: {
        repositorioId: this.repo.id,
        estado: { in: [...EM_ESPERA] },
        atendidoPorId: null,
        ...(comCommit ? { commit: { not: null } } : {}),
      },
      orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
    })
    const conserto = await db.pedidoDeConserto.findFirst({
      where: { repositorioId: this.repo.id, estado: { in: [...CONSERTO_ATIVO] } },
      orderBy: { abertoEm: 'desc' },
      select: { id: true },
    })
    const pedidos: PedidoNaFila[] = linhas.map((p) => ({
      id: p.id,
      commit: p.commit,
      modo: p.modo === 'LOTE' ? 'lote' : 'imediato',
      origem: origemDe(p),
      consertoId: p.consertoId,
      estado: p.estado === 'VERIFICANDO' ? 'verificando' : 'na_fila',
      criadoEm: p.criadoEm,
    }))
    const entrada: EntradaDaEscolha = {
      pedidos,
      publicandoAgora: false,
      pausado: this.config.pausado,
      pausaGeral: await pausaGeralAtiva(),
      automatico: this.config.automatico,
      situacao: this.config.situacao.toLowerCase() as SituacaoDaFila,
      consertoAbertoId: conserto?.id ?? null,
      horaDoLote: this.config.horaDoLote,
      ultimoLoteEm: this.config.ultimoLoteEm,
      agora: this.agora,
    }
    return { linhas, pedidos, entrada }
  }

  private async marcar(id: string): Promise<boolean> {
    const { count } = await comTrava(this.repo.id, (tx) =>
      tx.pedidoDePublicacao.updateMany({
        where: { id, estado: 'NA_FILA', atendidoPorId: null },
        data: { estado: 'VERIFICANDO', verificandoDesde: this.agora },
      }),
    )
    return count > 0
  }

  /** Só com dados locais: marca o pedido da vez como VERIFICANDO. */
  private async marcarAVez() {
    const { linhas, entrada } = await this.montarEscolha(false)
    if (linhas.length === 0) return
    const escolha = escolherProximo(entrada)
    if (escolha.tipo === 'publicar') await this.marcar(escolha.obrigatorioId ?? escolha.ids.at(-1)!)
  }

  /** Passo 6: sem candidato, escolhe o próximo, verifica, junta e dispara. */
  private async escolherEDisparar() {
    const { linhas, pedidos, entrada } = await this.montarEscolha(true)
    if (linhas.length === 0) return
    let escolha = escolherProximo(entrada)
    let marcadorId: string
    if (escolha.tipo === 'continuar') {
      // Retoma a verificação interrompida: refaz a escolha como se o pedido ainda estivesse na fila.
      marcadorId = escolha.id
      const id = escolha.id
      escolha = escolherProximo({
        ...entrada,
        pedidos: pedidos.map((p) => (p.id === id ? { ...p, estado: 'na_fila' } : p)),
      })
      if (escolha.tipo !== 'publicar') {
        await this.voltarParaFila(marcadorId)
        return
      }
    } else if (escolha.tipo === 'publicar') {
      marcadorId = escolha.obrigatorioId ?? escolha.ids.at(-1)!
      if (!(await this.marcar(marcadorId))) return
    } else {
      return
    }

    const { obrigatorioId, lote } = escolha
    let janela = escolha.ids.slice(-MAXIMO_PARA_JUNTAR)
    if (obrigatorioId !== null && !janela.includes(obrigatorioId)) {
      janela = [obrigatorioId, ...escolha.ids.slice(-(MAXIMO_PARA_JUNTAR - 1))]
    }

    // Revalida tudo com a cabeça de main deste ciclo, mesmo o já verificado contra o mesmo no ar:
    // depois de um push forçado em main, um commit verificado antes pode não estar mais nela.
    const porId = new Map(linhas.map((p) => [p.id, p]))
    const aceitos: string[] = []
    for (const id of janela) {
      const p = porId.get(id)!
      const estado = id === marcadorId ? 'VERIFICANDO' : 'NA_FILA'
      const r = await this.aplicar(id, estado, await this.avaliar(p.commit!))
      if (r === 'aceito') aceitos.push(id)
      if (r === 'tentar_de_novo' && id === marcadorId) return
    }
    if (aceitos.length === 0 || (obrigatorioId !== null && !aceitos.includes(obrigatorioId))) {
      await this.voltarParaFila(marcadorId)
      return
    }

    const contidos = await this.contencoes(aceitos.map((id) => porId.get(id)!.commit!))
    const commitDe = (id: string) => porId.get(id)!.commit!
    const contem = (a: string, b: string) =>
      commitDe(a) === commitDe(b) || contidos.has(`${commitDe(a)}>${commitDe(b)}`)
    const { candidatoId, atendidos } = escolherCandidato(aceitos, contem, obrigatorioId)

    const marcou = await comTrava(this.repo.id, async (tx) => {
      const config = await tx.configuracaoDePublicacao.findUniqueOrThrow({
        where: { repositorioId: this.repo.id },
      })
      const vivos = await tx.pedidoDePublicacao.findMany({
        where: {
          id: { in: [candidatoId, ...atendidos] },
          estado: { in: [...EM_ESPERA] },
          atendidoPorId: null,
        },
        select: { id: true },
      })
      const vivo = new Set(vivos.map((v) => v.id))
      const mudou =
        config.pausado !== this.config.pausado ||
        config.situacao !== this.config.situacao ||
        (await pausaGeralAtiva(tx)) !== entrada.pausaGeral
      if (mudou || !vivo.has(candidatoId)) {
        await tx.pedidoDePublicacao.updateMany({
          where: { id: marcadorId, estado: 'VERIFICANDO' },
          data: { estado: 'NA_FILA', verificandoDesde: null },
        })
        return false
      }
      const atendidosVivos = atendidos.filter((id) => vivo.has(id))
      await tx.pedidoDePublicacao.updateMany({
        where: { id: { in: atendidosVivos } },
        data: {
          estado: 'PUBLICANDO',
          atendidoPorId: candidatoId,
          iniciadoEm: this.agora,
          loteEm: lote,
        },
      })
      if (marcadorId !== candidatoId && !atendidosVivos.includes(marcadorId)) {
        await tx.pedidoDePublicacao.updateMany({
          where: { id: marcadorId, estado: 'VERIFICANDO' },
          data: { estado: 'NA_FILA', verificandoDesde: null },
        })
      }
      await tx.pedidoDePublicacao.update({
        where: { id: candidatoId },
        data: {
          estado: 'PUBLICANDO',
          iniciadoEm: this.agora,
          disparoTentadoEm: this.agora,
          loteEm: lote,
        },
      })
      if (lote !== null) {
        await tx.configuracaoDePublicacao.update({
          where: { repositorioId: this.repo.id },
          data: { ultimoLoteEm: lote },
        })
      }
      return true
    })
    if (!marcou) return

    await this.disparar(candidatoId, commitDe(candidatoId))
  }

  /** Pares `a>b` (o commit `a` contém `b`), com uma comparação por par. */
  private async contencoes(commits: readonly string[]): Promise<Set<string>> {
    const unicos = [...new Set(commits)]
    const contidos = new Set<string>()
    for (let i = 0; i < unicos.length; i++) {
      for (let j = i + 1; j < unicos.length; j++) {
        const a = unicos[i]!
        const b = unicos[j]!
        const r = relacaoDoCompare((await this.comparar(b, a)).status)
        if (r === 'a_frente' || r === 'identico') contidos.add(`${a}>${b}`)
        if (r === 'atras' || r === 'identico') contidos.add(`${b}>${a}`)
      }
    }
    return contidos
  }

  // Não idempotente: o disparo só sai depois de `disparoTentadoEm` gravado; se a resposta se
  // perder, o ciclo seguinte procura a execução pelo commit em vez de disparar de novo.
  private async disparar(candidatoId: string, commit: string) {
    this.resumo.disparados += 1
    try {
      const { branch } = await this.lerCabeca()
      await this.fonte.dispararWorkflow(this.ref, this.config.workflow, branch, {
        [this.config.entradaDoCommit]: commit,
      })
      await this.buscarExecucao(candidatoId, commit, this.agora)
    } catch (erro) {
      if (!(erro instanceof ErroDeIntegracao)) throw erro
      // Guarda a resposta do GitHub: se nenhuma execução aparecer, ela vai para o conserto.
      await db.pedidoDePublicacao.updateMany({
        where: { id: candidatoId, estado: 'PUBLICANDO', execucaoId: null },
        data: { motivo: `${PREFIXO_DO_DISPARO}${erro.message}` },
      })
      log.warn(
        {
          tarefa: 'processar-fila-de-publicacao',
          pedidoId: candidatoId,
          erro: resumirErroParaLog(erro),
        },
        'disparo sem confirmação; a execução será procurada pelo commit',
      )
    }
  }
}

async function cancelarPendentes(repositorioId: string, agora: Date) {
  await comTrava(repositorioId, (tx) =>
    tx.pedidoDePublicacao.updateMany({
      where: { repositorioId, estado: { in: [...EM_ESPERA] } },
      data: {
        estado: 'CANCELADO',
        motivo: MOTIVOS.repositorioDesvinculado,
        concluidoEm: agora,
        verificandoDesde: null,
      },
    }),
  )
}

/** Passo 7: a Fábrica tem 30 min para pegar o conserto e o teto para terminar. */
async function vigiarConsertos(repositorioId: string, agora: Date, resumo: ResumoDaFila) {
  const consertos = await db.pedidoDeConserto.findMany({
    where: { repositorioId, estado: { in: [...CONSERTO_SEM_PR] } },
  })
  for (const c of consertos) {
    const decisao = decidirConserto({
      estado: c.estado.toLowerCase() as EstadoDoConserto,
      abertoEm: c.abertoEm,
      pegoEm: c.pegoEm,
      agora,
      pr: null,
    })
    if (decisao.acao !== 'parar') continue
    await comTrava(repositorioId, async (tx) => {
      const { count } = await tx.pedidoDeConserto.updateMany({
        where: { id: c.id, estado: { in: [...CONSERTO_SEM_PR] } },
        data: { estado: 'DESISTIU', motivo: decisao.motivo, encerradoEm: agora },
      })
      if (count === 0) return
      await tx.configuracaoDePublicacao.update({
        where: { repositorioId },
        data: { situacao: 'PARADO', situacaoDesde: agora, situacaoMotivo: decisao.motivo },
      })
      resumo.parados += 1
    })
  }
}

export async function processarFilaDePublicacao(
  fonte: FonteGitHub | null,
  agora: Date,
  lerVersao: LerVersaoNoAr = lerVersaoNoAr,
): Promise<ResumoDaFila> {
  const resumo: ResumoDaFila = {
    repositorios: 0,
    recusados: 0,
    dispensados: 0,
    disparados: 0,
    publicados: 0,
    falhas: 0,
    consertosAbertos: 0,
    parados: 0,
  }
  const configuracoes = await db.configuracaoDePublicacao.findMany({
    orderBy: { repositorioId: 'asc' },
    include: {
      repositorio: {
        select: {
          id: true,
          githubId: true,
          instalacaoId: true,
          nomeCompleto: true,
          projetoId: true,
          removidoDaInstalacaoEm: true,
        },
      },
    },
  })
  for (const { repositorio } of configuracoes) {
    try {
      if (repositorio.projetoId === null || repositorio.removidoDaInstalacaoEm !== null) {
        await cancelarPendentes(repositorio.id, agora)
        continue
      }
      resumo.repositorios += 1
      // Antes do ciclo, o pedido da correção mergeada já entra na vez; depois, a publicação
      // recém-terminada encerra o conserto. Só o banco: o PR vem do sincronismo do GitHub.
      resumo.parados += await avancarConsertosComPr(repositorio.id, agora)
      if (fonte !== null) {
        // A configuração relida: o passo do conserto pode ter mudado a situação da fila.
        const atual = await lerConfiguracao(repositorio.id)
        await new CicloDoRepositorio(fonte, repositorio, agora, resumo, atual, lerVersao).executar()
        resumo.parados += await avancarConsertosComPr(repositorio.id, agora)
      }
      await vigiarConsertos(repositorio.id, agora, resumo)
    } catch (erro) {
      // Integração fora: o estado fica como está e o ciclo seguinte retoma.
      const contexto = {
        tarefa: 'processar-fila-de-publicacao',
        repositorioId: repositorio.id,
        erro: resumirErroParaLog(erro),
      }
      if (erro instanceof ErroDeIntegracao) {
        log.warn(contexto, 'fila de publicação adiada: GitHub indisponível')
      } else {
        log.error(contexto, 'fila de publicação falhou neste repositório')
      }
    }
  }
  return resumo
}
