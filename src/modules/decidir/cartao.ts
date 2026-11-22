import { z } from 'zod'
import { ErroDeDominio } from '@/lib/erros'
import { NIVEIS, TIPOS } from '@/modules/demandas/contrato'
import type { Nivel, TipoDeDemanda } from '@/modules/demandas/model'
import { RESPOSTAS_DO_FLOW, type ItemDaPilha, type TipoDeItem } from './model'

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
  | 'encerrar'
  | 'concluir'

const ACOES_DE_PEDIDO = ['destino', 'guardar', 'recusar'] as const

export const ACOES_POR_TIPO: Record<TipoDeItem, readonly Acao[]> = {
  pedido: ACOES_DE_PEDIDO,
  nao_classificada: ACOES_DE_PEDIDO,
  desenho: ['aprovar_desenho', 'ajustar_desenho'],
  decisao_da_fabrica: ['responder'],
  fim_de_fase: ['aprovar_e_mergear', 'pedir_mudanca'],
  trava: ['retomar', 'encerrar'],
  concluir_etapa: ['concluir'],
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
  | { acao: 'encerrar' }
  | { acao: 'concluir'; etapa: string }

export type EstadoDoCi = 'verde' | 'pendente' | 'vermelho' | 'ausente'

/** Só o fim de fase tem PR; lido ao abrir o item. `fora` = arquivos fora do permitido ao orquestrador. */
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
      case 'encerrar':
        return { ok: true, cartao: { acao: 'encerrar' } }
      case 'concluir':
        return { ok: true, cartao: { acao: 'concluir', etapa: ref.etapaAtual } }
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
    case 'aprovar_e_mergear': {
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
  if (!ACOES_POR_TIPO[item.tipo].includes(lido.data.acao)) return { ok: false, motivo: NAO_VALE }
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
  if (!RESPOSTAS_DO_FLOW[item.tipo].some((r) => r.chave === chave)) {
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
  | { tipo: 'concluir_etapa'; demandaId: string; chave: string }
  | { tipo: 'responder_issue'; repositorio: string; numero: number; comentario: string }
  | { tipo: 'mergear_pr'; repositorio: string; numero: number; head: string; protegidos: string[] }

export function efeitoDoCartao(item: ItemDaPilha, cartao: Cartao): Efeito {
  const ref = item.ref
  if (!ACOES_POR_TIPO[item.tipo].includes(cartao.acao)) throw new ErroDeDominio(NAO_VALE)
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
      case 'concluir':
        return { tipo: 'concluir_etapa', demandaId, chave: cartao.etapa }
    }
  } else {
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

const PLANO = /^\.fabrica\/planos\/[a-z0-9]+(-[a-z0-9]+)*\.json$/
const PREFIXOS_PERMITIDOS = ['.fabrica/planejamento/', '.seeds/'] as const

/** O que o orquestrador pode tocar no PR de fim de fase. */
export const PERMITIDOS_NO_FIM_DE_FASE = {
  planos: PLANO,
  exatos: ['.fabrica/pergunta.md'],
  prefixos: PREFIXOS_PERMITIDOS,
} as const

function permitido(caminho: string): boolean {
  // Segmento vazio, "." ou ".." nunca vale: o prefixo não pode escapar da pasta.
  if (caminho.split('/').some((s) => s === '' || s === '.' || s === '..')) return false
  if (PLANO.test(caminho)) return true
  if ((PERMITIDOS_NO_FIM_DE_FASE.exatos as readonly string[]).includes(caminho)) return true
  return PREFIXOS_PERMITIDOS.some((p) => caminho.startsWith(p))
}

export function arquivosForaDoPermitido(arquivos: readonly string[]): string[] {
  const fora: string[] = []
  for (const a of arquivos) if (!permitido(a) && !fora.includes(a)) fora.push(a)
  return fora
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
  const naoDitos = arquivosForaDoPermitido(pr.arquivos).filter(
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
