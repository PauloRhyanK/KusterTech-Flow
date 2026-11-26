import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterSistemasConectados } from '@/modules/relatos/queries'
import { BotaoConectarSistema, ListaDeSistemas } from './_componentes/lista-de-sistemas'

export const metadata: Metadata = {
  title: 'Sistemas conectados',
}

export default async function PaginaSistemasConectados() {
  const sessao = await obterSessao()
  if (!sessao) redirect('/entrar')
  const podeGerenciar = autorizar(sessao.sujeito, 'configuracoes.gerenciar')
  const tela = podeGerenciar ? await obterSistemasConectados(sessao.sujeito, new Date()) : null

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[
          { rotulo: 'Configurações', href: '/configuracoes' },
          { rotulo: 'Sistemas conectados' },
        ]}
        titulo="Sistemas conectados"
        acoes={tela && tela.sistemas.length > 0 ? <BotaoConectarSistema /> : undefined}
      />
      {tela ? <ListaDeSistemas tela={tela} /> : <SemPermissao />}
    </div>
  )
}
