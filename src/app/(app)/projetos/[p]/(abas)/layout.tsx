import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { autorizar, ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { CabecalhoDoProjeto } from '@/app/(app)/projetos/_componentes/cabecalho-do-projeto'

export interface LayoutProjetoProps {
  children: ReactNode
  params: Promise<{ p: string }>
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ p: string }>
}): Promise<Metadata> {
  const { p } = await params
  const sessao = await obterSessao()
  if (!sessao) {
    return { title: 'Projeto' }
  }
  try {
    const projeto = await obterProjetoParaResumo(sessao.sujeito, p, null)
    return { title: projeto.nome }
  } catch {
    return { title: 'Projeto' }
  }
}

export default async function LayoutProjeto({ children, params }: LayoutProjetoProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { p } = await params

  let projetoComContagens: Awaited<ReturnType<typeof obterProjetoParaResumo>>
  try {
    projetoComContagens = await obterProjetoParaResumo(sessao.sujeito, p, null)
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
        contexto={{ tipo: 'global' }}
        podeGerenciar={podeGerenciar}
        podeVerGlobal={podeVerGlobal}
      />
      <div>{children}</div>
    </div>
  )
}
