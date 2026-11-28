/**
 * Gates de uma etapa da Fábrica 2.0: adapta as evidências guardadas (por SHA) à regra do kit
 * (`avaliarMerge`) e decide qual tarefa de gate falta. Verificação vermelha corrige direto, sem gastar
 * a revisão (LLM) num código que nem passa nos testes.
 */
import { avaliarMerge, type EstadoDoCi, type ResultadoDoGate } from './gates'

/** Sempre protegidos nas etapas (config por repositório fica para depois). */
export const PROTEGIDOS_DA_ETAPA: readonly string[] = [
  '.fabrica/**',
  '.claude/**',
  '.warren/**',
  '.env*',
  '**/.env*',
]

export interface EntradaDosGates {
  head: string
  ci: EstadoDoCi | null
  verificacao: { codigo: number } | null
  revisao: { resultado: string; achados?: unknown; criterios?: unknown } | null
  arquivos: string[]
}

export function decidirGates(e: EntradaDosGates): ResultadoDoGate {
  if (e.verificacao !== null && e.verificacao.codigo !== 0) {
    return {
      decisao: 'corrigir',
      faltando: [],
      motivos: [`verificação falhou (código ${e.verificacao.codigo})`],
    }
  }
  return avaliarMerge({
    headSha: e.head,
    ci: e.ci,
    verificacao: e.verificacao && { sha: e.head, codigo: e.verificacao.codigo },
    veredito: e.revisao && { ...e.revisao, sha: e.head },
    arquivos: e.arquivos,
    protegidos: [...PROTEGIDOS_DA_ETAPA],
    // os três projetos rodam sem CI obrigatório: a verificação em contêiner limpo é o mínimo
    ciOpcional: true,
  })
}

export function proximaTarefaDeGate(e: {
  head: string | null
  verificacao: { codigo: number } | null
  revisao: object | null
}): 'verificar' | 'revisar' | null {
  if (e.head === null) return null
  if (e.verificacao === null) return 'verificar'
  if (e.verificacao.codigo !== 0) return null
  return e.revisao === null ? 'revisar' : null
}
