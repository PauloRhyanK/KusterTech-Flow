import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { autorizar, ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { ResumoDoProjeto } from '../_componentes/resumo-do-projeto'

export interface PaginaProjetoProps {
  params: Promise<{ p: string }>
}

export async function generateMetadata({ params }: PaginaProjetoProps): Promise<Metadata> {
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

export default async function PaginaProjeto({ params }: PaginaProjetoProps) {
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

  return (
    <ResumoDoProjeto
      projeto={projetoComContagens}
      contagens={projetoComContagens.contagens}
      estadoGitHub={projetoComContagens.estadoGitHub}
      contexto={{ tipo: 'global' }}
      podeGerenciar={podeGerenciar}
    />
  )
}
