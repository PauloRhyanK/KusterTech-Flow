import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { FormularioCliente } from '../_componentes/formulario-cliente'
import { criarClienteAction } from '../actions'

export const metadata: Metadata = {
  title: 'Novo cliente',
}

export default async function PaginaNovoCliente() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const trilhas = [{ rotulo: 'Clientes', href: '/clientes' }, { rotulo: 'Novo cliente' }]

  if (!autorizar(sessao.sujeito, 'clientes.gerenciar')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina trilhas={trilhas} titulo="Novo cliente" />
        <SemPermissao />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={trilhas}
        titulo="Novo cliente"
        contexto="Cadastre um novo cliente para associar projetos e escopos de acesso"
      />

      <FormularioCliente action={criarClienteAction} rotuloDoBotao="Criar cliente" />
    </div>
  )
}
