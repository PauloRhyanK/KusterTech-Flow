import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { obterSessao } from '@/lib/auth/sessao'
import { PaginaDaMilestone } from '@/app/(app)/projetos/_componentes/pagina-da-milestone'

export interface PaginaMilestoneClienteProps {
  params: Promise<{ c: string; p: string; m: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Milestone' }
}

export default async function PaginaMilestoneCliente({
  params,
  searchParams,
}: PaginaMilestoneClienteProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { c, p, m } = await params
  return (
    <PaginaDaMilestone
      sujeito={sessao.sujeito}
      projetoId={p}
      milestoneId={m}
      clienteId={c}
      searchParams={await searchParams}
    />
  )
}
