import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { listarFontesDaFabrica } from '@/modules/fabrica/queries'
import { FontesDaFabrica } from './_componentes/fontes-da-fabrica'

export const metadata: Metadata = {
  title: 'Fábrica de agentes',
}

export default async function PaginaConfiguracoesDaFabrica() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const cabecalho = (
    <CabecalhoDePagina
      trilhas={[
        { rotulo: 'Configurações', href: '/configuracoes' },
        { rotulo: 'Fábrica de agentes' },
      ]}
      titulo="Fábrica de agentes"
      contexto="Tokens que a máquina de agentes usa para enviar o estado à Central."
    />
  )

  if (!autorizar(sessao.sujeito, 'configuracoes.gerenciar')) {
    return (
      <div className="space-y-6">
        {cabecalho}
        <SemPermissao />
      </div>
    )
  }

  const fontes = await listarFontesDaFabrica(sessao.sujeito)

  return (
    <div className="space-y-6">
      {cabecalho}
      <FontesDaFabrica fontes={fontes} />
    </div>
  )
}
