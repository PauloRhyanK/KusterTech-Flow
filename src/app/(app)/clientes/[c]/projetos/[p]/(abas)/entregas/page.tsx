import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { obterCliente } from '@/modules/clientes/service'
import { ErroDeDominio } from '@/lib/erros'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { listarMilestonesDoProjeto } from '@/modules/entregas/queries'
import { rotasDoProjeto } from '@/modules/projetos/model'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { ListaDeMilestones } from '@/app/(app)/projetos/_componentes/lista-de-milestones'

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

  const contexto = { tipo: 'cliente', clienteId: c } as const
  let milestones: Awaited<ReturnType<typeof listarMilestonesDoProjeto>>
  let cliente: Awaited<ReturnType<typeof obterCliente>>
  try {
    await obterProjetoParaResumo(sessao.sujeito, p, c)
    milestones = await listarMilestonesDoProjeto(sessao.sujeito, p, contexto)
    cliente = await obterCliente(sessao.sujeito, c)
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
    <ListaDeMilestones
      rotas={rotasDoProjeto(p, contexto)}
      milestones={milestones.ativas}
      vazio={{
        titulo: 'Nenhuma milestone associada a este cliente.',
        descricao: `As entregas aparecem aqui quando uma milestone do projeto é associada a ${cliente.nome}.`,
      }}
    />
  )
}
