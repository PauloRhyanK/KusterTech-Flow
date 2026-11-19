import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { obterRetratoMaisRecente } from '@/modules/fabrica/queries'
import { PainelDaFabrica } from '../_componentes/painel-da-fabrica'

export default async function PaginaDeAvisosDaFabrica() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const permitido = autorizar(sessao.sujeito, 'desenvolvimento.ler')
  const retrato = permitido ? await obterRetratoMaisRecente(sessao.sujeito) : null

  return (
    <PainelDaFabrica secao="avisos" permitido={permitido} retrato={retrato} agora={new Date()} />
  )
}
