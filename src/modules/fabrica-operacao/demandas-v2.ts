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

export function proximoPasso(f: FotoDaDemandaV2): PassoDaDemanda | null {
  if (f.encerrada || f.revisao === null) return null
  const r = f.revisao

  const bloqueadas = f.etapas.filter((e) => e.estado === 'bloqueada')
  if (bloqueadas.length > 0) {
    if (f.espera === 'travada') return null
    const e = bloqueadas[0]!
    const chave = `travada:${r.id}:${bloqueadas.map((b) => `${b.chave}#${b.tentativas}`).join(',')}`
    const motivo = `A etapa "${e.chave}" travou: ${e.motivo ?? 'sem motivo registrado'}`.slice(
      0,
      300,
    )
    return { tipo: 'evento', chave, evento: { tipo: 'travada', dados: { motivo, url: null } } }
  }
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
