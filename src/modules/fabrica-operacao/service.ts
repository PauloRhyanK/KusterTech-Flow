/**
 * Estado operacional da Fábrica 2.0 no Postgres do Flow: planos aprovados, etapas, execuções com reserva e
 * eventos idempotentes. As decisões são as funções puras de `etapas.ts`, `reserva.ts` e `agenda.ts`; aqui só
 * se lê, trava e grava.
 */
import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { jsonCanonico } from '@/modules/demandas/transicoes'
import { hashDoTokenDaFabrica } from '@/modules/fabrica/model'
import { proximaTentativa } from './agenda'
import {
  admitir,
  aplicarResultado,
  etapasElegiveis,
  type Etapa,
  type EstadoDaEtapa,
  type ResultadoDaExecucao,
  type TipoDaEtapa,
} from './etapas'
import { DURACAO_DA_RESERVA_MS, classificarEnvio } from './reserva'
import { PREFIXO_DO_TOKEN_DO_WORKER, extrairTokenDoWorker } from './tokens'

type Tx = Prisma.TransactionClient

export interface EtapaDoPlano {
  chave: string
  tipo: TipoDaEtapa
  papel: string
  /** O que o agente deve fazer; vazio é recusado em etapas de implementação. */
  instrucoes: string
  repositorioId: string
  arquivos: string[]
  dependeDe: string[]
  prioridade: number
}

export interface TarefaParaWorker {
  execucaoId: string
  etapaId: string
  geracao: number
  /** `reconciliar`: a reserva anterior venceu; confira sessão, commits e PR antes de repetir qualquer efeito. */
  tipo: 'executar' | 'reconciliar'
  etapaChave: string
  tipoDaEtapa: TipoDaEtapa
  instrucoes: string
  papel: string
  repo: string
  prUrl: string | null
  expiraEm: string
}

export interface EnvioDeResultado {
  idExterno: string
  execucaoId: string
  geracao: number
  resultado: ResultadoDaExecucao
}

const TIPOS: readonly TipoDaEtapa[] = ['implementacao', 'leitura']
/** Ocupam arquivos: em execução ou com PR aberto esperando os gates. */
const OCUPANDO: readonly EstadoDaEtapa[] = ['executando', 'aguardando_gates']
const TRAVA_DA_ADMISSAO = Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('fabrica-operacao-admissao'))`

/** Teto de gerações (execução original + reconciliações) antes de bloquear a etapa. */
const MAX_GERACOES = 5

const expiracao = (agora: Date) => new Date(agora.getTime() + DURACAO_DA_RESERVA_MS)

// ---------------------------------------------------------------- workers

export async function criarWorker(
  sujeito: Sujeito,
  nome: string,
): Promise<{ id: string; token: string }> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')
  const limpo = nome.trim()
  if (limpo === '' || limpo.length > 80) throw new ErroDeDominio('Nome do worker inválido.')
  const token = `${PREFIXO_DO_TOKEN_DO_WORKER}${randomBytes(32).toString('base64url')}`
  const criado = await db.workerDaFabrica.create({
    data: { nome: limpo, tokenHash: hashDoTokenDaFabrica(token), criadoPorId: sujeito.usuarioId },
    select: { id: true },
  })
  return { id: criado.id, token }
}

export async function revogarWorker(sujeito: Sujeito, id: string): Promise<void> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')
  await db.workerDaFabrica.updateMany({
    where: { id, revogadoEm: null },
    data: { revogadoEm: new Date() },
  })
}

/** Revogado ou pausado não autentica. */
export async function autenticarWorker(
  authorization: string | null,
): Promise<{ id: string } | null> {
  const token = extrairTokenDoWorker(authorization)
  if (token === null) return null
  const w = await db.workerDaFabrica.findUnique({
    where: { tokenHash: hashDoTokenDaFabrica(token) },
    select: { id: true, revogadoEm: true, pausado: true },
  })
  return w && w.revogadoEm === null && !w.pausado ? { id: w.id } : null
}

// ---------------------------------------------------------------- planos

function validarEtapas(etapas: EtapaDoPlano[]): void {
  if (etapas.length === 0) throw new ErroDeDominio('O plano precisa de pelo menos uma etapa.')
  const chaves = new Set<string>()
  for (const e of etapas) {
    if (e.chave.trim() === '' || chaves.has(e.chave)) {
      throw new ErroDeDominio(`Chave de etapa vazia ou repetida: "${e.chave}".`)
    }
    chaves.add(e.chave)
    if (!TIPOS.includes(e.tipo)) throw new ErroDeDominio(`Tipo de etapa inválido: "${e.tipo}".`)
    if (e.papel.trim() === '') throw new ErroDeDominio(`Etapa "${e.chave}" sem papel.`)
    if (e.tipo === 'implementacao' && e.instrucoes.trim() === '') {
      throw new ErroDeDominio(`Etapa "${e.chave}" sem instruções.`)
    }
  }
  for (const e of etapas) {
    const falta = e.dependeDe.find((d) => !chaves.has(d) || d === e.chave)
    if (falta !== undefined) {
      throw new ErroDeDominio(`Etapa "${e.chave}" depende de "${falta}", que não está no plano.`)
    }
  }
  const ciclo = acharCiclo(etapas)
  if (ciclo !== null) throw new ErroDeDominio(`O plano tem um ciclo de dependências: ${ciclo}.`)
}

/** Primeiro ciclo encontrado (`a → b → a`) ou null. */
function acharCiclo(etapas: EtapaDoPlano[]): string | null {
  const deps = new Map(etapas.map((e) => [e.chave, e.dependeDe]))
  const estado = new Map<string, 'visitando' | 'feito'>()
  const caminho: string[] = []
  const visitar = (c: string): string | null => {
    if (estado.get(c) === 'feito') return null
    if (estado.get(c) === 'visitando') return [...caminho.slice(caminho.indexOf(c)), c].join(' → ')
    estado.set(c, 'visitando')
    caminho.push(c)
    for (const d of deps.get(c) ?? []) {
      const achado = visitar(d)
      if (achado !== null) return achado
    }
    caminho.pop()
    estado.set(c, 'feito')
    return null
  }
  for (const e of etapas) {
    const achado = visitar(e.chave)
    if (achado !== null) return achado
  }
  return null
}

/**
 * Registra uma revisão já aprovada pelo dono (a conversa de aprovação é o M4). A aprovação vale para o hash
 * do conteúdo canônico; a demanda passa a ser do motor v2.
 */
export async function registrarPlanoAprovado(
  sujeito: Sujeito,
  e: { demandaId: string; conteudo: unknown; etapas: EtapaDoPlano[] },
): Promise<{ revisaoId: string }> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')
  validarEtapas(e.etapas)
  const hash = createHash('sha256').update(jsonCanonico(e.conteudo)).digest('hex')
  const demanda = await db.demanda.findUnique({
    where: { id: e.demandaId },
    select: { projetoId: true },
  })
  if (!demanda) throw new ErroDeDominio('Demanda não encontrada.')
  const repos = [...new Set(e.etapas.map((et) => et.repositorioId))]
  const doProjeto = await db.repositorioGitHub.count({
    where: { id: { in: repos }, projetoId: demanda.projetoId },
  })
  if (doProjeto !== repos.length) {
    throw new ErroDeDominio('Toda etapa precisa de um repositório do projeto da demanda.')
  }
  return db.$transaction(async (tx) => {
    const plano = await tx.planoOperacional.upsert({
      where: { demandaId: e.demandaId },
      create: { demandaId: e.demandaId },
      update: {},
      select: { id: true },
    })
    const ultima = await tx.revisaoDoPlano.findFirst({
      where: { planoId: plano.id },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    const revisao = await tx.revisaoDoPlano.create({
      data: {
        planoId: plano.id,
        numero: (ultima?.numero ?? 0) + 1,
        conteudo: e.conteudo as Prisma.InputJsonValue,
        hash,
        aprovadaPorId: sujeito.usuarioId,
        aprovadaEm: new Date(),
      },
      select: { id: true },
    })
    await tx.etapaOperacional.createMany({
      data: e.etapas.map((et) => ({ ...et, revisaoId: revisao.id })),
    })
    await tx.demanda.update({ where: { id: e.demandaId }, data: { motor: 'v2' } })
    return { revisaoId: revisao.id }
  })
}

// ---------------------------------------------------------------- tarefas

type LinhaDaEtapa = Prisma.EtapaOperacionalGetPayload<{
  include: { repositorio: { select: { nomeCompleto: true } } }
}>

function paraEtapa(l: LinhaDaEtapa): Etapa {
  return {
    id: l.id,
    tipo: l.tipo as TipoDaEtapa,
    repo: l.repositorio.nomeCompleto,
    arquivos: l.arquivos,
    dependeDe: l.dependeDe,
    prioridade: l.prioridade,
    criadaEm: l.criadaEm.toISOString(),
    estado: l.estado as EstadoDaEtapa,
    falhasTecnicas: l.falhasTecnicas,
    correcoes: l.correcoes,
    prUrl: l.prUrl,
    motivo: l.motivo,
  }
}

/** Etapas das revisões vigentes: a última revisão aprovada de cada plano. */
async function etapasVigentes(tx: Tx): Promise<LinhaDaEtapa[]> {
  const revisoes = await tx.revisaoDoPlano.findMany({
    where: { aprovadaEm: { not: null } },
    orderBy: [{ planoId: 'asc' }, { numero: 'desc' }],
    distinct: ['planoId'],
    select: { id: true },
  })
  return tx.etapaOperacional.findMany({
    where: {
      revisaoId: { in: revisoes.map((r) => r.id) },
      // revisão sem nada pendente não tem o que oferecer
      revisao: { etapas: { some: { estado: 'pendente' } } },
    },
    include: { repositorio: { select: { nomeCompleto: true } } },
  })
}

/** Quem ocupa arquivos, de qualquer revisão: uma revisão superada com PR aberto ainda muda o código. */
async function etapasOcupando(tx: Tx): Promise<LinhaDaEtapa[]> {
  return tx.etapaOperacional.findMany({
    where: { estado: { in: [...OCUPANDO] } },
    include: { repositorio: { select: { nomeCompleto: true } } },
  })
}

async function reatribuirVencida(
  tx: Tx,
  workerId: string,
  agora: Date,
): Promise<TarefaParaWorker | null> {
  const vencida = await tx.execucaoOperacional.findFirst({
    where: { encerradaEm: null, reservaExpiraEm: { lte: agora } },
    orderBy: { reservaExpiraEm: 'asc' },
    include: { etapa: { include: { repositorio: { select: { nomeCompleto: true } } } } },
  })
  if (!vencida) return null
  if (vencida.geracao >= MAX_GERACOES) {
    // ninguém conseguiu concluir nem reconciliar: para de oferecer e pede atenção
    await tx.execucaoOperacional.updateMany({
      where: { id: vencida.id, encerradaEm: null },
      data: { encerradaEm: agora, reservaExpiraEm: null },
    })
    await tx.etapaOperacional.update({
      where: { id: vencida.etapaId },
      data: {
        estado: 'bloqueada',
        motivo: `reconciliação falhou ${vencida.geracao} vezes: conferir sessão, commits e PR`,
      },
    })
    return null
  }
  // condicional: um resultado gravado entre a leitura e aqui encerra a execução e ela não reabre
  const { count } = await tx.execucaoOperacional.updateMany({
    where: {
      id: vencida.id,
      encerradaEm: null,
      geracao: vencida.geracao,
      reservaExpiraEm: { lte: agora },
    },
    data: { geracao: vencida.geracao + 1, workerId, reservaExpiraEm: expiracao(agora) },
  })
  if (count === 0) return null
  const atualizada = await tx.execucaoOperacional.findUniqueOrThrow({ where: { id: vencida.id } })
  return {
    execucaoId: atualizada.id,
    etapaId: vencida.etapaId,
    geracao: atualizada.geracao,
    tipo: 'reconciliar',
    etapaChave: vencida.etapa.chave,
    tipoDaEtapa: vencida.etapa.tipo as TipoDaEtapa,
    instrucoes: vencida.etapa.instrucoes,
    papel: vencida.papel,
    repo: vencida.etapa.repositorio.nomeCompleto,
    prUrl: vencida.etapa.prUrl,
    expiraEm: atualizada.reservaExpiraEm!.toISOString(),
  }
}

/**
 * Uma tarefa por chamada. Primeiro, uma execução com reserva vencida (para reconciliar); depois, uma etapa
 * elegível que não colide com nenhuma em curso. A admissão é serializada por trava de transação: dois
 * workers ao mesmo tempo nunca levam a mesma etapa.
 */
export async function pegarTarefa(workerId: string, agora: Date): Promise<TarefaParaWorker | null> {
  return db.$transaction(async (tx) => {
    const worker = await tx.workerDaFabrica.findUnique({
      where: { id: workerId },
      select: { revogadoEm: true, pausado: true },
    })
    if (!worker || worker.revogadoEm !== null || worker.pausado) return null
    await tx.$executeRaw(TRAVA_DA_ADMISSAO)
    await tx.workerDaFabrica.update({ where: { id: workerId }, data: { ultimoSinalEm: agora } })

    const reconciliar = await reatribuirVencida(tx, workerId, agora)
    if (reconciliar) return reconciliar

    const linhas = await etapasVigentes(tx)
    const porRevisao = new Map<string, LinhaDaEtapa[]>()
    for (const l of linhas) porRevisao.set(l.revisaoId, [...(porRevisao.get(l.revisaoId) ?? []), l])
    const candidatas: Etapa[] = []
    for (const grupo of porRevisao.values()) {
      // dependências são chaves dentro da revisão; a regra pura trabalha com ids
      const idDaChave = new Map(grupo.map((l) => [l.chave, l.id]))
      const etapas = grupo.map((l) => ({
        ...paraEtapa(l),
        dependeDe: l.dependeDe.map((c) => idDaChave.get(c) ?? `ausente:${c}`),
      }))
      const elegiveis = new Set(etapasElegiveis(etapas))
      for (const [i, et] of etapas.entries()) {
        const espera = grupo[i]!.proximaTentativaEm
        if (elegiveis.has(et.id) && (espera === null || espera <= agora)) candidatas.push(et)
      }
    }
    const ativas = (await etapasOcupando(tx)).map(paraEtapa)
    const [escolhida] = admitir(candidatas, ativas, 1)
    if (escolhida === undefined) return null
    const linha = linhas.find((l) => l.id === escolhida)!

    const tentativas = await tx.execucaoOperacional.count({ where: { etapaId: linha.id } })
    const execucao = await tx.execucaoOperacional.create({
      data: {
        etapaId: linha.id,
        tentativa: tentativas + 1,
        papel: linha.papel,
        workerId,
        geracao: 1,
        reservaExpiraEm: expiracao(agora),
        iniciadaEm: agora,
      },
    })
    await tx.etapaOperacional.update({
      where: { id: linha.id },
      data: { estado: 'executando', motivo: null, proximaTentativaEm: null },
    })
    return {
      execucaoId: execucao.id,
      etapaId: linha.id,
      geracao: 1,
      tipo: 'executar',
      etapaChave: linha.chave,
      tipoDaEtapa: linha.tipo as TipoDaEtapa,
      instrucoes: linha.instrucoes,
      papel: linha.papel,
      repo: linha.repositorio.nomeCompleto,
      prUrl: linha.prUrl,
      expiraEm: execucao.reservaExpiraEm!.toISOString(),
    }
  })
}

/** Heartbeat: renova só a reserva viva do mesmo worker e da mesma geração. */
export async function sinalizar(
  workerId: string,
  execucaoId: string,
  geracao: number,
  agora: Date,
): Promise<'renovado' | 'obsoleto'> {
  const { count } = await db.execucaoOperacional.updateMany({
    where: {
      id: execucaoId,
      workerId,
      geracao,
      encerradaEm: null,
      reservaExpiraEm: { gt: agora },
    },
    data: { reservaExpiraEm: expiracao(agora) },
  })
  if (count === 0) return 'obsoleto'
  await db.workerDaFabrica.update({ where: { id: workerId }, data: { ultimoSinalEm: agora } })
  return 'renovado'
}

// ---------------------------------------------------------------- resultados

const ehUnicoRepetido = (erro: unknown) =>
  erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002'

/**
 * Aplica o resultado de uma execução uma única vez. Mesmo `idExterno` com o mesmo conteúdo é `repetido`;
 * com outro conteúdo, `conflito`. Envio de outro worker, de geração antiga ou de execução encerrada é
 * `obsoleto` e não muda nada. `incerto` mantém a execução aberta para reconciliar.
 */
export async function receberResultado(
  workerId: string,
  envio: EnvioDeResultado,
  agora: Date,
): Promise<'aplicado' | 'repetido' | 'conflito' | 'obsoleto'> {
  const dados = { execucaoId: envio.execucaoId, geracao: envio.geracao, resultado: envio.resultado }
  const jaRecebido = async (tx: Tx | typeof db) => {
    const anterior = await tx.eventoOperacional.findUnique({
      where: { idExterno: envio.idExterno },
      select: { tipo: true, dados: true, origem: true },
    })
    if (!anterior) return null
    const mesmo =
      anterior.tipo === 'resultado' &&
      anterior.origem === `worker:${workerId}` &&
      jsonCanonico(anterior.dados) === jsonCanonico(dados)
    return mesmo ? 'repetido' : 'conflito'
  }
  try {
    return await db.$transaction(async (tx) => {
      const travadas = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "ExecucaoOperacional" WHERE "id" = ${envio.execucaoId} FOR UPDATE`
      // depois da trava: um reenvio simultâneo vê o evento que o primeiro gravou
      const anterior = await jaRecebido(tx)
      if (anterior !== null) return anterior
      if (travadas.length === 0) return 'obsoleto'
      const execucao = await tx.execucaoOperacional.findUniqueOrThrow({
        where: { id: envio.execucaoId },
      })
      if (
        execucao.encerradaEm !== null ||
        execucao.workerId !== workerId ||
        classificarEnvio({ execucaoId: execucao.id, geracao: execucao.geracao }, envio) ===
          'obsoleto'
      ) {
        return 'obsoleto'
      }
      await tx.$queryRaw`SELECT "id" FROM "EtapaOperacional" WHERE "id" = ${execucao.etapaId} FOR UPDATE`
      const linha = await tx.etapaOperacional.findUniqueOrThrow({
        where: { id: execucao.etapaId },
        include: { repositorio: { select: { nomeCompleto: true } } },
      })
      const nova = aplicarResultado(paraEtapa(linha), envio.resultado)
      const espera =
        nova.estado === 'pendente'
          ? proximaTentativa(envio.resultado, nova.falhasTecnicas, agora)
          : null
      await tx.etapaOperacional.update({
        where: { id: linha.id },
        data: {
          estado: nova.estado,
          falhasTecnicas: nova.falhasTecnicas,
          correcoes: nova.correcoes,
          prUrl: nova.prUrl,
          motivo: nova.motivo,
          proximaTentativaEm: espera,
        },
      })
      if (envio.resultado.tipo !== 'incerto') {
        await tx.execucaoOperacional.update({
          where: { id: execucao.id },
          data: {
            encerradaEm: agora,
            reservaExpiraEm: null,
            resultado: envio.resultado as Prisma.InputJsonValue,
          },
        })
      }
      await tx.eventoOperacional.create({
        data: {
          idExterno: envio.idExterno,
          entidade: 'execucao',
          entidadeId: execucao.id,
          tipo: 'resultado',
          origem: `worker:${workerId}`,
          dados: dados as Prisma.InputJsonValue,
          em: agora,
        },
      })
      return 'aplicado'
    })
  } catch (erro) {
    // o mesmo idExterno gravado ao mesmo tempo por outro pedido: o índice único decide
    if (ehUnicoRepetido(erro)) return (await jaRecebido(db)) ?? 'conflito'
    throw erro
  }
}
