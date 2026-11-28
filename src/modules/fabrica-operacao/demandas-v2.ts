/**
 * O próximo passo de uma demanda do motor novo (Fábrica 2.0) no ciclo que já existe no Flow: os mesmos
 * eventos que o kit legado emitia (triagem, plano, parte feita, etapa concluída), agora decididos a partir
 * do estado do plano operacional. Função pura: um passo por vez; quem chama aplica e lê de novo.
 */
import { TIPOS, triagemSchema } from '@/modules/demandas/contrato'
import type { EstadoDaEtapa } from './etapas'

export interface FotoDaDemandaV2 {
  /** Marco da etapa atual da demanda (recebida, planejada, desenvolvida, entregue, no_ar…). */
  marco: string | null
  espera: string | null
  encerrada: boolean
  tipo: string | null
  /** A última revisão aprovada do plano operacional; `triagem` vem do conteúdo aprovado. */
  revisao: { id: string; numero: number; triagem: unknown } | null
  etapas: {
    chave: string
    estado: EstadoDaEtapa
    prUrl: string | null
    motivo: string | null
    tentativas: number
  }[]
  /** Merge de cada PR (por URL), como o Flow sincronizou do GitHub. */
  merges: Record<string, { numero: number; sha: string | null; em: string | null }>
  parte: {
    chave: string
    repositorio: string
    estado:
      'PLANEJANDO' | 'EM_CURSO' | 'FEITA' | 'PUBLICANDO' | 'NO_AR' | 'NAO_CHEGOU' | 'DESCARTADA'
    chegaAoAr: 'PUBLICACAO' | 'VERSAO'
    pedidoId: string | null
    commitAlvo: string | null
  }
  /** Chave (sem prefixo) da última trava emitida por este motor, para destravar. */
  ultimaTrava: string | null
  /** Quantas travas este motor já emitiu nesta demanda (cada nova trava tem chave nova). */
  travasEmitidas: number
}

export type PassoDaDemanda =
  | { tipo: 'evento'; chave: string; evento: { tipo: string; dados: Record<string, unknown> } }
  | { tipo: 'publicar'; commit: string }

const FINAIS_OK: readonly EstadoDaEtapa[] = ['mergeada', 'concluida']

function triagem(f: FotoDaDemandaV2, revisao: NonNullable<FotoDaDemandaV2['revisao']>) {
  const tipo = (TIPOS as readonly string[]).includes(f.tipo ?? '') ? f.tipo : 'ajuste'
  const conservadora = {
    tipo,
    destino: 'fila_de_agentes',
    tamanho: 'pequeno',
    mexeEm: 'conforme o plano aprovado',
    risco: 'baixo',
    dados: 'nenhum',
    impacto: { toca: [], podeQuebrar: [], autorizacao: false, caminhoProtegido: false },
    resposta: null,
    motivo: 'Plano aprovado pelo dono; executado pela Fábrica 2.0.',
  }
  const doPlano =
    revisao.triagem && typeof revisao.triagem === 'object' && !Array.isArray(revisao.triagem)
      ? (revisao.triagem as Record<string, unknown>)
      : {}
  // campo a campo: o que vier inválido no plano cai no valor conservador; o destino é sempre a fila
  const dados: Record<string, unknown> = { ...conservadora }
  for (const [campo, valor] of Object.entries(doPlano)) {
    if (campo === 'destino' || !(campo in conservadora)) continue
    const tentativa = { ...dados, [campo]: valor }
    if (triagemSchema.safeParse(tentativa).success) dados[campo] = valor
  }
  return dados
}

/** Algo que o motor novo não resolve sozinho: a demanda fica travada para o dono, com o motivo. */
function problemaDaDemanda(f: FotoDaDemandaV2): string | null {
  const bloqueada = f.etapas.find((e) => e.estado === 'bloqueada')
  if (bloqueada)
    return `A etapa "${bloqueada.chave}" travou: ${bloqueada.motivo ?? 'sem motivo registrado'}`
  if (f.marco === 'desenho' || f.marco === 'testada') {
    return 'O motor novo ainda não faz desenho nem teste no navegador; esta demanda precisa do dono.'
  }
  if (f.parte.estado === 'DESCARTADA' || f.parte.estado === 'NAO_CHEGOU') {
    return `A parte de entrega está "${f.parte.estado.toLowerCase()}"; o motor novo não a retoma sozinho.`
  }
  if (
    f.marco === 'desenvolvida' &&
    f.etapas.length > 0 &&
    f.etapas.every((e) => FINAIS_OK.includes(e.estado)) &&
    !f.etapas.some((e) => e.estado === 'mergeada' && e.prUrl !== null)
  ) {
    return 'O plano terminou sem nenhuma mudança de código para publicar.'
  }
  return null
}

export function proximoPasso(f: FotoDaDemandaV2): PassoDaDemanda | null {
  if (f.encerrada || f.revisao === null) return null
  const r = f.revisao

  const travar = (motivo: string): PassoDaDemanda => ({
    tipo: 'evento',
    chave: `travada:${r.id}:${f.travasEmitidas + 1}`,
    evento: { tipo: 'travada', dados: { motivo: motivo.slice(0, 300), url: null } },
  })
  const problema = problemaDaDemanda(f)
  if (problema !== null) return f.espera === 'travada' ? null : travar(problema)
  if (f.espera === 'travada') {
    // só destrava o que este motor travou
    if (f.ultimaTrava === null) return null
    return {
      tipo: 'evento',
      chave: `${f.ultimaTrava}:fim`,
      evento: { tipo: 'destravada', dados: {} },
    }
  }
  if (f.espera !== null) return null

  switch (f.marco) {
    case 'recebida':
      return {
        tipo: 'evento',
        chave: `triagem:${r.id}`,
        evento: { tipo: 'triagem', dados: triagem(f, r) },
      }
    case 'planejada':
      return {
        tipo: 'evento',
        chave: `plano:${r.id}`,
        // o plano vive no Flow; o contrato pede um caminho, que aqui identifica a revisão aprovada
        evento: {
          tipo: 'plano_criado',
          dados: { plano: `.fabrica/planos/fabrica-2-${r.id}-r${r.numero}.json`, prUrl: null },
        },
      }
    case 'desenvolvida': {
      if (f.etapas.length === 0 || !f.etapas.every((e) => FINAIS_OK.includes(e.estado))) return null
      const mergeadas = f.etapas.filter((e) => e.estado === 'mergeada' && e.prUrl !== null)
      if (mergeadas.length === 0) return null
      const merges = mergeadas.map((e) => ({ url: e.prUrl!, ...f.merges[e.prUrl!] }))
      if (merges.some((m) => !m.sha || !m.numero)) return null // o merge ainda não foi sincronizado
      if (f.parte.estado === 'PLANEJANDO' || f.parte.estado === 'EM_CURSO') {
        const ultimo = [...merges].sort((a, b) => (a.em ?? '').localeCompare(b.em ?? '')).at(-1)!
        return {
          tipo: 'evento',
          chave: `parte_feita:${r.id}`,
          evento: {
            tipo: 'parte_feita',
            dados: {
              parte: f.parte.chave,
              prs: merges.map((m) => ({ url: m.url, numero: m.numero!, mergeCommit: m.sha! })),
              commit: ultimo.sha!,
              pendencias: [],
            },
          },
        }
      }
      return {
        tipo: 'evento',
        chave: `desenvolvida:${r.id}`,
        evento: { tipo: 'etapa_concluida', dados: { marco: 'desenvolvida' } },
      }
    }
    case 'entregue':
      if (f.parte.chegaAoAr === 'PUBLICACAO' && f.parte.pedidoId === null) {
        return f.parte.commitAlvo ? { tipo: 'publicar', commit: f.parte.commitAlvo } : null
      }
      return {
        tipo: 'evento',
        chave: `entregue:${r.id}`,
        evento: { tipo: 'etapa_concluida', dados: { marco: 'entregue' } },
      }
    default:
      return null
  }
}
