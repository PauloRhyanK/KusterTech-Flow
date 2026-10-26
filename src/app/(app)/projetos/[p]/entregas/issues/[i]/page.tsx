import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterIssueDoProjeto } from '@/modules/github/queries'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { AvisoDeIntegracao } from '../../../../_componentes/aviso-de-integracao'
import { DetalheDaIssue } from '../../../../_componentes/detalhe-da-issue'

export interface PaginaIssueProps {
  params: Promise<{ p: string; i: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Issue' }
}

export default async function PaginaIssue({ params }: PaginaIssueProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { p, i } = await params

  let projeto: Awaited<ReturnType<typeof obterProjetoParaResumo>>
  let dados: Awaited<ReturnType<typeof obterIssueDoProjeto>>
  try {
    projeto = await obterProjetoParaResumo(sessao.sujeito, p, null)
    dados = await obterIssueDoProjeto(sessao.sujeito, p, i)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return <SemPermissao />
    }
    if (erro instanceof ErroDeDominio) {
      notFound()
    }
    throw erro
  }

  const { issue } = dados

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[
          { rotulo: 'Projetos', href: '/projetos' },
          { rotulo: projeto.nome, href: `/projetos/${p}` },
          { rotulo: 'Entregas', href: `/projetos/${p}/entregas` },
          { rotulo: `#${issue.numero}` },
        ]}
        titulo={issue.titulo}
        contexto={issue.repositorio}
      />
      <AvisoDeIntegracao
        situacao={dados.situacao}
        sincronizadoEm={dados.sincronizadoEm}
        hrefConfiguracao={`/projetos/${p}/configuracao#repositorios`}
      />
      <DetalheDaIssue issue={issue} />
    </div>
  )
}
