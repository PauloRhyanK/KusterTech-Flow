import { z } from 'zod'
import { ErroDeDominio } from '@/lib/erros'
import { NIVEIS, TIPOS } from '@/modules/demandas/contrato'
import type { Espera, Nivel, TipoDeDemanda } from '@/modules/demandas/model'
import { respostasDoItem, type ItemDaPilha, type TipoDeItem } from './model'

export type Acao =
  | 'destino'
  | 'guardar'
  | 'recusar'
  | 'aprovar_desenho'
  | 'ajustar_desenho'
  | 'responder'
  | 'aprovar_e_mergear'
  | 'pedir_mudanca'
  | 'retomar'
  | 'entregar_parcial'
  | 'encerrar'
  | 'concluir'

const ACOES_DE_PEDIDO = ['destino', 'guardar', 'recusar'] as const

export const ACOES_POR_TIPO: Record<TipoDeItem, readonly Acao[]> = {
  pedido: ACOES_DE_PEDIDO,
  nao_classificada: ACOES_DE_PEDIDO,
  desenho: ['aprovar_desenho', 'ajustar_desenho'],
  decisao_da_fabrica: ['responder'],
  fim_de_fase: ['aprovar_e_mergear', 'pedir_mudanca'],
  trava: ['retomar', 'entregar_parcial', 'encerrar', 'aprovar_e_mergear'],
  concluir_etapa: ['concluir'],
  publicacao: [],
}

/** A ação cabe na espera da demanda: entregar o que funciona só no teste que falhou. */
export function cabeNaEspera(acao: Acao, espera: Espera | null): boolean {
  return acao !== 'entregar_parcial' || espera === 'teste_falhou'
}

function esperaDo(item: ItemDaPilha): Espera | null {
  return item.ref.tipo === 'demanda' ? item.ref.espera : null
}

/** A ação vale para o item: está no tipo dele e cabe na espera da demanda. */
function valeNoItem(item: ItemDaPilha, acao: Acao): boolean {
  return ACOES_POR_TIPO[item.tipo].includes(acao) && cabeNaEspera(acao, esperaDo(item))
}

/**
 * As ações que o item aceita agora: o merge só existe com o PR lido ao abrir; entregar o que
 * funciona, só no teste que falhou.
 */
export function acoesDoItem(
  tipo: TipoDeItem,
  contexto: ContextoDoItem,
  espera: Espera | null = null,
): Acao[] {
  return ACOES_POR_TIPO[tipo].filter(
    (a) => (a !== 'aprovar_e_mergear' || contexto.pr !== null) && cabeNaEspera(a, espera),
  )
}

type DestinoDoCartao = 'urgente' | 'lote_da_noite' | 'fila_de_agentes'
const DESTINOS_DO_CARTAO = ['urgente', 'lote_da_noite', 'fila_de_agentes'] as const

export type Cartao =
  | {
      acao: 'destino'
      destino: DestinoDoCartao
      nivel: Nivel
      tipoDeDemanda: TipoDeDemanda | null
      escopo: string | null
      resposta: string | null
    }
  | { acao: 'guardar' }
  | { acao: 'recusar'; resposta: string | null }
  | { acao: 'aprovar_desenho'; versao: number }
  | { acao: 'ajustar_desenho'; versao: number; texto: string }
  | { acao: 'responder'; texto: string }
  | { acao: 'aprovar_e_mergear'; pr: string; numero: number; head: string; protegidos: string[] }
  | { acao: 'pedir_mudanca'; texto: string }
  | { acao: 'retomar'; resposta: string | null }
  | { acao: 'entregar_parcial' }
  | { acao: 'encerrar' }
  | { acao: 'concluir'; etapa: string }

export type EstadoDoCi = 'verde' | 'pendente' | 'vermelho' | 'ausente'

/**
 * O PR lido ao abrir o item: o do fim de fase ou o da trava da demanda. `fora` = arquivos fora do
 * permitido (ao orquestrador, no fim de fase; os caminhos protegidos da Fábrica, na demanda).
 */
export interface ContextoDoItem {
  pr: { url: string; numero: number; head: string; fora: string[]; ci: EstadoDoCi } | null
}

const LIMITE_DO_ESCOPO = 500
const LIMITE_DA_RESPOSTA = 1000
const LIMITE_DO_COMENTARIO = 2000
const LIMITE_DO_AJUSTE = 500

// Os limites são conferidos depois de aparar (motivo próprio); o esquema só barra o formato.
const textoLivre = z.string().max(20_000)
const opcional = textoLivre.nullish()

/**
 * O que o agente pode escrever. Campos que decidem o alvo (versão, PR, head, protegidos, etapa)
 * não existem aqui: `strictObject` recusa qualquer um deles.
 */
export const propostaDoAgenteSchema = z.discriminatedUnion('acao', [
  z.strictObject({
    acao: z.literal('destino'),
    destino: z.enum(DESTINOS_DO_CARTAO),
    nivel: z.enum(NIVEIS),
    tipoDeDemanda: z.enum(TIPOS).nullish(),
    escopo: opcional,
    resposta: opcional,
  }),
  z.strictObject({ acao: z.literal('guardar') }),
  z.strictObject({ acao: z.literal('recusar'), resposta: opcional }),
  z.strictObject({ acao: z.literal('aprovar_desenho') }),
  z.strictObject({ acao: z.literal('ajustar_desenho'), texto: textoLivre }),
  z.strictObject({ acao: z.literal('responder'), texto: textoLivre }),
  z.strictObject({ acao: z.literal('aprovar_e_mergear') }),
  z.strictObject({ acao: z.literal('pedir_mudanca'), texto: textoLivre }),
  z.strictObject({ acao: z.literal('retomar'), resposta: opcional }),
  z.strictObject({ acao: z.literal('entregar_parcial') }),
  z.strictObject({ acao: z.literal('encerrar') }),
  z.strictObject({ acao: z.literal('concluir') }),
])

type Proposta = z.infer<typeof propostaDoAgenteSchema>
type Resultado = { ok: true; cartao: Cartao } | { ok: false; motivo: string }

const FORMATO = 'O cartão não tem o formato esperado.'
const NAO_VALE = 'Esta ação não vale para este item.'
const LIMITE = 'O texto passou do limite.'
const SEM_PR = 'O PR não pôde ser lido; abra no GitHub.'

class ForaDoLimite extends Error {}

/** Texto opcional: vazio vira null; acima do limite recusa. */
function opcionalAparado(texto: string | null | undefined, limite: number): string | null {
  const t = (texto ?? '').trim()
  if (t === '') return null
  if (t.length > limite) throw new ForaDoLimite()
  return t
}

/** Texto obrigatório: de 1 ao limite, depois de aparar. */
function obrigatorioAparado(texto: string, limite: number): string {
  const t = texto.trim()
  if (t.length < 1 || t.length > limite) throw new ForaDoLimite()
  return t
}

function cartaoDeMerge(contexto: ContextoDoItem): Resultado {
  const pr = contexto.pr
  if (pr === null) return { ok: false, motivo: SEM_PR }
  return {
    ok: true,
    cartao: {
      acao: 'aprovar_e_mergear',
      pr: pr.url,
      numero: pr.numero,
      head: pr.head,
      protegidos: [...pr.fora],
    },
  }
}

function montar(item: ItemDaPilha, contexto: ContextoDoItem, p: Proposta): Resultado {
  const ref = item.ref
  if (ref.tipo === 'demanda') {
    switch (p.acao) {
      case 'destino': {
        const tipoDeDemanda = p.tipoDeDemanda ?? ref.tipoDeDemanda
        if (tipoDeDemanda === null) return { ok: false, motivo: 'Escolha o tipo da demanda.' }
        return {
          ok: true,
          cartao: {
            acao: 'destino',
            destino: p.destino,
            nivel: p.nivel,
            tipoDeDemanda,
            escopo: opcionalAparado(p.escopo, LIMITE_DO_ESCOPO),
            resposta: opcionalAparado(p.resposta, LIMITE_DA_RESPOSTA),
          },
        }
      }
      case 'guardar':
        return { ok: true, cartao: { acao: 'guardar' } }
      case 'recusar':
        return {
          ok: true,
          cartao: { acao: 'recusar', resposta: opcionalAparado(p.resposta, LIMITE_DA_RESPOSTA) },
        }
      case 'aprovar_desenho':
        return { ok: true, cartao: { acao: 'aprovar_desenho', versao: ref.versaoDoDesenho } }
      case 'ajustar_desenho':
        return {
          ok: true,
          cartao: {
            acao: 'ajustar_desenho',
            versao: ref.versaoDoDesenho,
            texto: obrigatorioAparado(p.texto, LIMITE_DO_AJUSTE),
          },
        }
      case 'retomar':
        return {
          ok: true,
          cartao: { acao: 'retomar', resposta: opcionalAparado(p.resposta, LIMITE_DA_RESPOSTA) },
        }
      case 'entregar_parcial':
        return { ok: true, cartao: { acao: 'entregar_parcial' } }
      case 'encerrar':
        return { ok: true, cartao: { acao: 'encerrar' } }
      case 'concluir':
        return { ok: true, cartao: { acao: 'concluir', etapa: ref.etapaAtual } }
      case 'aprovar_e_mergear':
        return cartaoDeMerge(contexto)
      default:
        return { ok: false, motivo: NAO_VALE }
    }
  }
  switch (p.acao) {
    case 'responder':
      return {
        ok: true,
        cartao: { acao: 'responder', texto: obrigatorioAparado(p.texto, LIMITE_DO_COMENTARIO) },
      }
    case 'pedir_mudanca':
      return {
        ok: true,
        cartao: { acao: 'pedir_mudanca', texto: obrigatorioAparado(p.texto, LIMITE_DO_COMENTARIO) },
      }
    case 'aprovar_e_mergear':
      return cartaoDeMerge(contexto)
    default:
      return { ok: false, motivo: NAO_VALE }
  }
}

export function validarCartao(
  item: ItemDaPilha,
  contexto: ContextoDoItem,
  proposta: unknown,
): Resultado {
  const lido = propostaDoAgenteSchema.safeParse(proposta)
  if (!lido.success) return { ok: false, motivo: FORMATO }
  if (!valeNoItem(item, lido.data.acao)) return { ok: false, motivo: NAO_VALE }
  try {
    return montar(item, contexto, lido.data)
  } catch (e) {
    if (e instanceof ForaDoLimite) return { ok: false, motivo: LIMITE }
    throw e
  }
}

type Falta = 'tipoDeDemanda' | 'texto'

export function cartaoDaRespostaRapida(
  item: ItemDaPilha,
  contexto: ContextoDoItem,
  chave: string,
): { cartao: Cartao } | { faltam: Falta[]; base: Partial<Cartao> } {
  if (!respostasDoItem(item).some((r) => r.chave === chave)) {
    throw new ErroDeDominio('Resposta rápida inválida.')
  }
  const ref = item.ref
  if ((DESTINOS_DO_CARTAO as readonly string[]).includes(chave) && ref.tipo === 'demanda') {
    const destino = chave as DestinoDoCartao
    if (ref.tipoDeDemanda === null) {
      return {
        faltam: ['tipoDeDemanda'],
        base: { acao: 'destino', destino, nivel: ref.nivel, escopo: null, resposta: null },
      }
    }
    return {
      cartao: {
        acao: 'destino',
        destino,
        nivel: ref.nivel,
        tipoDeDemanda: ref.tipoDeDemanda,
        escopo: null,
        resposta: null,
      },
    }
  }
  if (chave === 'ajustar_desenho' && ref.tipo === 'demanda') {
    return { faltam: ['texto'], base: { acao: 'ajustar_desenho', versao: ref.versaoDoDesenho } }
  }
  if (chave === 'pedir_mudanca') return { faltam: ['texto'], base: { acao: 'pedir_mudanca' } }
  const r = validarCartao(item, contexto, { acao: chave })
  if (!r.ok) throw new ErroDeDominio(r.motivo)
  return { cartao: r.cartao }
}

export type Efeito =
  | {
      tipo: 'decidir_destino'
      demandaId: string
      destino: DestinoDoCartao
      extras: { nivel: Nivel; tipo?: TipoDeDemanda; escopo?: string }
    }
  | { tipo: 'guardar' }
  | { tipo: 'encerrar_demanda'; demandaId: string }
  | { tipo: 'aprovar_desenho'; demandaId: string; versao: number }
  | { tipo: 'pedir_ajuste'; demandaId: string; versao: number; texto: string }
  | { tipo: 'retomar'; demandaId: string; resposta?: string }
  | { tipo: 'entregar_parcial'; demandaId: string }
  | { tipo: 'concluir_etapa'; demandaId: string; chave: string }
  | { tipo: 'responder_issue'; repositorio: string; numero: number; comentario: string }
  | {
      tipo: 'mergear_pr'
      repositorio: string
      /** A feature do plano no fim de fase; `null` no PR da trava da demanda. */
      feature: string | null
      /** Na trava: a demanda retomada depois do merge. */
      demandaId?: string
      numero: number
      head: string
      protegidos: string[]
    }

export function efeitoDoCartao(item: ItemDaPilha, cartao: Cartao): Efeito {
  const ref = item.ref
  if (!valeNoItem(item, cartao.acao)) throw new ErroDeDominio(NAO_VALE)
  if (ref.tipo === 'demanda') {
    const demandaId = ref.demandaId
    switch (cartao.acao) {
      case 'destino':
        return {
          tipo: 'decidir_destino',
          demandaId,
          destino: cartao.destino,
          extras: {
            nivel: cartao.nivel,
            ...(cartao.tipoDeDemanda !== null ? { tipo: cartao.tipoDeDemanda } : {}),
            ...(cartao.escopo !== null ? { escopo: cartao.escopo } : {}),
          },
        }
      case 'guardar':
        return { tipo: 'guardar' }
      case 'recusar':
      case 'encerrar':
        return { tipo: 'encerrar_demanda', demandaId }
      case 'aprovar_desenho':
        return { tipo: 'aprovar_desenho', demandaId, versao: cartao.versao }
      case 'ajustar_desenho':
        return { tipo: 'pedir_ajuste', demandaId, versao: cartao.versao, texto: cartao.texto }
      case 'retomar':
        return {
          tipo: 'retomar',
          demandaId,
          ...(cartao.resposta !== null ? { resposta: cartao.resposta } : {}),
        }
      case 'entregar_parcial':
        return { tipo: 'entregar_parcial', demandaId }
      case 'concluir':
        return { tipo: 'concluir_etapa', demandaId, chave: cartao.etapa }
      // Depois do merge, a retomada avisa a Fábrica, que confere o PR e segue a correção.
      case 'aprovar_e_mergear':
        return {
          tipo: 'mergear_pr',
          repositorio: item.repositorio,
          feature: null,
          demandaId,
          numero: cartao.numero,
          head: cartao.head,
          protegidos: [...cartao.protegidos],
        }
    }
  } else if (ref.tipo === 'issue') {
    switch (cartao.acao) {
      // O despachante lê o fechamento com comentário como a resposta; no fim de fase, fecha o PR
      // e acorda o orquestrador.
      case 'responder':
      case 'pedir_mudanca':
        return {
          tipo: 'responder_issue',
          repositorio: ref.repositorio,
          numero: ref.numero,
          comentario: comentarioSeguro(cartao.texto),
        }
      // O despachante fecha a issue sozinho ao ver o PR mergeado (F9).
      case 'aprovar_e_mergear':
        return {
          tipo: 'mergear_pr',
          repositorio: ref.repositorio,
          feature: ref.feature,
          numero: cartao.numero,
          head: cartao.head,
          protegidos: [...cartao.protegidos],
        }
    }
  }
  throw new ErroDeDominio(NAO_VALE)
}

/**
 * Os marcadores do kit são comentários HTML (`<!-- fabrica:despachante -->`,
 * `<!-- fabrica:nonce=<hex> -->`) e o kit os procura como texto exato; sem nenhum `<!--`, o texto
 * do Paulo nunca se passa por eles.
 */
export function comentarioSeguro(texto: string): string {
  return texto.trim().replaceAll('<!--', '&lt;!--') + '\n\n— Resposta do Paulo pelo Flow.'
}

const FEATURE = /^[a-z0-9]+(-[a-z0-9]+)*$/
// O limite da skill e de `fila.FEATURE_MAX` no kit.
const FEATURE_MAX = 41
const PREFIXOS_PERMITIDOS = ['.fabrica/planejamento/', '.seeds/'] as const

/**
 * O arquivo do plano do item, como `fila.feature_do_caminho` no kit: `plano` é o legado
 * `.fabrica/plano.json`; feature fora do formato não tem plano (nenhum plano fica permitido).
 */
export function caminhoDoPlano(feature: string): string | null {
  if (feature === 'plano') return '.fabrica/plano.json'
  if (feature.length > FEATURE_MAX || !FEATURE.test(feature)) return null
  return `.fabrica/planos/${feature}.json`
}

/**
 * O que o orquestrador pode tocar no PR de fim de fase (`despachante.permitidos_ao_orquestrador`):
 * só o plano do próprio item; qualquer outro plano é caminho protegido.
 */
export const PERMITIDOS_NO_FIM_DE_FASE = {
  exatos: ['.fabrica/pergunta.md'],
  prefixos: PREFIXOS_PERMITIDOS,
} as const

function permitido(caminho: string, plano: string | null): boolean {
  // Segmento vazio, "." ou ".." nunca vale: o prefixo não pode escapar da pasta.
  if (caminho.split('/').some((s) => s === '' || s === '.' || s === '..')) return false
  if (plano !== null && caminho === plano) return true
  if ((PERMITIDOS_NO_FIM_DE_FASE.exatos as readonly string[]).includes(caminho)) return true
  return PREFIXOS_PERMITIDOS.some((p) => caminho.startsWith(p))
}

/** Os caminhos que a Fábrica nunca mergeia sozinha (`despachante.PROTEGIDOS_FIXOS`). */
export const PROTEGIDOS_DA_FABRICA = ['.fabrica/', '.claude/', '.warren/'] as const

/** O caminho da config da Fábrica no repositório (`CAMINHO_CONFIG_DO_REPO` no kit). */
export const CONFIG_DA_FABRICA = '.fabrica/config.json'

/**
 * Os `protegidos` da config, como `config_do_repo` no kit: ausente, nenhum extra; fora do formato,
 * `null` (a Fábrica trava a correção, e o Flow não mergeia às cegas).
 */
export function protegidosDaConfig(bruto: string | null): string[] | null {
  if (bruto === null) return []
  let config: unknown
  try {
    config = JSON.parse(bruto)
  } catch {
    return null
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return null
  const protegidos = (config as { protegidos?: unknown }).protegidos ?? []
  if (!Array.isArray(protegidos)) return null
  if (!protegidos.every((g) => typeof g === 'string' && g !== '')) return null
  return protegidos as string[]
}

function globParaRegex(glob: string): string {
  let r = ''
  for (let i = 0; i < glob.length;) {
    if (glob.startsWith('**/', i)) {
      r += '(?:.*/)?'
      i += 3
    } else if (glob.startsWith('**', i)) {
      r += '.*'
      i += 2
    } else if (glob[i] === '*') {
      r += '[^/]*'
      i += 1
    } else if (glob[i] === '?') {
      r += '[^/]'
      i += 1
    } else {
      r += glob[i]!.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
      i += 1
    }
  }
  return r
}

/**
 * O glob dos `protegidos` como `globs.casa_glob` no kit: `**` casa qualquer sequência, `*` e `?`
 * ficam num segmento; com a barra final, casa o diretório e tudo abaixo dele.
 */
export function casaGlob(caminho: string, glob: string): boolean {
  const regex = globParaRegex(glob)
  return new RegExp(glob.endsWith('/') ? `^${regex}` : `^${regex}$`, 's').test(caminho)
}

/**
 * Os arquivos fora do permitido, sem repetição e na ordem: com a `feature`, os que o orquestrador
 * do plano dela não pode tocar; sem ela (o PR da trava da demanda), os caminhos protegidos da
 * Fábrica e os `protegidos` da `.fabrica/config.json` do branch padrão do repositório.
 */
export function arquivosForaDoPermitido(
  arquivos: readonly string[],
  feature: string | null,
  protegidosDoRepo: readonly string[] = [],
): string[] {
  const plano = feature === null ? null : caminhoDoPlano(feature)
  const fora = (a: string) =>
    feature === null
      ? PROTEGIDOS_DA_FABRICA.some((p) => a.startsWith(p)) ||
        protegidosDoRepo.some((g) => casaGlob(a, g))
      : !permitido(a, plano)
  const lista: string[] = []
  for (const a of arquivos) if (fora(a) && !lista.includes(a)) lista.push(a)
  return lista
}

export function estadoDoCi(
  checks: 'SUCESSO' | 'FALHA' | 'PENDENTE' | 'SEM_CHECKS',
  status: 'success' | 'pending' | 'failure' | 'error' | null,
): EstadoDoCi {
  if (checks === 'FALHA' || status === 'failure' || status === 'error') return 'vermelho'
  if (checks === 'PENDENTE' || status === 'pending') return 'pendente'
  if (checks === 'SEM_CHECKS' && status === null) return 'ausente'
  return 'verde'
}

export function avaliarMerge(e: {
  repositorio: string
  pr: {
    repositorio: string
    estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'
    head: string
    arquivos: string[]
  }
  ci: EstadoDoCi
  cartao: { head: string; protegidos: readonly string[] }
  /** A feature do plano do item: só o arquivo dele é permitido; `null` no PR da trava. */
  feature: string | null
  /** No PR da trava: os `protegidos` da config do repositório, lidos agora. */
  protegidosDoRepo?: readonly string[]
}): { ok: true; jaMergeado: boolean } | { ok: false; motivo: string; headNovo?: string } {
  const { pr, cartao } = e
  if (pr.repositorio.toLowerCase() !== e.repositorio.toLowerCase()) {
    return { ok: false, motivo: 'O PR é de outro repositório.' }
  }
  if (pr.estado === 'MERGEADO' && pr.head === cartao.head) return { ok: true, jaMergeado: true }
  if (pr.estado !== 'ABERTO') return { ok: false, motivo: 'O PR não está mais aberto.' }
  const curto = pr.head.slice(0, 7)
  if (pr.head !== cartao.head) {
    return {
      ok: false,
      motivo: `O PR mudou desde a conferência (head ${curto}). Confira de novo.`,
      headNovo: pr.head,
    }
  }
  if (e.ci === 'pendente') return { ok: false, motivo: `O CI ainda está rodando no head ${curto}.` }
  if (e.ci === 'vermelho') return { ok: false, motivo: `O CI falhou no head ${curto}.` }
  const naoDitos = arquivosForaDoPermitido(pr.arquivos, e.feature, e.protegidosDoRepo).filter(
    (a) => !cartao.protegidos.includes(a),
  )
  if (naoDitos.length > 0) {
    return {
      ok: false,
      motivo: `O PR mexe em ${naoDitos.slice(0, 5).join(', ')} e o cartão não disse.`,
    }
  }
  return { ok: true, jaMergeado: false }
}
