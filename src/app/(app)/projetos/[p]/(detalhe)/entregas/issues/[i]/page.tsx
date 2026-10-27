import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { obterSessao } from '@/lib/auth/sessao'
import { PaginaDaIssue } from '@/app/(app)/projetos/_componentes/pagina-da-issue'

export interface PaginaIssueProps {
  params: Promise<{ p: string; i: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Issue' }
}

export default async function PaginaIssue({ params, searchParams }: PaginaIssueProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { p, i } = await params
  return (
    <PaginaDaIssue
      sujeito={sessao.sujeito}
      projetoId={p}
      issueId={i}
      clienteId={null}
      searchParams={await searchParams}
    />
  )
}
