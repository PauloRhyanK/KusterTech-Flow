import { notFound, redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { moduloAtivo } from '@/lib/modulos'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterPainelDeOperacao } from '@/modules/fabrica-operacao/queries'
import { PainelDeOperacao } from './painel-de-operacao'

export const dynamic = 'force-dynamic'

export default async function PaginaDeOperacaoDaFabrica() {
  if (!moduloAtivo('fabrica-operacao')) notFound()
  const sessao = await obterSessao()
  if (!sessao) redirect('/entrar')
  if (!autorizar(sessao.sujeito, 'desenvolvimento.ler')) return <SemPermissao />
  const painel = await obterPainelDeOperacao(sessao.sujeito, new Date())
  return <PainelDeOperacao painel={painel} />
}
