import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'

export interface PaginaEntregasProjetoClienteProps {
  params: Promise<{ c: string; p: string }>
}

export async function generateMetadata({
  params,
}: PaginaEntregasProjetoClienteProps): Promise<Metadata> {
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

export default async function PaginaEntregasProjetoCliente({
  params,
}: PaginaEntregasProjetoClienteProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { c, p } = await params

  try {
    await obterProjetoParaResumo(sessao.sujeito, p, c)
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
