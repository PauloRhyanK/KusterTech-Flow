import { obterSessao } from '@/lib/auth/sessao'
import { TEMA_PADRAO, type Tema } from '@/lib/tema/tema'

export async function obterTemaAtual(): Promise<Tema> {
  try {
    return (await obterSessao())?.usuario.tema ?? TEMA_PADRAO
  } catch {
    return TEMA_PADRAO
  }
}
