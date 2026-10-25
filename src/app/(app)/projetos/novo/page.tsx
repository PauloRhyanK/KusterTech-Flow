import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { listarClientesParaSelecao } from '@/modules/clientes/queries'
import { FormularioProjeto } from '../_componentes/formulario-projeto'
import { criarProjetoAction } from '../actions'

export const metadata: Metadata = {
  title: 'Novo projeto',
}

export default async function PaginaNovoProjeto() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const trilhas = [{ rotulo: 'Projetos', href: '/projetos' }, { rotulo: 'Novo projeto' }]

  if (!autorizar(sessao.sujeito, 'projetos.gerenciar')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina trilhas={trilhas} titulo="Novo projeto" />
        <SemPermissao />
      </div>
    )
  }

  const clientesDisponiveis = await listarClientesParaSelecao(sessao.sujeito)

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={trilhas}
        titulo="Novo projeto"
        contexto="Cadastre um novo projeto para gerenciar entregas, homologações e clientes"
      />

      <FormularioProjeto
        action={criarProjetoAction}
        rotuloDoBotao="Criar projeto"
        clientesDisponiveis={clientesDisponiveis}
      />
    </div>
  )
}
