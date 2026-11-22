import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { lerRetratoMaisRecente } from '@/modules/fabrica/queries'
import {
  aprovarDesenho,
  concluirEtapaPeloPaulo,
  decidirDestino,
  encerrarDemanda,
  pedirAjuste,
  retomarDemanda,
} from '@/modules/demandas/service'
import { jsonCanonico } from '@/modules/demandas/transicoes'
import { ErroDeIntegracao } from '@/modules/github/erros'
import {
  obterFonteGitHub,
  type FonteGitHub,
  type PullRequestParaMerge,
  type RefRepositorio,
} from '@/modules/github/fonte'
import { mensagemDeFalha, resumirChecks, resumirErroParaLog } from '@/modules/github/model'
import {
  arquivosForaDoPermitido,
  avaliarMerge,
  efeitoDoCartao,
  estadoDoCi,
  validarCartao,
  type Cartao,
  type ContextoDoItem,
  type Efeito,
  type EstadoDoCi,
} from './cartao'
import { montarPilha, type ItemDaPilha } from './model'
import { decisoesDoRetrato, demandasEsperando, localizarItem } from './queries'

export type ResultadoDaConfirmacao =
  { resultado: 'confirmado'; proximaChave: string | null } | { resultado: 'recusado'; erro: string }

type Encerramento = 'confirmada' | 'resolvida_fora'
type Tx = Prisma.TransactionClient

/** Prazo da posse de um `CONFIRMANDO`; cada chamada ao GitHub tem teto de 15 s. */
const TEMPO_DA_TRAVA = 5 * 60_000

const NAO_ENCONTRADO = 'Cartão não encontrado.'
const TROCADO = 'Este cartão foi trocado por outro.'
const REGISTRANDO = 'Já estou registrando esta decisão.'
const RESOLVIDO = 'Este item já foi resolvido.'
const RESOLVIDO_FORA = 'Resolvido por outro caminho.'
const SEM_APP = 'A GitHub App não está configurada.'
const VERSAO_NOVA = 'Há uma versão mais nova do desenho.'
const ETAPA_MUDOU = 'A etapa da demanda mudou. Confira de novo.'
const NAO_MERGEAVEL = 'O GitHub recusou o merge. Abra o PR para ver o motivo.'

/** Os campos que o Flow preenche a partir do item; nunca voltam ao `validarCartao` como proposta. */
const CAMPOS_DO_FLOW = ['versao', 'pr', 'numero', 'head', 'protegidos', 'etapa'] as const

/** O evento que cada efeito de demanda grava (para a recuperação ver se já passou). */
const EVENTO_DO_EFEITO: Partial<Record<Cartao['acao'], string>> = {
  destino: 'destino_decidido',
  recusar: 'encerrada_pelo_paulo',
  encerrar: 'encerrada_pelo_paulo',
  aprovar_desenho: 'desenho_aprovado',
  ajustar_desenho: 'ajuste_pedido',
  retomar: 'retomada',
  concluir: 'etapa_concluida_pelo_paulo',
}

const HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue
}

function contextoDa(contexto: Prisma.JsonValue): ContextoDoItem & Record<string, unknown> {
  const v = contexto as unknown as (Partial<ContextoDoItem> & Record<string, unknown>) | null
  return { ...(v ?? {}), pr: v?.pr ?? null }
}

/** Trava conversa e cartão nesta ordem (a mesma do service da conversa). */
async function travar(tx: Tx, conversaId: string, cartaoId: string) {
  await tx.$queryRaw`SELECT 1 FROM "Conversa" WHERE id = ${conversaId} FOR UPDATE`
  await tx.$queryRaw`SELECT 1 FROM "CartaoDeFecho" WHERE id = ${cartaoId} FOR UPDATE`
  return tx.cartaoDeFecho.findUnique({ where: { id: cartaoId }, include: { conversa: true } })
}

/** Quem marcou o `CONFIRMANDO`: só ele escreve o resultado (o `confirmandoEm` é a marca). */
interface Posse {
  cartaoId: string
  conversaId: string
  desde: Date
}

/** Outro processo assumiu o cartão (o prazo venceu): quem perdeu não escreve nada. */
class PossePerdida extends Error {}

/** Trava e devolve o cartão só se ele ainda for desta posse. */
async function travarComPosse(tx: Tx, posse: Posse) {
  const c = await travar(tx, posse.conversaId, posse.cartaoId)
  if (!c || c.estado !== 'CONFIRMANDO') return null
  return c.confirmandoEm?.getTime() === posse.desde.getTime() ? c : null
}

/** Grava `progresso` sob a posse, antes de uma escrita no GitHub que não pode se repetir. */
async function anotarProgresso(posse: Posse, novo: Record<string, boolean>): Promise<void> {
  await db.$transaction(async (tx) => {
    const c = await travarComPosse(tx, posse)
    if (!c) throw new PossePerdida()
    await tx.cartaoDeFecho.update({
      where: { id: posse.cartaoId },
      data: { progresso: json({ ...((c.progresso ?? {}) as object), ...novo }) },
    })
  })
}

/** Marca do comentário do Flow na issue: uma nova tentativa vê que já comentou. */
export function marcadorDoCartao(cartaoId: string): string {
  return `<!-- flow:cartao:${cartaoId} -->`
}

/**
 * Já comentamos esta resposta? `comentado` é certeza; `comentando` (gravado antes do POST) pede
 * conferir os comentários da issue pela marca de qualquer cartão desta conversa.
 */
async function jaComentou(
  fonte: FonteGitHub,
  ref: RefRepositorio,
  numero: number,
  conversaId: string,
  progresso: Record<string, unknown>,
): Promise<boolean> {
  if (progresso.comentado === true) return true
  if (progresso.comentando !== true) return false
  const cartoes = await db.cartaoDeFecho.findMany({ where: { conversaId }, select: { id: true } })
  const marcas = cartoes.map((c) => marcadorDoCartao(c.id))
  const comentarios = await fonte.listarComentariosDaIssue(ref, numero)
  return comentarios.some((c) => marcas.some((m) => c.corpo.includes(m)))
}

export async function encerrarConversa(
  tx: Tx,
  conversaId: string,
  encerramento: Encerramento,
  texto: string,
  agora: Date,
): Promise<void> {
  await tx.conversa.update({
    where: { id: conversaId },
    data: { encerradaEm: agora, encerramento, aguardaAgenteDesde: null, responderA: null },
  })
  await tx.mensagem.create({
    data: {
      id: randomUUID(),
      conversaId,
      autor: 'FLOW',
      texto,
      impressao: jsonCanonico({ texto }),
      criadaEm: agora,
    },
  })
}

// ---------------------------------------------------------------------------------------------
// Efeito

type Aplicado =
  | { ok: true; encerramento: Encerramento }
  | { ok: 'guardado' }
  | {
      ok: false
      erro: string
      progresso?: Record<string, boolean>
      /** O PR mudou: o cartão é refeito com o head novo (o Paulo confere de novo). */
      refazer?: { cartao: Cartao; pr: NonNullable<ContextoDoItem['pr']> }
    }

interface Alvo {
  cartao: Cartao
  progresso: Record<string, unknown>
  repositorio: string
  posse: Posse
}

function mensagemDoErro(erro: unknown): string {
  if (erro instanceof ErroDeDominio || erro instanceof ErroDeIntegracao) return erro.message
  log.error({ erro: resumirErroParaLog(erro) }, 'decidir: falha inesperada ao confirmar o cartão')
  return mensagemDeFalha('desconhecida')
}

async function refDoRepositorio(nome: string): Promise<RefRepositorio | string> {
  const repo = await db.repositorioGitHub.findFirst({
    where: {
      nomeCompleto: { equals: nome, mode: 'insensitive' },
      projetoId: { not: null },
      removidoDaInstalacaoEm: null,
    },
    select: { githubId: true, instalacaoId: true, nomeCompleto: true },
  })
  return repo ?? `O repositório ${nome} não está ligado ao Flow.`
}

async function ciDoHead(
  fonte: FonteGitHub,
  ref: RefRepositorio,
  head: string,
): Promise<EstadoDoCi> {
  const [checks, status] = await Promise.all([
    fonte.listarChecks(ref, head),
    fonte.lerStatusCombinado(ref, head),
  ])
  return estadoDoCi(resumirChecks(checks), status)
}

function headMudou(head: string): string {
  return `O PR mudou desde a conferência (head ${head.slice(0, 7)}). Confira de novo.`
}

async function refazerComHeadNovo(
  fonte: FonteGitHub,
  ref: RefRepositorio,
  cartao: Extract<Cartao, { acao: 'aprovar_e_mergear' }>,
  pr: PullRequestParaMerge,
  feature: string,
): Promise<Aplicado> {
  const fora = arquivosForaDoPermitido(pr.arquivos, feature)
  const ci = await ciDoHead(fonte, ref, pr.head)
  return {
    ok: false,
    erro: headMudou(pr.head),
    refazer: {
      cartao: { ...cartao, head: pr.head, protegidos: [...fora] },
      pr: { url: cartao.pr, numero: cartao.numero, head: pr.head, fora, ci },
    },
  }
}

/** Issue já fechada: com o nosso comentário, fomos nós; sem ele, a Fábrica recebeu outra resposta. */
function encerramentoDaIssueFechada(comentado: boolean): Encerramento {
  return comentado ? 'confirmada' : 'resolvida_fora'
}

async function responderIssue(
  fonte: FonteGitHub,
  ref: RefRepositorio,
  efeito: Extract<Efeito, { tipo: 'responder_issue' }>,
  progresso: Record<string, unknown>,
  posse: Posse,
): Promise<Aplicado> {
  const issue = await fonte.lerIssue(ref, efeito.numero)
  if (!issue) return { ok: false, erro: `A issue #${efeito.numero} não foi encontrada.` }
  const comentado = await jaComentou(fonte, ref, efeito.numero, posse.conversaId, progresso)
  if (issue.estado === 'FECHADA') {
    return { ok: true, encerramento: encerramentoDaIssueFechada(comentado) }
  }
  // Gravado antes do POST: se o processo cair depois do comentário, a marca evita repetir.
  if (!comentado) await anotarProgresso(posse, { comentando: true })
  const comentario = `${efeito.comentario}\n\n${marcadorDoCartao(posse.cartaoId)}`
  try {
    await fonte.comentarEFecharIssue(ref, efeito.numero, comentario, { jaComentado: comentado })
  } catch (erro) {
    if (erro instanceof ErroDeIntegracao && erro.progresso?.comentado) {
      return { ok: false, erro: erro.message, progresso: { comentado: true } }
    }
    throw erro
  }
  return { ok: true, encerramento: 'confirmada' }
}

async function mergearPr(
  fonte: FonteGitHub,
  ref: RefRepositorio,
  repositorio: string,
  cartao: Extract<Cartao, { acao: 'aprovar_e_mergear' }>,
  feature: string,
): Promise<Aplicado> {
  const padrao = (await fonte.lerCabecaDoBranchPadrao(ref)).branch
  // Lido de novo agora, logo antes do merge: o que vale é o PR atual, não o da abertura.
  const pr = await fonte.lerPullRequestParaMerge(ref, cartao.numero)
  if (!pr) return { ok: false, erro: `O PR #${cartao.numero} não foi encontrado.` }
  const ci = pr.estado === 'ABERTO' ? await ciDoHead(fonte, ref, pr.head) : 'ausente'
  const av = avaliarMerge({ repositorio, pr, ci, cartao, feature })
  if (!av.ok) {
    return av.headNovo
      ? refazerComHeadNovo(fonte, ref, cartao, pr, feature)
      : { ok: false, erro: av.motivo }
  }
  if (pr.base !== padrao) {
    return { ok: false, erro: `O PR vai para ${pr.base}, e não para o ramo padrão (${padrao}).` }
  }
  if (av.jaMergeado) return { ok: true, encerramento: 'confirmada' }

  const r = await fonte.mergearPullRequest(ref, cartao.numero, cartao.head)
  if (r.resultado === 'mergeado') return { ok: true, encerramento: 'confirmada' }
  if (r.motivo === 'nao_mergeavel') return { ok: false, erro: NAO_MERGEAVEL }
  // 409: o head andou entre a leitura e o PUT.
  const novo = await fonte.lerPullRequestParaMerge(ref, cartao.numero)
  if (!novo || novo.head === cartao.head) return { ok: false, erro: headMudou(cartao.head) }
  return refazerComHeadNovo(fonte, ref, cartao, novo, feature)
}

async function aplicarEfeito(
  sujeito: Sujeito,
  efeito: Efeito,
  alvo: Alvo,
  fonteDe: () => FonteGitHub | null,
): Promise<Aplicado> {
  try {
    switch (efeito.tipo) {
      case 'guardar':
        return { ok: 'guardado' }
      case 'decidir_destino':
        await decidirDestino(sujeito, efeito.demandaId, efeito.destino, efeito.extras)
        return { ok: true, encerramento: 'confirmada' }
      case 'encerrar_demanda':
        await encerrarDemanda(sujeito, efeito.demandaId)
        return { ok: true, encerramento: 'confirmada' }
      case 'aprovar_desenho':
        await aprovarDesenho(sujeito, efeito.demandaId, efeito.versao)
        return { ok: true, encerramento: 'confirmada' }
      case 'pedir_ajuste':
        await pedirAjuste(sujeito, efeito.demandaId, efeito.versao, efeito.texto)
        return { ok: true, encerramento: 'confirmada' }
      case 'retomar':
        await retomarDemanda(sujeito, efeito.demandaId, efeito.resposta)
        return { ok: true, encerramento: 'confirmada' }
      case 'concluir_etapa':
        await concluirEtapaPeloPaulo(sujeito, efeito.demandaId, efeito.chave)
        return { ok: true, encerramento: 'confirmada' }
      case 'responder_issue':
      case 'mergear_pr': {
        const fonte = fonteDe()
        if (!fonte) return { ok: false, erro: SEM_APP }
        const ref = await refDoRepositorio(alvo.repositorio)
        if (typeof ref === 'string') return { ok: false, erro: ref }
        if (efeito.tipo === 'responder_issue') {
          return await responderIssue(fonte, ref, efeito, alvo.progresso, alvo.posse)
        }
        if (alvo.cartao.acao !== 'aprovar_e_mergear') return { ok: false, erro: NAO_ENCONTRADO }
        return await mergearPr(fonte, ref, alvo.repositorio, alvo.cartao, efeito.feature)
      }
    }
  } catch (erro) {
    // Quem perdeu a posse não escreve nada; `falhar` também não (a posse não é mais dele).
    if (erro instanceof PossePerdida) return { ok: false, erro: REGISTRANDO }
    return { ok: false, erro: mensagemDoErro(erro) }
  }
}

// ---------------------------------------------------------------------------------------------
// Revalidação e recuperação

/** O cartão guardado contra o item atual: a versão do desenho e a etapa vêm do item, de novo. */
function revalidar(item: ItemDaPilha, contexto: ContextoDoItem, cartao: Cartao): string | null {
  const proposta: Record<string, unknown> = { ...cartao }
  for (const campo of CAMPOS_DO_FLOW) delete proposta[campo]
  // O PR é conferido pelas guardas do merge, com o PR lido agora.
  if (cartao.acao === 'aprovar_e_mergear') return null
  const v = validarCartao(item, contexto, proposta)
  if (!v.ok) return v.motivo
  const novo = v.cartao as Record<string, unknown>
  const guardado = cartao as Record<string, unknown>
  if ('versao' in guardado && novo.versao !== guardado.versao) return VERSAO_NOVA
  if ('etapa' in guardado && novo.etapa !== guardado.etapa) return ETAPA_MUDOU
  return null
}

const NUMERO_DA_ISSUE = /\/issues\/(\d+)$/

/**
 * O processo morreu em `CONFIRMANDO` e o item já saiu da pilha: o efeito passou? Confere o estado
 * real (evento da demanda depois do início; PR mergeado com o head do cartão; issue fechada, com o
 * mesmo critério do caminho normal) e nunca aplica de novo. `null`: não passou.
 */
async function efeitoJaAplicado(
  conversa: { id: string; demandaId: string | null; issueUrl: string | null; repositorio: string },
  cartao: Cartao,
  progresso: Record<string, unknown>,
  desde: Date,
  fonteDe: () => FonteGitHub | null,
): Promise<Encerramento | null> {
  const evento = EVENTO_DO_EFEITO[cartao.acao]
  if (evento) {
    if (!conversa.demandaId) return null
    const n = await db.eventoDaDemanda.count({
      where: {
        demandaId: conversa.demandaId,
        origem: 'paulo',
        tipo: evento,
        registradoEm: { gte: desde },
      },
    })
    return n > 0 ? 'confirmada' : null
  }
  const doGitHub: readonly Cartao['acao'][] = ['aprovar_e_mergear', 'responder', 'pedir_mudanca']
  if (!doGitHub.includes(cartao.acao)) return null
  const fonte = fonteDe()
  if (!fonte) throw new ErroDeDominio(SEM_APP)
  const ref = await refDoRepositorio(conversa.repositorio)
  if (typeof ref === 'string') return null
  if (cartao.acao === 'aprovar_e_mergear') {
    const pr = await fonte.lerPullRequestParaMerge(ref, cartao.numero)
    return pr?.estado === 'MERGEADO' && pr.head === cartao.head ? 'confirmada' : null
  }
  const numero = Number(NUMERO_DA_ISSUE.exec(conversa.issueUrl ?? '')?.[1])
  if (!numero) return null
  const issue = await fonte.lerIssue(ref, numero)
  if (issue?.estado !== 'FECHADA') return null
  return encerramentoDaIssueFechada(await jaComentou(fonte, ref, numero, conversa.id, progresso))
}

// ---------------------------------------------------------------------------------------------
// Pilha

async function proximaChave(chave: string, agora: Date): Promise<string | null> {
  const [demandas, retrato] = await Promise.all([demandasEsperando(), lerRetratoMaisRecente()])
  const decisoes = decisoesDoRetrato(retrato?.retrato ?? null)
  const linhas = await db.conversa.findMany({
    select: { chave: true, encerradaEm: true, guardadaEm: true, adiadaAte: true, puladaEm: true },
  })
  const { itens } = montarPilha({
    demandas,
    decisoes,
    marcas: linhas.map((c) => ({
      chave: c.chave,
      encerrada: c.encerradaEm !== null,
      guardadaEm: c.guardadaEm,
      adiadaAte: c.adiadaAte,
      puladaEm: c.puladaEm,
    })),
    agora,
    nomeDoProjeto: () => null,
  })
  return itens.find((i) => i.chave !== chave)?.chave ?? null
}

// ---------------------------------------------------------------------------------------------
// Confirmar

type Inicio =
  | { tipo: 'pronto' }
  | { tipo: 'recusa'; erro: string }
  | { tipo: 'seguir' }
  | { tipo: 'recuperar'; desde: Date }

export async function confirmarCartao(
  sujeito: Sujeito,
  cartaoId: string,
  agora: Date,
  deps: { fonte?: FonteGitHub | null } = {},
): Promise<ResultadoDaConfirmacao> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  const fonteDe = () => (deps.fonte !== undefined ? deps.fonte : obterFonteGitHub(process.env))

  const linha = await db.cartaoDeFecho.findUnique({
    where: { id: cartaoId },
    select: { conversa: { select: { id: true, chave: true } } },
  })
  if (!linha) return { resultado: 'recusado', erro: NAO_ENCONTRADO }
  const { id: conversaId, chave } = linha.conversa
  const confirmado = async (): Promise<ResultadoDaConfirmacao> => ({
    resultado: 'confirmado',
    proximaChave: await proximaChave(chave, agora),
  })
  // Lido fora da transação (o retrato pode ser grande); a transação decide pelo estado do cartão.
  const localizado = await localizarItem(chave, agora)

  // 1. Trava: só um `CONFIRMANDO` por vez; um velho demais é retomado (o processo morreu).
  const inicio = await db.$transaction(async (tx): Promise<Inicio> => {
    const c = await travar(tx, conversaId, cartaoId)
    if (!c) return { tipo: 'recusa', erro: NAO_ENCONTRADO }
    if (c.estado === 'CONFIRMADO') return { tipo: 'pronto' }
    if (c.estado === 'SUBSTITUIDO') return { tipo: 'recusa', erro: TROCADO }
    const recuperando = c.estado === 'CONFIRMANDO'
    if (
      recuperando &&
      c.confirmandoEm &&
      agora.getTime() - c.confirmandoEm.getTime() < TEMPO_DA_TRAVA
    ) {
      return { tipo: 'recusa', erro: REGISTRANDO }
    }
    if (c.conversa.encerradaEm) return { tipo: 'recusa', erro: RESOLVIDO }
    if (!localizado && !recuperando) {
      // Nunca começou: o item saiu da pilha por outro caminho.
      await tx.cartaoDeFecho.update({ where: { id: cartaoId }, data: { erro: RESOLVIDO } })
      await encerrarConversa(tx, conversaId, 'resolvida_fora', RESOLVIDO_FORA, agora)
      return { tipo: 'recusa', erro: RESOLVIDO }
    }
    await tx.cartaoDeFecho.update({
      where: { id: cartaoId },
      data: { estado: 'CONFIRMANDO', confirmandoEm: agora, erro: null },
    })
    if (!localizado) return { tipo: 'recuperar', desde: c.confirmandoEm ?? agora }
    return { tipo: 'seguir' }
  })
  if (inicio.tipo === 'pronto') return confirmado()
  if (inicio.tipo === 'recusa') return { resultado: 'recusado', erro: inicio.erro }
  const posse: Posse = { cartaoId, conversaId, desde: agora }

  // Daqui em diante o cartão está em `CONFIRMANDO` e é nosso.
  const atual = await db.cartaoDeFecho.findUniqueOrThrow({
    where: { id: cartaoId },
    include: { conversa: true },
  })
  const cartao = atual.conteudo as unknown as Cartao
  const progresso = (atual.progresso ?? {}) as Record<string, unknown>
  const conversa = atual.conversa

  let aplicado: Aplicado
  if (inicio.tipo === 'recuperar') {
    let feito: Encerramento | null
    try {
      feito = await efeitoJaAplicado(conversa, cartao, progresso, inicio.desde, fonteDe)
    } catch (erro) {
      return falhar(posse, { ok: false, erro: mensagemDoErro(erro) })
    }
    if (feito === null) {
      const ganhou = await db.$transaction(async (tx) => {
        if (!(await travarComPosse(tx, posse))) return false
        await tx.cartaoDeFecho.update({
          where: { id: cartaoId },
          data: { estado: 'PROPOSTO', confirmandoEm: null, erro: RESOLVIDO },
        })
        await encerrarConversa(tx, conversaId, 'resolvida_fora', RESOLVIDO_FORA, agora)
        return true
      })
      return { resultado: 'recusado', erro: ganhou ? RESOLVIDO : REGISTRANDO }
    }
    aplicado = { ok: true, encerramento: feito }
  } else {
    const item = localizado!.item
    // 2. O cartão contra o item de agora.
    const motivo = revalidar(item, contextoDa(conversa.contexto), cartao)
    if (motivo !== null) return falhar(posse, { ok: false, erro: motivo })

    // 3. O efeito, pelos services de demandas ou pelo GitHub (repositório da URL da issue).
    let efeito: Efeito
    try {
      efeito = efeitoDoCartao(item, cartao)
    } catch (erro) {
      return falhar(posse, { ok: false, erro: mensagemDoErro(erro) })
    }
    aplicado = await aplicarEfeito(
      sujeito,
      efeito,
      { cartao, progresso, repositorio: conversa.repositorio, posse },
      fonteDe,
    )
  }

  if (aplicado.ok === false) return falhar(posse, aplicado)

  // 4. Sucesso numa transação.
  const nome =
    (await db.usuario.findUnique({ where: { id: sujeito.usuarioId }, select: { nome: true } }))
      ?.nome ?? 'você'
  const efeitoFinal = aplicado
  const ganhou = await db.$transaction(async (tx) => {
    // Outro processo assumiu (prazo vencido): ele decide o resultado; este não sobrescreve.
    if (!(await travarComPosse(tx, posse))) return false
    if (efeitoFinal.ok === 'guardado') {
      await tx.cartaoDeFecho.update({
        where: { id: cartaoId },
        data: { estado: 'SUBSTITUIDO', confirmandoEm: null },
      })
      await tx.conversa.update({ where: { id: conversaId }, data: { guardadaEm: agora } })
      return true
    }
    await tx.cartaoDeFecho.update({
      where: { id: cartaoId },
      data: {
        estado: 'CONFIRMADO',
        confirmadoEm: agora,
        confirmadoPorId: sujeito.usuarioId,
        erro: null,
      },
    })
    const texto =
      efeitoFinal.encerramento === 'confirmada'
        ? `Registrado por ${nome} às ${HORA.format(agora)}.`
        : RESOLVIDO_FORA
    await encerrarConversa(tx, conversaId, efeitoFinal.encerramento, texto, agora)
    return true
  })
  if (!ganhou) return { resultado: 'recusado', erro: REGISTRANDO }
  // 5. O próximo da pilha recalculada.
  return confirmado()
}

/** Falha: o cartão volta a `PROPOSTO` com o erro (ou é refeito com o head novo); nada mais muda. */
async function falhar(
  posse: Posse,
  f: Extract<Aplicado, { ok: false }>,
): Promise<ResultadoDaConfirmacao> {
  const { cartaoId, conversaId } = posse
  const ganhou = await db.$transaction(async (tx) => {
    const c = await travarComPosse(tx, posse)
    if (!c) return false
    const progresso = f.progresso
      ? { progresso: json({ ...((c.progresso ?? {}) as object), ...f.progresso }) }
      : {}
    if (!f.refazer) {
      await tx.cartaoDeFecho.update({
        where: { id: cartaoId },
        data: { estado: 'PROPOSTO', confirmandoEm: null, erro: f.erro, ...progresso },
      })
      return true
    }
    await tx.cartaoDeFecho.update({
      where: { id: cartaoId },
      data: { estado: 'SUBSTITUIDO', confirmandoEm: null, erro: f.erro },
    })
    await tx.cartaoDeFecho.create({
      data: {
        conversaId,
        mensagemSeq: null,
        origem: 'flow',
        conteudo: json(f.refazer.cartao),
        erro: f.erro,
      },
    })
    const contexto = contextoDa(c.conversa.contexto)
    await tx.conversa.update({
      where: { id: conversaId },
      data: { contexto: json({ ...contexto, pr: f.refazer.pr }) },
    })
    return true
  })
  return { resultado: 'recusado', erro: ganhou ? f.erro : REGISTRANDO }
}
