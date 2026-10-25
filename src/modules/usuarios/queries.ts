import type { Sujeito } from '@/lib/auth/autorizar'
import { listarUsuarios, type UsuarioResumo } from './service'

export async function listarUsuariosParaTela(sujeito: Sujeito): Promise<UsuarioResumo[]> {
  return listarUsuarios(sujeito)
}
