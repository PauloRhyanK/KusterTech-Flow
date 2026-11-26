import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { criarClienteDoBeszel, type ClienteDoBeszel, type ConfiguracaoDoBeszel } from './cliente'
import type { AmostraBruta, ContainerBruto } from './contrato'
import {
  ligarAoCadastro,
  ordenarMaquinas,
  paraDetalhe,
  paraMaquina,
  type DetalheNoBeszel,
  type MaquinaNoBeszel,
  type SituacaoDoBeszel,
} from './model'

const CACHE_RESUMO_MS = 30_000
const CACHE_AMOSTRA_MS = 30_000
const CACHE_HISTORICO_MS = 5 * 60_000
const DIA_MS = 86_400_000

export function configuracaoDoBeszel(): ConfiguracaoDoBeszel | null {
  const url = process.env.BESZEL_URL?.replace(/\/+$/, '')
  const usuario = process.env.BESZEL_USUARIO
  const senha = process.env.BESZEL_SENHA
  if (!url || !usuario || !senha) return null
  return { url, usuario, senha }
}

export function linkDoBeszel(): string | null {
  return process.env.BESZEL_LINK || null
}

export type ResumoDoBeszel = {
  situacao: SituacaoDoBeszel
  lidaEm: Date | null
  maquinas: (MaquinaNoBeszel & { recursoId: string | null })[]
}

interface Lido {
  em: number
  maquinas: ResumoDoBeszel['maquinas']
  containers: ContainerBruto[]
}

let cliente: { chave: string; cliente: ClienteDoBeszel } | null = null
let resumo: Lido | null = null
const amostras = new Map<string, { em: number; amostra: AmostraBruta | null }>()
const historicos = new Map<string, { em: number; historico: AmostraBruta[] }>()

export function limparCacheDoBeszel(): void {
  cliente = null
  resumo = null
  amostras.clear()
  historicos.clear()
}

// Um cliente por configuração: o token do Beszel fica guardado nele.
function clienteDe(config: ConfiguracaoDoBeszel): ClienteDoBeszel {
  const chave = `${config.url}|${config.usuario}|${config.senha}`
  if (cliente?.chave !== chave) cliente = { chave, cliente: criarClienteDoBeszel(config) }
  return cliente.cliente
}

const valido = (em: number, agora: Date, ms: number) =>
  agora.getTime() - em >= 0 && agora.getTime() - em < ms

async function lerResumo(
  config: ConfiguracaoDoBeszel,
  agora: Date,
): Promise<{ situacao: SituacaoDoBeszel; lido: Lido | null }> {
  if (resumo && valido(resumo.em, agora, CACHE_RESUMO_MS)) return { situacao: 'ok', lido: resumo }
  const c = clienteDe(config)
  const [sistemas, containers] = await Promise.all([c.sistemas(), c.containers()])
  if (!sistemas.ok) return { situacao: sistemas.motivo, lido: null }

  const lista = containers.ok ? containers.valor : []
  const porSistema = new Map<string, number>()
  for (const ct of lista) porSistema.set(ct.system, (porSistema.get(ct.system) ?? 0) + 1)

  const recursos = await db.recurso.findMany({
    where: { arquivadoEm: null, identificadorExterno: { not: null } },
    select: { id: true, identificadorExterno: true },
  })
  const maquinas = ordenarMaquinas(
    ligarAoCadastro(
      sistemas.valor.map((s) => paraMaquina(s, porSistema.get(s.id) ?? 0, agora)),
      recursos.flatMap((r) =>
        r.identificadorExterno ? [{ id: r.id, identificadorExterno: r.identificadorExterno }] : [],
      ),
    ),
    process.env.FLOW_MAQUINA_LOCAL || null,
    agora,
    'cadastro',
  )
  resumo = { em: agora.getTime(), maquinas, containers: lista }
  return { situacao: 'ok', lido: resumo }
}

export async function obterMaquinasNoBeszel(
  sujeito: Sujeito,
  agora: Date,
): Promise<ResumoDoBeszel> {
  exigirPermissao(sujeito, 'infraestrutura.ler')
  const config = configuracaoDoBeszel()
  if (!config) return { situacao: 'nao_configurado', lidaEm: null, maquinas: [] }
  const { situacao, lido } = await lerResumo(config, agora)
  if (!lido) return { situacao, lidaEm: null, maquinas: [] }
  return { situacao, lidaEm: new Date(lido.em), maquinas: lido.maquinas }
}

export async function obterDetalheNoBeszel(
  sujeito: Sujeito,
  nome: string,
  agora: Date,
): Promise<{ situacao: SituacaoDoBeszel; detalhe: DetalheNoBeszel | null }> {
  exigirPermissao(sujeito, 'infraestrutura.ler')
  const config = configuracaoDoBeszel()
  if (!config) return { situacao: 'nao_configurado', detalhe: null }
  const { situacao, lido } = await lerResumo(config, agora)
  if (!lido) return { situacao, detalhe: null }
  const maquina = lido.maquinas.find((m) => m.nome === nome)
  if (!maquina) return { situacao, detalhe: null }

  const c = clienteDe(config)
  const id = maquina.sistemaId
  const emCacheAmostra = amostras.get(id)
  const emCacheHistorico = historicos.get(id)
  const [amostra, historico] = await Promise.all([
    emCacheAmostra && valido(emCacheAmostra.em, agora, CACHE_AMOSTRA_MS)
      ? Promise.resolve({ ok: true as const, valor: emCacheAmostra.amostra })
      : c.ultimaAmostra(id),
    emCacheHistorico && valido(emCacheHistorico.em, agora, CACHE_HISTORICO_MS)
      ? Promise.resolve({ ok: true as const, valor: emCacheHistorico.historico })
      : c.historico(id, new Date(agora.getTime() - DIA_MS)),
  ])
  if (amostra.ok && amostra.valor !== emCacheAmostra?.amostra) {
    amostras.set(id, { em: agora.getTime(), amostra: amostra.valor })
  }
  if (historico.ok && historico.valor !== emCacheHistorico?.historico) {
    historicos.set(id, { em: agora.getTime(), historico: historico.valor })
  }

  return {
    situacao,
    detalhe: paraDetalhe(
      maquina,
      amostra.ok ? amostra.valor : null,
      lido.containers.filter((ct) => ct.system === id),
      historico.ok ? historico.valor : [],
    ),
  }
}
