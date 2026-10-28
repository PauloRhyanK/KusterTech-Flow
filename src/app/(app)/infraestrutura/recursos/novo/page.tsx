import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { listarHospedeirosDisponiveis } from '@/modules/infra/queries'
import { FormularioRecurso } from '../../_componentes/formulario-recurso'
import { cadastrarRecursoAction } from '../../actions'

export const metadata: Metadata = {
  title: 'Novo recurso',
}

export default async function PaginaNovoRecurso() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const trilhas = [
    { rotulo: 'Infraestrutura', href: '/infraestrutura' },
    { rotulo: 'Novo recurso' },
  ]

  if (!autorizar(sessao.sujeito, 'infraestrutura.gerenciar')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina trilhas={trilhas} titulo="Novo recurso" />
        <SemPermissao />
      </div>
    )
  }

  const hospedeiros = await listarHospedeirosDisponiveis(sessao.sujeito)

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={trilhas}
        titulo="Novo recurso"
        contexto="Cadastre um servidor, container, banco ou storage no inventário"
      />
      <FormularioRecurso
        action={cadastrarRecursoAction}
        hospedeiros={hospedeiros}
        rotuloDoBotao="Cadastrar recurso"
      />
    </div>
  )
}
