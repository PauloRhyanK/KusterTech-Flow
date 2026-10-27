import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { lerFiltrosDeIssues, listarIssuesDoProjeto } from '@/modules/github/queries'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { AvisoDeIntegracao } from '@/app/(app)/projetos/_componentes/aviso-de-integracao'
import { FiltrosDeIssues } from '@/app/(app)/projetos/_componentes/filtros-de-issues'
import { ListaDeIssues } from '@/app/(app)/projetos/_componentes/lista-de-issues'

export interface PaginaEntregasProjetoProps {
  params: Promise<{ p: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({
  params,
}: Pick<PaginaEntregasProjetoProps, 'params'>): Promise<Metadata> {
  const { p } = await params
  const sessao = await obterSessao()
  if (!sessao) {
    return { title: 'Projeto' }
  }
  try {
    const projeto = await obterProjetoParaResumo(sessao.sujeito, p, null)
    return { title: `${projeto.nome} — Entregas` }
  } catch {
    return { title: 'Projeto' }
  }
}

export default async function PaginaEntregasProjeto({
  params,
  searchParams,
}: PaginaEntregasProjetoProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { p } = await params
  const filtros = lerFiltrosDeIssues(await searchParams)

  let dados: Awaited<ReturnType<typeof listarIssuesDoProjeto>>
  try {
    await obterProjetoParaResumo(sessao.sujeito, p, null)
    dados = await listarIssuesDoProjeto(sessao.sujeito, p, filtros)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return <SemPermissao />
    }
    if (erro instanceof ErroDeDominio) {
      notFound()
    }
    throw erro
  }

  const comFiltros =
    filtros.estado !== 'abertas' || filtros.repositorioId !== null || filtros.busca !== ''

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">Milestones</h2>
        <EstadoVazio
          tipo="nao-configurado"
          titulo="Milestones chegam no Incremento 3."
          descricao="A entrega organizada por milestone ainda não está disponível."
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text-primary">Issues sem milestone</h2>
        <AvisoDeIntegracao
          situacao={dados.situacao}
          sincronizadoEm={dados.sincronizadoEm}
          hrefConfiguracao={`/projetos/${p}/configuracao#repositorios`}
        />
        <FiltrosDeIssues filtros={filtros} repositorios={dados.repositorios} />
        <ListaDeIssues
          projetoId={p}
          issues={dados.issues}
          total={dados.total}
          comFiltros={comFiltros}
        />
      </section>
    </div>
  )
}
