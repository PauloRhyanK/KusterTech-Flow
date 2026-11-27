import { randomUUID } from 'node:crypto'
import { Prisma, type AutorDaMensagem } from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { ROTULO_DO_DESTINO } from '@/modules/demandas/apresentacao'
import {
  apagarArquivo,
  exigirArmazenamento,
  gravarParcial,
  promoverParcial,
} from '@/modules/demandas/arquivos'
import {
  CONTEUDOS_ACEITOS,
  LIMITE_POR_ARQUIVO,
  LIMITE_POR_DEMANDA,
  jsonCanonico,
} from '@/modules/demandas/transicoes'
import { ErroDeIntegracao } from '@/modules/github/erros'
import { obterFonteGitHub, type FonteGitHub, type RefRepositorio } from '@/modules/github/fonte'
import { mensagemDeFalha, resumirChecks, resumirErroParaLog } from '@/modules/github/model'
import {
  CONFIG_DA_FABRICA,
  arquivosForaDoPermitido,
  cartaoDaRespostaRapida,
  protegidosDaConfig,
  estadoDoCi,
  validarCartao,
  type Cartao,
  type ContextoDoItem,
  type EstadoDoCi,
} from './cartao'
import { LIMITE_DA_MENSAGEM, type RespostaDoAtendente } from './contrato'
import {
  respostasDoItem,
  amanhaAsSeis,
  motivosDaIssue,
  numeroDoPrDaTrava,
  textoDaTrava,
} from './model'
import { localizarItem, type ItemLocalizado } from './queries'

/** O que fica em `Conversa.contexto`: o lido ao abrir (PR do fim de fase e o relato até 4000). */
export interface ContextoDaConversa extends ContextoDoItem {
  relato: string | null
}

export interface Dependencias {
  fonte: () => FonteGitHub | null
}

const PADRAO: Dependencias = { fonte: () => obterFonteGitHub(process.env) }

export const RESPONDER_COM_MENSAGEM = 'responder_com_mensagem'
const ROTULO_DE_RESPONDER_COM_MENSAGEM = 'Responder com a minha mensagem'

const RESOLVIDO = 'Este item já foi resolvido.'
const CONVERSA_NAO_ENCONTRADA = 'Conversa não encontrada.'
const REPETIDA = 'Mensagem repetida com outro conteúdo.'
const CARTAO_EM_CONFIRMACAO = 'O cartão está sendo confirmado. Espere um instante.'
const LIMITE_DO_RELATO = 4000
const LIMITE_DA_DECISAO = LIMITE_DO_RELATO
/** O corte antigo da abertura da decisão da Fábrica: a mensagem com esse tamanho é regravada inteira. */
const CORTE_ANTIGO_DA_DECISAO = 600
const CONTINUA_NA_ISSUE = '\n\n_Continua na issue._'

function corpoDaDecisao(corpo: string): string {
  if (corpo.length <= LIMITE_DA_DECISAO) return corpo
  return corpo.slice(0, LIMITE_DA_DECISAO - CONTINUA_NA_ISSUE.length).trimEnd() + CONTINUA_NA_ISSUE
}
const MAXIMO_DE_IMAGENS = 3
const TIPOS_DE_IMAGEM = CONTEUDOS_ACEITOS.anexo.filter((t) => t.startsWith('image/'))
const DESTINOS_DO_CARTAO: readonly string[] = ['urgente', 'lote_da_noite', 'fila_de_agentes']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Tx = Prisma.TransactionClient

function ehUnicoRepetido(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002'
}

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue
}

function exigirId(id: string): void {
  if (!UUID.test(id)) throw new ErroDeDominio('Mensagem inválida.')
}

/** A trava da conversa: toda escrita nela passa por aqui, dentro da transação. */
async function travarConversa(tx: Tx, conversaId: string) {
  await tx.$queryRaw`SELECT 1 FROM "Conversa" WHERE id = ${conversaId} FOR UPDATE`
  return tx.conversa.findUnique({ where: { id: conversaId } })
}

async function conversaAberta(tx: Tx, conversaId: string) {
  const c = await travarConversa(tx, conversaId)
  if (!c) throw new ErroDeDominio(CONVERSA_NAO_ENCONTRADA)
  if (c.encerradaEm) throw new ErroDeDominio(RESOLVIDO)
  return c
}

function contextoDa(c: { contexto: Prisma.JsonValue }): ContextoDaConversa {
  const v = c.contexto as unknown as Partial<ContextoDaConversa> | null
  return { pr: v?.pr ?? null, relato: v?.relato ?? null }
}

/** Mesmo id: mesma conversa, mesmo autor e mesma impressão é repetição; o resto é conflito. */
function ehRepeticao(
  anterior: { conversaId: string; autor: AutorDaMensagem; impressao: string },
  conversaId: string,
  autores: readonly AutorDaMensagem[],
  impressao: string,
): boolean {
  return (
    anterior.conversaId === conversaId &&
    autores.includes(anterior.autor) &&
    anterior.impressao === impressao
  )
}

/**
 * Marca o `PROPOSTO` como `SUBSTITUIDO` e grava o novo. Com um cartão em `CONFIRMANDO` nada muda
 * e devolve `null` (o índice parcial só deixa um aberto por conversa).
 */
async function substituirCartao(
  tx: Tx,
  conversaId: string,
  cartao: Cartao,
  origem: 'agente' | 'flow' | 'paulo',
  mensagemSeq: bigint | null,
): Promise<string | null> {
  const confirmando = await tx.cartaoDeFecho.count({
    where: { conversaId, estado: 'CONFIRMANDO' },
  })
  if (confirmando > 0) return null
  await tx.cartaoDeFecho.updateMany({
    where: { conversaId, estado: 'PROPOSTO' },
    data: { estado: 'SUBSTITUIDO' },
  })
  const novo = await tx.cartaoDeFecho.create({
    data: { conversaId, mensagemSeq, origem, conteudo: json(cartao) },
    select: { id: true },
  })
  return novo.id
}

// ---------------------------------------------------------------------------------------------
// Abrir o item

interface Leitura {
  contexto: ContextoDaConversa
  /** Corpo da issue lido (decisão da Fábrica). */
  corpo: string | null
  /** Por que o contexto do GitHub ficou de fora; vira a mensagem de abertura. */
  aviso: string | null
  /** Na trava: o PR que ela cita e o estado lido dele, para a mensagem de abertura. */
  prDaTrava?: string
}

function contextoSemGitHub(l: ItemLocalizado): ContextoDaConversa {
  const relato = l.demanda?.descricao?.trim() || null
  return { pr: null, relato: relato ? relato.slice(0, LIMITE_DO_RELATO) : null }
}

const DONO_E_NOME_DA_ISSUE = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/issues\/\d+$/

/** Na decisão, o repositório é o da URL da issue (não o do plano); na demanda, o da demanda. */
function repositorioDoItem(item: ItemLocalizado['item']): string {
  if (item.ref.tipo !== 'issue') return item.repositorio
  return DONO_E_NOME_DA_ISSUE.exec(item.ref.url)?.[1] ?? item.repositorio
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mensagemDoErro(erro: unknown): string {
  if (erro instanceof ErroDeIntegracao) return erro.message
  log.error({ erro: resumirErroParaLog(erro) }, 'decidir: falha inesperada ao ler o GitHub')
  return mensagemDeFalha('desconhecida')
}

function repositorioLigado(nomeCompleto: string) {
  return db.repositorioGitHub.findFirst({
    where: {
      nomeCompleto: { equals: nomeCompleto, mode: 'insensitive' },
      projetoId: { not: null },
      removidoDaInstalacaoEm: null,
    },
    select: { githubId: true, instalacaoId: true, nomeCompleto: true },
  })
}

const ROTULO_DO_CI: Record<EstadoDoCi, string> = {
  verde: 'CI verde',
  pendente: 'CI rodando',
  vermelho: 'CI vermelho',
  ausente: 'não há CI configurado',
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/**
 * O PR que a trava da demanda cita (o da correção): com ele aberto, o contexto ganha o PR e o
 * cartão de merge; já mergeado, fechado ou ilegível, só a linha com o link e o porquê.
 */
async function lerPrDaTrava(
  l: ItemLocalizado,
  ref: Extract<ItemLocalizado['item']['ref'], { tipo: 'demanda' }>,
  fonte: FonteGitHub | null,
): Promise<Leitura> {
  const base = contextoSemGitHub(l)
  const semPr: Leitura = { contexto: base, corpo: null, aviso: null }
  const url = l.demanda?.urlDaTrava ?? null
  const numero = numeroDoPrDaTrava(url, l.item.repositorio)
  if (url === null || numero === null) return semPr
  const linha = (estado: string): Leitura => ({
    ...semPr,
    prDaTrava: `PR #${numero} (${url}): ${estado}`,
  })

  const repo = await repositorioLigado(l.item.repositorio)
  if (!repo) return linha(`o repositório ${l.item.repositorio} não está ligado ao Flow.`)
  if (!fonte) return linha('a GitHub App não está configurada.')
  try {
    const pr = await fonte.lerPullRequestParaMerge(repo, numero)
    if (!pr) return linha('não foi encontrado no GitHub.')
    if (pr.repositorio.toLowerCase() !== repo.nomeCompleto.toLowerCase()) {
      return linha('é de outro repositório.')
    }
    if (pr.estado === 'MERGEADO') return linha('já foi mergeado.')
    if (pr.estado === 'FECHADO') return linha('foi fechado sem merge.')
    const [checks, status] = await Promise.all([
      fonte.listarChecks(repo, pr.head),
      fonte.lerStatusCombinado(repo, pr.head),
    ])
    const ci = estadoDoCi(resumirChecks(checks), status)
    const estado = `aberto, ${ROTULO_DO_CI[ci]}, ${plural(pr.arquivos.length, 'arquivo', 'arquivos')}.`
    // Só a trava da correção vira cartão de merge (`travaDeCorrecao`); nas outras, o link e o estado.
    if (ref.prDaTrava !== numero) return linha(estado)
    const protegidosDoRepo = protegidosDaConfig(await fonte.lerArquivo(repo, CONFIG_DA_FABRICA))
    if (protegidosDoRepo === null) {
      return linha(
        `${estado} A ${CONFIG_DA_FABRICA} do repositório está ilegível; confira no GitHub.`,
      )
    }
    const fora = arquivosForaDoPermitido(pr.arquivos, null, protegidosDoRepo)
    const protegido =
      fora.length > 0 ? ` Mexe em caminho protegido: ${fora.slice(0, 5).join(', ')}.` : ''
    return {
      contexto: { ...base, pr: { url, numero, head: pr.head, fora, ci } },
      corpo: null,
      aviso: null,
      prDaTrava: `PR #${numero} (${url}): ${estado}${protegido}`,
    }
  } catch (erro) {
    return linha(`não consegui ler no GitHub. ${mensagemDoErro(erro)}`)
  }
}

async function lerContexto(l: ItemLocalizado, fonte: FonteGitHub | null): Promise<Leitura> {
  const ref = l.item.ref
  if (ref.tipo === 'demanda') {
    if (ref.espera === 'travada') return lerPrDaTrava(l, ref, fonte)
    return { contexto: contextoSemGitHub(l), corpo: null, aviso: null }
  }
  // O aviso da publicação já traz o que importa; o run está no relato do item.
  if (ref.tipo === 'publicacao') {
    return {
      contexto: { pr: null, relato: l.item.relato?.resumo ?? null },
      corpo: null,
      aviso: null,
    }
  }

  const fimDeFase = l.item.tipo === 'fim_de_fase'
  const prefixo = fimDeFase
    ? 'Não consegui ler o PR no GitHub: '
    : 'Não consegui ler a issue no GitHub: '
  const vazio = (aviso: string, relato: string | null = null): Leitura => ({
    contexto: { pr: null, relato },
    corpo: null,
    aviso,
  })

  const repositorioDaIssue = repositorioDoItem(l.item)
  const repo = await repositorioLigado(repositorioDaIssue)
  if (!repo) return vazio(`O repositório ${repositorioDaIssue} não está ligado ao Flow.`)
  if (!fonte) return vazio(`${prefixo}a GitHub App não está configurada.`)
  const refRepo: RefRepositorio = repo

  let corpo: string | null
  try {
    const issue = await fonte.lerIssue(refRepo, ref.numero)
    if (!issue) return vazio(`${prefixo}a issue #${ref.numero} não foi encontrada.`)
    corpo = issue.corpo
  } catch (erro) {
    return vazio(prefixo + mensagemDoErro(erro))
  }
  const relato = corpo?.trim() ? corpo.trim().slice(0, LIMITE_DO_RELATO) : null
  if (!fimDeFase) return { contexto: { pr: null, relato }, corpo, aviso: null }

  const linha = new RegExp(
    `^PR: (https://github\\.com/${escaparRegex(repo.nomeCompleto)}/pull/(\\d+))$`,
    'm',
  ).exec(corpo ?? '')
  if (!linha) return vazio('A issue não diz qual é o PR (falta a linha "PR: <url>").', relato)
  const numero = Number(linha[2])
  try {
    const pr = await fonte.lerPullRequestParaMerge(refRepo, numero)
    if (!pr) return vazio(`${prefixo}o PR #${numero} não foi encontrado.`, relato)
    // Sempre o repositório base do PR: um PR de outro repositório nunca vira cartão.
    if (pr.repositorio.toLowerCase() !== repo.nomeCompleto.toLowerCase()) {
      return vazio('O PR é de outro repositório.', relato)
    }
    // PR que já não está aberto não vira cartão de merge.
    if (pr.estado === 'MERGEADO') return vazio(`O PR #${numero} já foi mergeado.`, relato)
    if (pr.estado === 'FECHADO') return vazio(`O PR #${numero} foi fechado sem merge.`, relato)
    const [checks, status] = await Promise.all([
      fonte.listarChecks(refRepo, pr.head),
      fonte.lerStatusCombinado(refRepo, pr.head),
    ])
    return {
      contexto: {
        pr: {
          url: linha[1]!,
          numero,
          head: pr.head,
          fora: arquivosForaDoPermitido(pr.arquivos, ref.feature),
          ci: estadoDoCi(resumirChecks(checks), status),
        },
        relato,
      },
      corpo,
      aviso: null,
    }
  } catch (erro) {
    return vazio(prefixo + mensagemDoErro(erro), relato)
  }
}

interface Abertura {
  autor: AutorDaMensagem
  texto: string
  respostasRapidas: string[]
}

const semPontoFinal = (s: string) => s.trim().replace(/[.\s]+$/, '')

function mensagemDeAbertura(l: ItemLocalizado, leitura: Leitura): Abertura {
  const { item, demanda } = l
  const respostasRapidas = respostasDoItem(item).map((r) => r.rotulo)
  const flow = (texto: string): Abertura => ({ autor: 'FLOW', texto, respostasRapidas })
  switch (item.tipo) {
    case 'pedido':
    case 'nao_classificada': {
      const triagem = demanda?.triagem ?? null
      if (triagem) {
        const destino = DESTINOS_DO_CARTAO.includes(triagem.destino)
          ? ` Eu colocaria em ${ROTULO_DO_DESTINO[triagem.destino as keyof typeof ROTULO_DO_DESTINO]}.`
          : ''
        return flow(`${triagem.motivo}${destino}`)
      }
      const motivo = demanda?.esperaMotivo ? semPontoFinal(demanda.esperaMotivo) : ''
      return flow(
        motivo
          ? `A triagem não conseguiu classificar esta demanda: ${motivo}.`
          : 'A triagem não conseguiu classificar esta demanda.',
      )
    }
    case 'desenho': {
      const versao = item.ref.tipo === 'demanda' ? item.ref.versaoDoDesenho : 0
      return flow(`O desenho da versão ${versao} está pronto. Abra para conferir antes de aprovar.`)
    }
    case 'trava': {
      const texto = textoDaTrava(
        demanda?.espera ?? 'travada',
        demanda?.esperaMotivo ?? null,
        demanda?.desfecho ?? null,
      )
      return flow(
        leitura.prDaTrava
          ? `${texto}

${leitura.prDaTrava}`
          : texto,
      )
    }
    case 'concluir_etapa': {
      const rotulo = item.ref.tipo === 'demanda' ? item.ref.rotuloDaEtapa : ''
      return flow(
        demanda?.esperaMotivo?.trim() || `A etapa ${rotulo} espera você para ser concluída.`,
      )
    }
    case 'fim_de_fase': {
      const pr = leitura.contexto.pr
      if (leitura.aviso !== null || pr === null) return flow(leitura.aviso ?? '')
      const raias = l.decisao?.raias ?? { concluidas: 0, total: 0 }
      const fim =
        pr.fora.length > 0
          ? `O PR também mexe em: ${pr.fora.slice(0, 5).join(', ')}.`
          : 'O PR mexe só no plano.'
      const ci = pr.ci === 'ausente' ? 'não há CI configurado' : `o CI está ${pr.ci}`
      const { motivos, restantes } = motivosDaIssue(leitura.corpo)
      const porque =
        motivos.length > 0
          ? '\n\nA Fábrica pediu você por:\n' +
            [...motivos, ...(restantes > 0 ? [`e mais ${restantes}.`] : [])]
              .map((m) => `- ${m}`)
              .join('\n')
          : ''
      return flow(
        `As raias da fase entraram (${raias.concluidas} de ${raias.total}) e ${ci}. ${fim}${porque}`,
      )
    }
    case 'publicacao':
      return flow(`${item.relato?.resumo ?? item.titulo}. ${item.pergunta}`)
    case 'decisao_da_fabrica': {
      if (leitura.aviso !== null) return flow(leitura.aviso)
      const corpo = leitura.corpo?.trim()
      return flow(corpo ? corpoDaDecisao(corpo) : item.pergunta || item.titulo)
    }
  }
}

/** O cartão que o Flow já propõe ao abrir; nunca para a decisão da Fábrica. */
function cartaoDeAbertura(l: ItemLocalizado, contexto: ContextoDoItem): Cartao | null {
  const { item, demanda } = l
  switch (item.tipo) {
    case 'pedido':
    case 'nao_classificada': {
      const destino = demanda?.triagem?.destino
      if (!destino || !DESTINOS_DO_CARTAO.includes(destino)) return null
      const r = cartaoDaRespostaRapida(item, contexto, destino)
      return 'cartao' in r ? r.cartao : null
    }
    case 'fim_de_fase': {
      if (contexto.pr === null) return null
      const r = validarCartao(item, contexto, { acao: 'aprovar_e_mergear' })
      return r.ok ? r.cartao : null
    }
    // O PR da correção aberto, sem CI rodando ou vermelho: o merge já vem proposto.
    case 'trava': {
      const pr = contexto.pr
      if (pr === null || pr.ci === 'pendente' || pr.ci === 'vermelho') return null
      const r = validarCartao(item, contexto, { acao: 'aprovar_e_mergear' })
      return r.ok ? r.cartao : null
    }
    case 'concluir_etapa': {
      const r = validarCartao(item, contexto, { acao: 'concluir' })
      return r.ok ? r.cartao : null
    }
    default:
      return null
  }
}

/**
 * Cria a conversa (idempotente pela chave, sob trava da chave) ou, quando ela já existe só com as
 * marcas, completa a abertura. Com `abertura` nula grava só a linha.
 */
async function criarOuCompletar(
  l: ItemLocalizado,
  contexto: ContextoDaConversa,
  abertura: Abertura | null,
  cartao: Cartao | null,
  agora: Date,
): Promise<string> {
  const { item } = l
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`decidir-conversa:${item.chave}`}))`
    const existente = await tx.conversa.findUnique({
      where: { chave: item.chave },
      select: { id: true },
    })
    let conversaId: string
    if (existente) {
      const c = await conversaAberta(tx, existente.id)
      conversaId = c.id
      if (abertura === null) return conversaId
      const gravadas = await tx.mensagem.findMany({
        where: { conversaId },
        orderBy: { seq: 'asc' },
        take: 2,
        select: { id: true, autor: true, texto: true },
      })
      if (gravadas.length > 0) {
        // A abertura antiga da decisão da Fábrica era cortada: sozinha na conversa, é regravada inteira.
        const [unica] = gravadas
        if (
          item.tipo === 'decisao_da_fabrica' &&
          gravadas.length === 1 &&
          unica!.autor === 'FLOW' &&
          unica!.texto.length === CORTE_ANTIGO_DA_DECISAO &&
          unica!.texto !== abertura.texto
        ) {
          await tx.mensagem.update({
            where: { id: unica!.id },
            data: { texto: abertura.texto, impressao: jsonCanonico(abertura) },
          })
        }
        return conversaId
      }
      await tx.conversa.update({ where: { id: conversaId }, data: { contexto: json(contexto) } })
    } else {
      const criada = await tx.conversa.create({
        data: {
          chave: item.chave,
          tipo: item.tipo,
          demandaId: item.ref.tipo === 'demanda' ? item.ref.demandaId : null,
          issueUrl: item.ref.tipo === 'issue' ? item.ref.url : null,
          repositorio: repositorioDoItem(item),
          titulo: item.titulo,
          contexto: json(contexto),
        },
        select: { id: true },
      })
      conversaId = criada.id
      if (abertura === null) return conversaId
    }
    const mensagem = await tx.mensagem.create({
      data: {
        id: randomUUID(),
        conversaId,
        autor: abertura.autor,
        texto: abertura.texto,
        respostasRapidas: abertura.respostasRapidas,
        impressao: jsonCanonico(abertura),
        criadaEm: agora,
      },
      select: { seq: true },
    })
    if (cartao !== null) await substituirCartao(tx, conversaId, cartao, 'flow', mensagem.seq)
    return conversaId
  })
}

async function localizarOuResolvido(chave: string, agora: Date): Promise<ItemLocalizado> {
  const l = await localizarItem(chave, agora)
  if (!l) throw new ErroDeDominio(RESOLVIDO)
  return l
}

export async function abrirItem(
  sujeito: Sujeito,
  chave: string,
  agora: Date,
  deps: Dependencias = PADRAO,
): Promise<{ conversaId: string }> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  const l = await localizarOuResolvido(chave, agora)
  const existente = await db.conversa.findUnique({
    where: { chave },
    select: {
      id: true,
      _count: { select: { mensagens: true } },
      mensagens: { orderBy: { seq: 'asc' }, take: 1, select: { autor: true, texto: true } },
    },
  })
  if (existente && existente._count.mensagens > 0) {
    const [primeira] = existente.mensagens
    const cortada =
      l.item.tipo === 'decisao_da_fabrica' &&
      existente._count.mensagens === 1 &&
      primeira?.autor === 'FLOW' &&
      primeira.texto.length === CORTE_ANTIGO_DA_DECISAO
    if (!cortada) return { conversaId: existente.id }
  }

  // O GitHub é lido fora da transação: uma resposta lenta não segura conexão nem trava.
  const leitura = await lerContexto(l, deps.fonte())
  const abertura = mensagemDeAbertura(l, leitura)
  const cartao = cartaoDeAbertura(l, leitura.contexto)
  const conversaId = await criarOuCompletar(l, leitura.contexto, abertura, cartao, agora)
  return { conversaId }
}

// ---------------------------------------------------------------------------------------------
// Mensagens do Paulo

function nomeDaImagem(f: File): string {
  return f.name.trim().slice(0, 100) || 'imagem'
}

async function usadoNaConversa(cliente: Tx | typeof db, conversaId: string): Promise<number> {
  const soma = await cliente.anexoDaMensagem.aggregate({
    where: { conversaId },
    _sum: { tamanho: true },
  })
  return soma._sum.tamanho ?? 0
}

const PASSOU_DA_CONVERSA = 'Esta conversa já passou de 100 MB em imagens.'
const IMAGEM_GRANDE = 'Cada imagem pode ter até 10 MB.'

/**
 * As imagens vão para `.parcial` fora de transação; numa transação curta sob a trava da conversa
 * tudo é conferido de novo (id, encerramento, soma real) e só então os parciais são promovidos.
 */
export async function enviarMensagem(
  sujeito: Sujeito,
  e: { conversaId: string; id: string; texto: string; imagens: File[] },
  agora: Date,
): Promise<'gravada' | 'repetida'> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  exigirId(e.id)
  const texto = e.texto.trim()
  if (texto === '' && e.imagens.length === 0) {
    throw new ErroDeDominio('Escreva ou cole uma imagem.')
  }
  if (texto.length > LIMITE_DA_MENSAGEM) {
    throw new ErroDeDominio(`A mensagem pode ter até ${LIMITE_DA_MENSAGEM} caracteres.`)
  }
  if (e.imagens.length > MAXIMO_DE_IMAGENS) throw new ErroDeDominio('Envie até 3 imagens.')
  for (const f of e.imagens) {
    if (!TIPOS_DE_IMAGEM.includes(f.type)) {
      throw new ErroDeDominio('Só imagens PNG, JPEG ou WebP.')
    }
    if (f.size > LIMITE_POR_ARQUIVO) throw new ErroDeDominio(IMAGEM_GRANDE)
  }
  const imagens = e.imagens.map((f) => ({
    arquivo: f,
    anexoId: randomUUID(),
    nome: nomeDaImagem(f),
    conteudo: f.type,
    tamanho: f.size,
  }))
  const impressao = jsonCanonico({
    texto,
    imagens: imagens.map(({ nome, conteudo, tamanho }) => ({ nome, conteudo, tamanho })),
  })
  const repetida = (anterior: Parameters<typeof ehRepeticao>[0]) => {
    if (ehRepeticao(anterior, e.conversaId, ['PAULO'], impressao)) return 'repetida' as const
    throw new ErroDeDominio(REPETIDA)
  }

  const anterior = await db.mensagem.findUnique({ where: { id: e.id } })
  if (anterior) return repetida(anterior)
  const conversa = await db.conversa.findUnique({
    where: { id: e.conversaId },
    select: { encerradaEm: true },
  })
  if (!conversa) throw new ErroDeDominio(CONVERSA_NAO_ENCONTRADA)
  if (conversa.encerradaEm) throw new ErroDeDominio(RESOLVIDO)
  const declarado = imagens.reduce((s, i) => s + i.tamanho, 0)
  if ((await usadoNaConversa(db, e.conversaId)) + declarado > LIMITE_POR_DEMANDA) {
    throw new ErroDeDominio(PASSOU_DA_CONVERSA)
  }
  if (imagens.length > 0) await exigirArmazenamento()

  const gravadas: string[] = []
  const promovidas: string[] = []
  try {
    const tamanhos: number[] = []
    for (const i of imagens) {
      gravadas.push(i.anexoId)
      const r = await gravarParcial(
        e.conversaId,
        i.anexoId,
        i.arquivo.stream(),
        LIMITE_POR_ARQUIVO,
        'conversas',
      )
      if (!r.ok) throw new ErroDeDominio(IMAGEM_GRANDE)
      tamanhos.push(r.tamanho)
    }
    return await db.$transaction(async (tx) => {
      const c = await travarConversa(tx, e.conversaId)
      if (!c) throw new ErroDeDominio(CONVERSA_NAO_ENCONTRADA)
      const outra = await tx.mensagem.findUnique({ where: { id: e.id } })
      if (outra) return repetida(outra)
      if (c.encerradaEm) throw new ErroDeDominio(RESOLVIDO)
      const real = tamanhos.reduce((s, t) => s + t, 0)
      if ((await usadoNaConversa(tx, e.conversaId)) + real > LIMITE_POR_DEMANDA) {
        throw new ErroDeDominio(PASSOU_DA_CONVERSA)
      }
      await tx.mensagem.create({
        data: {
          id: e.id,
          conversaId: e.conversaId,
          autor: 'PAULO',
          texto,
          impressao,
          usuarioId: sujeito.usuarioId,
          criadaEm: agora,
        },
      })
      for (const [n, i] of imagens.entries()) {
        await promoverParcial(e.conversaId, i.anexoId, i.anexoId, 'conversas')
        promovidas.push(i.anexoId)
        await tx.anexoDaMensagem.create({
          data: {
            id: i.anexoId,
            conversaId: e.conversaId,
            mensagemId: e.id,
            nome: i.nome,
            conteudo: i.conteudo,
            tamanho: tamanhos[n]!,
          },
        })
      }
      await tx.conversa.update({
        where: { id: e.conversaId },
        data: {
          responderA: e.id,
          ...(c.aguardaAgenteDesde === null ? { aguardaAgenteDesde: agora } : {}),
        },
      })
      return 'gravada' as const
    })
  } catch (erro) {
    // A linha não foi gravada: arquivo promovido não fica sem dono.
    for (const id of promovidas) await apagarArquivo(e.conversaId, id, 'conversas')
    if (ehUnicoRepetido(erro)) throw new ErroDeDominio(REPETIDA)
    throw erro
  } finally {
    for (const id of gravadas) {
      if (!promovidas.includes(id)) await apagarArquivo(e.conversaId, id, 'conversas')
    }
  }
}

/**
 * Resposta rápida do Flow: funciona sem o agente (não marca a espera por ele). Quando a resposta
 * fecha um cartão, ele substitui o proposto.
 */
export async function responderRapido(
  sujeito: Sujeito,
  e: { conversaId: string; id: string; chave: string },
  agora: Date,
): Promise<{ faltam: string[] } | { cartaoId: string }> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  exigirId(e.id)
  const conversa = await db.conversa.findUnique({
    where: { id: e.conversaId },
    select: { chave: true, encerradaEm: true },
  })
  if (!conversa) throw new ErroDeDominio(CONVERSA_NAO_ENCONTRADA)
  if (conversa.encerradaEm) throw new ErroDeDominio(RESOLVIDO)
  const { item } = await localizarOuResolvido(conversa.chave, agora)
  const especial = item.tipo === 'decisao_da_fabrica' && e.chave === RESPONDER_COM_MENSAGEM
  const rotulo = especial
    ? ROTULO_DE_RESPONDER_COM_MENSAGEM
    : respostasDoItem(item).find((r) => r.chave === e.chave)?.rotulo
  if (!rotulo) throw new ErroDeDominio('Resposta rápida inválida.')
  const impressao = jsonCanonico({ texto: rotulo, respostaRapida: e.chave })

  return db.$transaction(async (tx) => {
    const c = await travarConversa(tx, e.conversaId)
    if (!c) throw new ErroDeDominio(CONVERSA_NAO_ENCONTRADA)
    const contexto = contextoDa(c)

    const calcular = async (): Promise<{ cartao: Cartao } | { faltam: string[] }> => {
      if (!especial) return cartaoDaRespostaRapida(item, contexto, e.chave)
      const escrita = await tx.mensagem.findFirst({
        where: { conversaId: c.id, autor: 'PAULO', respostaRapida: null, texto: { not: '' } },
        orderBy: { seq: 'desc' },
        select: { texto: true },
      })
      if (!escrita) return { faltam: ['texto'] }
      const v = validarCartao(item, contexto, { acao: 'responder', texto: escrita.texto })
      if (!v.ok) throw new ErroDeDominio(v.motivo)
      return { cartao: v.cartao }
    }

    const anterior = await tx.mensagem.findUnique({ where: { id: e.id } })
    if (anterior) {
      if (!ehRepeticao(anterior, c.id, ['PAULO'], impressao)) throw new ErroDeDominio(REPETIDA)
      const dela = await tx.cartaoDeFecho.findFirst({
        where: { conversaId: c.id, mensagemSeq: anterior.seq },
        select: { id: true },
      })
      if (dela) return { cartaoId: dela.id }
      const r = await calcular()
      return 'faltam' in r ? { faltam: [...r.faltam] } : { faltam: [] }
    }
    if (c.encerradaEm) throw new ErroDeDominio(RESOLVIDO)

    const r = await calcular()
    const mensagem = await tx.mensagem.create({
      data: {
        id: e.id,
        conversaId: c.id,
        autor: 'PAULO',
        texto: rotulo,
        respostaRapida: e.chave,
        impressao,
        usuarioId: sujeito.usuarioId,
        criadaEm: agora,
      },
      select: { seq: true },
    })
    if ('faltam' in r) return { faltam: [...r.faltam] }
    const cartaoId = await substituirCartao(tx, c.id, r.cartao, 'flow', mensagem.seq)
    if (cartaoId === null) throw new ErroDeDominio(CARTAO_EM_CONFIRMACAO)
    return { cartaoId }
  })
}

// ---------------------------------------------------------------------------------------------
// Resposta do atendente

const falhaDoAtendente = (falha: string) =>
  `O agente não conseguiu responder (${falha}). Você pode decidir pelas respostas rápidas.`

/**
 * Grava a resposta do atendente sob a trava da conversa. Texto livre nunca vira ação: o cartão
 * passa por `validarCartao` e os campos que decidem o alvo saem do item.
 */
export async function registrarRespostaDoAtendente(
  fonteId: string,
  conversaId: string,
  r: RespostaDoAtendente,
  agora: Date,
): Promise<{ status: 200 | 201 | 404 | 409 | 410 | 422; corpo: object }> {
  const conversa = await db.conversa.findUnique({
    where: { id: conversaId },
    select: { chave: true },
  })
  if (!conversa) return { status: 404, corpo: { erro: CONVERSA_NAO_ENCONTRADA } }
  const l = await localizarItem(conversa.chave, agora)
  const impressao = jsonCanonico(r)

  return db.$transaction(async (tx) => {
    const c = await travarConversa(tx, conversaId)
    if (!c) return { status: 404 as const, corpo: { erro: CONVERSA_NAO_ENCONTRADA } }
    const anterior = await tx.mensagem.findUnique({ where: { id: r.id } })
    if (anterior) {
      return ehRepeticao(anterior, conversaId, ['AGENTE', 'FLOW'], impressao)
        ? { status: 200 as const, corpo: { id: r.id } }
        : { status: 409 as const, corpo: { erro: 'Resposta repetida com outro conteúdo.' } }
    }
    if (c.encerradaEm || !l) return { status: 410 as const, corpo: { erro: RESOLVIDO } }

    let cartao: Cartao | null = null
    if ('mensagem' in r && r.cartao !== null) {
      const v = validarCartao(l.item, contextoDa(c), r.cartao)
      if (!v.ok) {
        return {
          status: 422 as const,
          corpo: { erro: 'Cartão inválido.', campo: 'cartao', motivo: v.motivo },
        }
      }
      cartao = v.cartao
    }

    const mensagem = await tx.mensagem.create({
      data:
        'falha' in r
          ? {
              id: r.id,
              conversaId,
              autor: 'FLOW',
              texto: falhaDoAtendente(r.falha),
              respostasRapidas: respostasDoItem(l.item).map((x) => x.rotulo),
              emRespostaA: r.emRespostaA,
              impressao,
              criadaEm: agora,
            }
          : {
              id: r.id,
              conversaId,
              autor: 'AGENTE',
              texto: r.mensagem,
              respostasRapidas: r.respostasRapidas,
              emRespostaA: r.emRespostaA,
              impressao,
              criadaEm: agora,
            },
      select: { seq: true },
    })
    if (cartao !== null) {
      const id = await substituirCartao(tx, conversaId, cartao, 'agente', mensagem.seq)
      if (id === null) {
        log.info(
          { conversaId, fonteId },
          'decidir: cartão do agente ignorado durante a confirmação',
        )
      }
    }
    // Só a resposta à última mensagem do Paulo encerra a espera; uma mais nova continua esperando.
    if (r.emRespostaA === c.responderA) {
      await tx.conversa.update({
        where: { id: conversaId },
        data: { aguardaAgenteDesde: null, responderA: null },
      })
    }
    return { status: 201 as const, corpo: { id: r.id } }
  })
}

// ---------------------------------------------------------------------------------------------
// Ajustar o cartão

export async function ajustarCartao(
  sujeito: Sujeito,
  e: { conversaId: string; campos: unknown },
  agora: Date,
): Promise<{ cartaoId: string }> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  const conversa = await db.conversa.findUnique({
    where: { id: e.conversaId },
    select: { chave: true, encerradaEm: true },
  })
  if (!conversa) throw new ErroDeDominio(CONVERSA_NAO_ENCONTRADA)
  if (conversa.encerradaEm) throw new ErroDeDominio(RESOLVIDO)
  const { item } = await localizarOuResolvido(conversa.chave, agora)
  return db.$transaction(async (tx) => {
    const c = await conversaAberta(tx, e.conversaId)
    const v = validarCartao(item, contextoDa(c), e.campos)
    if (!v.ok) throw new ErroDeDominio(v.motivo)
    const cartaoId = await substituirCartao(tx, c.id, v.cartao, 'paulo', null)
    if (cartaoId === null) throw new ErroDeDominio(CARTAO_EM_CONFIRMACAO)
    return { cartaoId }
  })
}

// ---------------------------------------------------------------------------------------------
// Marcas: pular, amanhã, guardar, trazer de volta

/** A conversa da chave; sem ela, cria só com as marcas (sem ler o GitHub nem abrir). */
async function garantirConversa(chave: string, agora: Date): Promise<string> {
  const existente = await db.conversa.findUnique({
    where: { chave },
    select: { id: true, encerradaEm: true },
  })
  if (existente) {
    if (existente.encerradaEm) throw new ErroDeDominio(RESOLVIDO)
    return existente.id
  }
  const l = await localizarOuResolvido(chave, agora)
  return criarOuCompletar(l, contextoSemGitHub(l), null, null, agora)
}

async function marcar(
  sujeito: Sujeito,
  chave: string,
  agora: Date,
  dados: Prisma.ConversaUpdateManyMutationInput,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  const id = await garantirConversa(chave, agora)
  const { count } = await db.conversa.updateMany({ where: { id, encerradaEm: null }, data: dados })
  if (count === 0) throw new ErroDeDominio(RESOLVIDO)
}

export function pularItem(sujeito: Sujeito, chave: string, agora: Date): Promise<void> {
  return marcar(sujeito, chave, agora, { puladaEm: agora })
}

export function deixarParaAmanha(sujeito: Sujeito, chave: string, agora: Date): Promise<void> {
  return marcar(sujeito, chave, agora, { adiadaAte: amanhaAsSeis(agora) })
}

export function guardarItem(sujeito: Sujeito, chave: string, agora: Date): Promise<void> {
  return marcar(sujeito, chave, agora, { guardadaEm: agora })
}

export function trazerDeVolta(sujeito: Sujeito, chave: string): Promise<void> {
  return marcar(sujeito, chave, new Date(), { guardadaEm: null, adiadaAte: null })
}
