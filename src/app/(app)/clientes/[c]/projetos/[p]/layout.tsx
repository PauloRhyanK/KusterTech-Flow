import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { autorizar, ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import { obterCliente } from '@/modules/clientes/service'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { CabecalhoDoProjeto } from '@/app/(app)/projetos/_componentes/cabecalho-do-projeto'

export interface LayoutProjetoClienteProps {
  children: ReactNode
  params: Promise<{ c: string; p: string }>
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ c: string; p: string }>
}): Promise<Metadata> {
  const { c, p } = await params
  const sessao = await obterSessao()
  if (!sessao) {
    return { title: 'Projeto' }
  }
  try {
    const projeto = await obterProjetoParaResumo(sessao.sujeito, p, c)
    return { title: projeto.nome }
  } catch {
    return { title: 'Projeto' }
  }
}

export default async function LayoutProjetoCliente({
  children,
  params,
}: LayoutProjetoClienteProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { c, p } = await params

  let projetoComContagens: Awaited<ReturnType<typeof obterProjetoParaResumo>>
  let cliente: Awaited<ReturnType<typeof obterCliente>>

  try {
    const [proj, cli] = await Promise.all([
      obterProjetoParaResumo(sessao.sujeito, p, c),
      obterCliente(sessao.sujeito, c),
    ])
    projetoComContagens = proj
    cliente = cli
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return <SemPermissao />
    }
    if (erro instanceof ErroDeDominio) {
      notFound()
    }
    throw erro
  }

  const podeGerenciar = autorizar(sessao.sujeito, 'projetos.gerenciar')
  const podeVerGlobal = podeVerVisaoGlobal(sessao.sujeito)

  return (
    <div className="space-y-8">
      <CabecalhoDoProjeto
        projeto={projetoComContagens}
        contexto={{ tipo: 'cliente', clienteId: c }}
        cliente={{ id: cliente.id, nome: cliente.nome }}
        podeGerenciar={podeGerenciar}
        podeVerGlobal={podeVerGlobal}
      />
      <div>{children}</div>
    </div>
  )
}
