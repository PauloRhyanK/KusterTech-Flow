import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { autorizar, ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterCliente } from '@/modules/clientes/service'
import { FormularioCliente } from '../../_componentes/formulario-cliente'
import { editarClienteAction } from '../../actions'

export const metadata: Metadata = {
  title: 'Editar cliente',
}

export interface PaginaEditarClienteProps {
  params: Promise<{ c: string }>
}

export default async function PaginaEditarCliente({ params }: PaginaEditarClienteProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { c } = await params
  const trilhasIniciais = [{ rotulo: 'Clientes', href: '/clientes' }, { rotulo: 'Editar' }]

  if (!autorizar(sessao.sujeito, 'clientes.gerenciar')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina trilhas={trilhasIniciais} titulo="Editar cliente" />
        <SemPermissao />
      </div>
    )
  }

  let cliente: Awaited<ReturnType<typeof obterCliente>>
  try {
    cliente = await obterCliente(sessao.sujeito, c)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return (
        <div className="space-y-6">
          <CabecalhoDePagina trilhas={trilhasIniciais} titulo="Editar cliente" />
          <SemPermissao />
        </div>
      )
    }
    if (erro instanceof ErroDeDominio) {
      notFound()
    }
    throw erro
  }

  const trilhas = [
    { rotulo: 'Clientes', href: '/clientes' },
    { rotulo: cliente.nome, href: `/clientes/${cliente.id}` },
    { rotulo: 'Editar' },
  ]

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={trilhas}
        titulo={`Editar ${cliente.nome}`}
        contexto="Atualize as informações do cliente"
      />

      <FormularioCliente
        action={editarClienteAction}
        valoresIniciais={{
          clienteId: cliente.id,
          nome: cliente.nome,
          observacoes: cliente.observacoes ?? '',
        }}
        rotuloDoBotao="Salvar"
      />
    </div>
  )
}
