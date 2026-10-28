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
import { lerRetornoDaFila } from '@/modules/homologacao/model'
import {
  listarHomologacaoDaIssuePorCliente,
  obterCorrecoesDaIssue,
  obterHomologacaoDaIssue,
  obterSituacaoDoReteste,
  type SituacaoDoReteste,
} from '@/modules/homologacao/queries'
import { type Contexto, rotasDoProjeto, trilhasDoProjeto } from '@/modules/projetos/model'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { AvisoDeIntegracao } from './aviso-de-integracao'
import { CorrecoesDaIssue } from './correcoes-da-issue'
import { DetalheDaIssue } from './detalhe-da-issue'
import { HomologacaoDaIssueNoCliente, HomologacaoDaIssuePorCliente } from './homologacao-da-issue'
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
  let homologacaoNoCliente: Awaited<ReturnType<typeof obterHomologacaoDaIssue>> | null = null
  let correcoes: Awaited<ReturnType<typeof obterCorrecoesDaIssue>> | null = null
  let reteste: SituacaoDoReteste | undefined
  let homologacaoPorCliente: Awaited<ReturnType<typeof listarHomologacaoDaIssuePorCliente>> = []
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
      homologacaoNoCliente = await obterHomologacaoDaIssue(sujeito, {
        clienteId,
        projetoId,
        issueId,
        milestoneId: primeiro(searchParams.milestone) || null,
      })
      correcoes = await obterCorrecoesDaIssue(
        sujeito,
        clienteId,
        projetoId,
        issueId,
        homologacaoNoCliente.milestone?.id ?? null,
      )
      const itemDoCliente = homologacaoNoCliente.item
      // Também depois da confirmação (AGUARDANDO_RETESTE): o bloco segue montado para anunciar o resultado.
      if (
        itemDoCliente &&
        (itemDoCliente.estado === 'CORRECAO_SOLICITADA' ||
          itemDoCliente.estado === 'AGUARDANDO_RETESTE') &&
        correcoes.podeTriar
      ) {
        reteste = await obterSituacaoDoReteste(sujeito, clienteId, itemDoCliente.id)
      }
    } else {
      homologacaoPorCliente = await listarHomologacaoDaIssuePorCliente(sujeito, projetoId, issueId)
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
  // A fila global só é prefixo aceito para quem pode ver a visão global (D65).
  const hrefDeRetorno =
    clienteId === null
      ? null
      : lerRetornoDaFila(primeiro(searchParams.retorno) || undefined, [
          ...(podeVerVisaoGlobal(sujeito) ? [`/projetos/${projetoId}/homologacao`] : []),
          `/clientes/${clienteId}/projetos/${projetoId}/homologacao`,
          `/clientes/${clienteId}/projetos/${projetoId}/entregas/milestones/`,
        ])

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
        homologacao={
          homologacaoNoCliente ? (
            <HomologacaoDaIssueNoCliente
              dados={homologacaoNoCliente}
              projetoId={projetoId}
              hrefDeRetorno={hrefDeRetorno}
              correcoes={
                correcoes
                  ? {
                      lista: correcoes.correcoes,
                      podeTriar: correcoes.podeTriar,
                      integracaoConfigurada: correcoes.integracaoConfigurada,
                    }
                  : undefined
              }
              reteste={reteste}
              issue={{ id: issue.id, numero: issue.numero, repositorio: issue.repositorio }}
              hrefDaMilestone={(milestoneId) => rotas.issue(issue.id, milestoneId)}
            />
          ) : (
            <HomologacaoDaIssuePorCliente linhas={homologacaoPorCliente} />
          )
        }
      />
    </div>
  )
}
