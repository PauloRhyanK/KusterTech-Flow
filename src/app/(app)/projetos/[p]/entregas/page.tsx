import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'

export interface PaginaEntregasProjetoProps {
  params: Promise<{ p: string }>
}

export async function generateMetadata({ params }: PaginaEntregasProjetoProps): Promise<Metadata> {
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

export default async function PaginaEntregasProjeto({ params }: PaginaEntregasProjetoProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { p } = await params

  try {
    await obterProjetoParaResumo(sessao.sujeito, p, null)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return <SemPermissao />
    }
    if (erro instanceof ErroDeDominio) {
      notFound()
    }
    throw erro
  }

  return (
    <EstadoVazio
      tipo="nao-configurado"
      titulo="Entregas ainda não disponíveis."
      descricao="Milestones e entregas chegam no Incremento 3."
    />
  )
}
