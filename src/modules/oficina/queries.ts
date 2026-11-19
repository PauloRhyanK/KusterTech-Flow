import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { lerOficina } from './leitor'
import type { LeituraDaMaquina } from './model'

export function maquinaLocalConfigurada(): string | null {
  return process.env.FLOW_MAQUINA_LOCAL || null
}

export async function obterLeituraDaMaquinaLocal(
  sujeito: Sujeito,
  agora: Date,
): Promise<LeituraDaMaquina | null> {
  exigirPermissao(sujeito, 'infraestrutura.ler')
  if (!maquinaLocalConfigurada()) return null
  return lerOficina(process.env.OFICINA_DIR ?? '/oficina', agora)
}
