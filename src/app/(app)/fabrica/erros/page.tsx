import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { exigirModulo } from '@/lib/modulos-rota'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterQuadroDeErros } from '@/modules/erros/queries'
import { ErrosNoAr } from '../_componentes/erros/quadro-de-erros'
import { virarDemandaAction } from './actions'

/** Aba Erros da Fábrica: os erros do GlitchTip e a demanda de correção de cada um (D81). */
export default async function PaginaDeErrosDaFabrica() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }
  exigirModulo('erros')

  if (!autorizar(sessao.sujeito, 'desenvolvimento.ler')) {
    return <SemPermissao />
  }
  const agora = new Date()
  const quadro = await obterQuadroDeErros(sessao.sujeito, agora)
  const podeVirar = autorizar(sessao.sujeito, 'projetos.gerenciar')
  return (
    <ErrosNoAr
      quadro={quadro}
      agora={agora}
      virarDemanda={podeVirar ? virarDemandaAction : undefined}
    />
  )
}
