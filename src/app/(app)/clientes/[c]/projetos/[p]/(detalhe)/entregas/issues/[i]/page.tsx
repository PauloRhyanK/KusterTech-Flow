import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { obterSessao } from '@/lib/auth/sessao'
import { PaginaDaIssue } from '@/app/(app)/projetos/_componentes/pagina-da-issue'

export interface PaginaIssueClienteProps {
  params: Promise<{ c: string; p: string; i: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Issue' }
}

export default async function PaginaIssueCliente({
  params,
  searchParams,
}: PaginaIssueClienteProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { c, p, i } = await params
  return (
    <PaginaDaIssue
      sujeito={sessao.sujeito}
      projetoId={p}
      issueId={i}
      clienteId={c}
      searchParams={await searchParams}
    />
  )
}
