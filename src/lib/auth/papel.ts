import type { Papel as PapelPrisma } from '@prisma/client'
import { PERMISSOES, type Papel } from '@/lib/auth/autorizar'

type VerificarPapelBancoParaDominio = PapelPrisma extends Papel ? true : never
type VerificarPapelDominioParaBanco = Papel extends PapelPrisma ? true : never
const _garantiaDeParidadeDePapel: [VerificarPapelBancoParaDominio, VerificarPapelDominioParaBanco] =
  [true, true]
void _garantiaDeParidadeDePapel

export function converterPapelDoBanco(papel: PapelPrisma): Papel {
  if (Object.prototype.hasOwnProperty.call(PERMISSOES, papel)) {
    return papel
  }
  throw new Error(`Papel desconhecido no banco: ${String(papel)}`)
}
