import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { autorizar, ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { listarMilestonesDoProjeto } from '@/modules/entregas/queries'
import { lerFiltrosDeIssues, listarIssuesDoProjeto } from '@/modules/github/queries'
import { resumoDeHomologacaoPorMilestone } from '@/modules/homologacao/queries'
import { rotasDoProjeto } from '@/modules/projetos/model'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { AvisoDeIntegracao } from '@/app/(app)/projetos/_componentes/aviso-de-integracao'
import { FiltrosDeIssues } from '@/app/(app)/projetos/_componentes/filtros-de-issues'
import { FormularioMilestone } from '@/app/(app)/projetos/_componentes/formulario-milestone'
import { ListaDeIssues } from '@/app/(app)/projetos/_componentes/lista-de-issues'
import { ListaDeMilestones } from '@/app/(app)/projetos/_componentes/lista-de-milestones'

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
  const sp = await searchParams
  const filtros = lerFiltrosDeIssues(sp)

  let projeto: Awaited<ReturnType<typeof obterProjetoParaResumo>>
  let dados: Awaited<ReturnType<typeof listarIssuesDoProjeto>>
  let milestones: Awaited<ReturnType<typeof listarMilestonesDoProjeto>>
  let homologacao: Awaited<ReturnType<typeof resumoDeHomologacaoPorMilestone>>
  try {
    projeto = await obterProjetoParaResumo(sessao.sujeito, p, null)
    dados = await listarIssuesDoProjeto(sessao.sujeito, p, filtros)
    milestones = await listarMilestonesDoProjeto(sessao.sujeito, p, { tipo: 'global' })
    homologacao = await resumoDeHomologacaoPorMilestone(sessao.sujeito, p, { tipo: 'global' })
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
    filtros.estado !== 'abertas' ||
    filtros.repositorioId !== null ||
    filtros.busca !== '' ||
    filtros.milestone !== 'sem'
  const rotuloDasIssues = filtros.milestone === 'sem' ? 'Issues sem milestone' : 'Issues do projeto'
  const rotas = rotasDoProjeto(p, { tipo: 'global' })
  const podeCriar = autorizar(sessao.sujeito, 'projetos.gerenciar') && projeto.arquivadoEm === null
  const nova = (Array.isArray(sp.nova) ? sp.nova[0] : sp.nova) === '1'

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text-primary">Milestones</h2>
        {podeCriar && (
          <details
            id="nova-milestone"
            open={nova}
            className="rounded-padrao border border-border bg-surface p-4"
          >
            <summary className="cursor-pointer text-sm font-medium text-text-primary">
              Nova milestone
            </summary>
            <div className="mt-4">
              <FormularioMilestone
                projetoId={p}
                clientesDoProjeto={projeto.clientes.filter((c) => c.arquivadoEm === null)}
              />
            </div>
          </details>
        )}
        <ListaDeMilestones rotas={rotas} milestones={milestones.ativas} homologacao={homologacao} />
        {milestones.arquivadas.length > 0 && (
          <details className="space-y-3">
            <summary className="cursor-pointer text-sm font-medium text-text-primary">
              Milestones arquivadas ({milestones.arquivadas.length})
            </summary>
            <div className="mt-3">
              <ListaDeMilestones
                rotas={rotas}
                milestones={milestones.arquivadas}
                homologacao={homologacao}
                rotulo="Milestones arquivadas"
              />
            </div>
          </details>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text-primary">{rotuloDasIssues}</h2>
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
          rotulo={rotuloDasIssues}
        />
      </section>
    </div>
  )
}
