import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { autorizar, ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { moduloAtivo } from '@/lib/modulos'
import { ErroDeDominio } from '@/lib/erros'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterCliente } from '@/modules/clientes/service'
import { obterEntregasParaResumo } from '@/modules/entregas/queries'
import { pendenciasDoProjeto, resumoDeHomologacaoPorMilestone } from '@/modules/homologacao/queries'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { ResumoDoProjeto } from '@/app/(app)/projetos/_componentes/resumo-do-projeto'

export interface PaginaProjetoClienteProps {
  params: Promise<{ c: string; p: string }>
}

export async function generateMetadata({ params }: PaginaProjetoClienteProps): Promise<Metadata> {
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

export default async function PaginaProjetoCliente({ params }: PaginaProjetoClienteProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { c, p } = await params

  let projetoComContagens: Awaited<ReturnType<typeof obterProjetoParaResumo>>
  let entregas: Awaited<ReturnType<typeof obterEntregasParaResumo>> | undefined
  let homologacao: Awaited<ReturnType<typeof resumoDeHomologacaoPorMilestone>> | undefined
  let pendencias: Awaited<ReturnType<typeof pendenciasDoProjeto>> | undefined
  let cliente: Awaited<ReturnType<typeof obterCliente>>

  try {
    const [proj, cli] = await Promise.all([
      obterProjetoParaResumo(sessao.sujeito, p, c),
      obterCliente(sessao.sujeito, c),
    ])
    projetoComContagens = proj
    cliente = cli
    const contexto = { tipo: 'cliente', clienteId: c } as const
    if (moduloAtivo('entregas')) {
      entregas = await obterEntregasParaResumo(sessao.sujeito, p, contexto)
    }
    if (moduloAtivo('homologacao')) {
      homologacao = await resumoDeHomologacaoPorMilestone(sessao.sujeito, p, contexto)
      pendencias = await pendenciasDoProjeto(sessao.sujeito, p, contexto)
    }
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
      entregas={entregas}
      homologacao={homologacao}
      pendencias={pendencias}
      contexto={{ tipo: 'cliente', clienteId: c }}
      podeGerenciar={podeGerenciar}
      cliente={{ id: cliente.id, nome: cliente.nome }}
    />
  )
}
