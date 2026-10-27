import Link from 'next/link'
import { notFound } from 'next/navigation'
import { buttonVariants } from '@/components/ui/button'
import { autorizar, ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { ErroDeDominio } from '@/lib/erros'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterImplantacaoDaIssue } from '@/modules/ambientes/queries'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import { obterCliente } from '@/modules/clientes/service'
import { obterIssueNoContexto } from '@/modules/entregas/queries'
import { obterRepositoriosDoProjeto } from '@/modules/github/service'
import { type Contexto, rotasDoProjeto, trilhasDoProjeto } from '@/modules/projetos/model'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { AvisoDeIntegracao } from './aviso-de-integracao'
import { CorrecoesDaIssue } from './correcoes-da-issue'
import { DetalheDaIssue } from './detalhe-da-issue'
import { MilestonesDaIssue } from './milestones-da-issue'

export interface PaginaDaIssueProps {
  sujeito: Sujeito
  projetoId: string
  issueId: string
  clienteId: string | null
  searchParams: Record<string, string | string[] | undefined>
}

function primeiro(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? ''
}

// Página da issue nos dois contextos (global e de cliente).
export async function PaginaDaIssue({
  sujeito,
  projetoId,
  issueId,
  clienteId,
  searchParams,
}: PaginaDaIssueProps) {
  const contexto: Contexto =
    clienteId === null ? { tipo: 'global' } : { tipo: 'cliente', clienteId }
  const global = clienteId === null
  const admin = global && autorizar(sujeito, 'projetos.gerenciar')

  let projeto: Awaited<ReturnType<typeof obterProjetoParaResumo>>
  let dados: Awaited<ReturnType<typeof obterIssueNoContexto>>
  let implantacao: Awaited<ReturnType<typeof obterImplantacaoDaIssue>>
  let cliente: { id: string; nome: string } | null = null
  let repositorios: { id: string; nomeCompleto: string }[] = []
  try {
    projeto = await obterProjetoParaResumo(sujeito, projetoId, clienteId)
    dados = await obterIssueNoContexto(
      sujeito,
      projetoId,
      issueId,
      contexto,
      primeiro(searchParams.milestone) || null,
    )
    implantacao = await obterImplantacaoDaIssue(sujeito, projetoId, issueId, contexto)
    if (clienteId !== null) {
      const encontrado = await obterCliente(sujeito, clienteId)
      cliente = { id: encontrado.id, nome: encontrado.nome }
    }
    if (admin) {
      repositorios = (await obterRepositoriosDoProjeto(sujeito, projetoId)).vinculados.map((r) => ({
        id: r.id,
        nomeCompleto: r.nomeCompleto,
      }))
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

  const { issue } = dados
  const rotas = rotasDoProjeto(projetoId, contexto)
  const podeGerenciar = admin && projeto.arquivadoEm === null
  const verNaGlobal = !global && podeVerVisaoGlobal(sujeito)

  const lateral = (
    <>
      <MilestonesDaIssue
        projetoId={projetoId}
        issueId={issue.id}
        rotas={rotas}
        milestones={dados.milestones}
        milestonesDisponiveis={dados.milestonesDisponiveis}
        podeGerenciar={podeGerenciar}
      />
      <CorrecoesDaIssue
        projetoId={projetoId}
        issueId={issue.id}
        rotas={rotas}
        corrige={dados.corrige}
        corrigidaPor={dados.corrigidaPor}
        repositorios={repositorios}
        podeGerenciar={podeGerenciar}
      />
    </>
  )

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={trilhasDoProjeto(
          projeto,
          contexto,
          cliente,
          { rotulo: 'Entregas', href: rotas.entregas },
          ...(dados.milestoneDaTrilha
            ? [
                {
                  rotulo: dados.milestoneDaTrilha.titulo,
                  href: rotas.milestone(dados.milestoneDaTrilha.id),
                },
              ]
            : []),
          { rotulo: `#${issue.numero}` },
        )}
        titulo={issue.titulo}
        contexto={issue.repositorio}
        acoes={
          verNaGlobal ? (
            <Link
              href={`/projetos/${projetoId}/entregas/issues/${issue.id}`}
              className={buttonVariants({ variant: 'outline' })}
            >
              Ver na visão global
            </Link>
          ) : undefined
        }
      />
      <AvisoDeIntegracao
        situacao={dados.situacao}
        sincronizadoEm={dados.sincronizadoEm}
        hrefConfiguracao={global ? `/projetos/${projetoId}/configuracao#repositorios` : null}
      />
      <DetalheDaIssue
        projetoId={projetoId}
        issue={issue}
        implantacao={implantacao}
        modo={global ? 'global' : 'cliente'}
        lateral={lateral}
      />
    </div>
  )
}
