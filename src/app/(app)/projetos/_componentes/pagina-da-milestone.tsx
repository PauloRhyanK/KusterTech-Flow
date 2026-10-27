import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { alternarArquivamentoDaMilestoneAction } from '@/app/(app)/projetos/_acoes/entregas'
import { Button, buttonVariants } from '@/components/ui/button'
import { autorizar, ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { ErroDeDominio } from '@/lib/erros'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import { obterCliente } from '@/modules/clientes/service'
import {
  lerFiltrosDaMilestone,
  listarIssuesParaAdicionar,
  obterMilestone,
} from '@/modules/entregas/queries'
import { type Contexto, rotasDoProjeto, trilhasDoProjeto } from '@/modules/projetos/model'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { AbasDaMilestone } from './abas-da-milestone'
import { AdicionarIssues } from './adicionar-issues'
import { AvisoDeIntegracao } from './aviso-de-integracao'
import { DetalheDaMilestone } from './detalhe-da-milestone'
import { FormularioMilestone } from './formulario-milestone'
import { HomologacaoDaMilestone } from './homologacao-da-milestone'
import { IssuesDaMilestone } from './issues-da-milestone'

export interface PaginaDaMilestoneProps {
  sujeito: Sujeito
  projetoId: string
  milestoneId: string
  clienteId: string | null
  searchParams: Record<string, string | string[] | undefined>
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

function primeiro(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? ''
}

// Cabeçalho e conteúdo da milestone nos dois contextos (global e de cliente).
export async function PaginaDaMilestone({
  sujeito,
  projetoId,
  milestoneId,
  clienteId,
  searchParams,
}: PaginaDaMilestoneProps) {
  const contexto: Contexto =
    clienteId === null ? { tipo: 'global' } : { tipo: 'cliente', clienteId }
  const filtros = lerFiltrosDaMilestone(searchParams)
  const buscaIssue = primeiro(searchParams.buscaIssue).trim()

  const global = clienteId === null
  const admin = global && autorizar(sujeito, 'projetos.gerenciar')

  let projeto: Awaited<ReturnType<typeof obterProjetoParaResumo>>
  let dados: Awaited<ReturnType<typeof obterMilestone>>
  let cliente: { id: string; nome: string } | null = null
  let candidatas: Awaited<ReturnType<typeof listarIssuesParaAdicionar>> | null = null
  try {
    projeto = await obterProjetoParaResumo(sujeito, projetoId, clienteId)
    dados = await obterMilestone(sujeito, projetoId, milestoneId, contexto, filtros)
    if (clienteId !== null) {
      const encontrado = await obterCliente(sujeito, clienteId)
      cliente = { id: encontrado.id, nome: encontrado.nome }
    }
    if (admin && filtros.aba === 'issues' && dados.milestone.arquivadaEm === null) {
      candidatas = await listarIssuesParaAdicionar(sujeito, projetoId, milestoneId, buscaIssue)
    }
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return (
        <div className="space-y-6">
          <CabecalhoDePagina
            trilhas={[
              global
                ? { rotulo: 'Projetos', href: '/projetos' }
                : { rotulo: 'Clientes', href: '/clientes' },
            ]}
            titulo="Milestone"
          />
          <SemPermissao />
        </div>
      )
    }
    if (erro instanceof ErroDeDominio) {
      notFound()
    }
    throw erro
  }

  const { milestone } = dados
  const rotas = rotasDoProjeto(projetoId, contexto)
  const arquivada = milestone.arquivadaEm !== null
  const projetoAtivo = projeto.arquivadoEm === null
  const podeGerenciar = admin && projetoAtivo && !arquivada
  const hrefConfiguracao = admin ? `/projetos/${projetoId}/configuracao` : null
  const verNaGlobal = !global && podeVerVisaoGlobal(sujeito)

  const acoes =
    admin || verNaGlobal ? (
      <div className="flex flex-wrap items-start gap-2">
        {podeGerenciar && (
          <details className="relative">
            <summary className={`${buttonVariants({ variant: 'outline' })} cursor-pointer`}>
              Editar milestone
            </summary>
            <div className="absolute right-0 z-10 mt-2 w-[min(90vw,28rem)] rounded-padrao border border-border bg-surface p-4 shadow-md">
              <FormularioMilestone
                projetoId={projetoId}
                milestone={{
                  id: milestone.id,
                  titulo: milestone.titulo,
                  descricao: milestone.descricao,
                  prazo: milestone.prazo ? milestone.prazo.toISOString().slice(0, 10) : null,
                }}
              />
            </div>
          </details>
        )}
        {admin && projetoAtivo && (
          <BotaoDeConfirmacao
            rotulo={arquivada ? 'Reativar milestone' : 'Arquivar milestone'}
            rotuloDeConfirmacao={arquivada ? 'Confirmar reativação' : 'Confirmar arquivamento'}
            action={alternarArquivamentoDaMilestoneAction}
            camposOcultos={{
              projetoId,
              milestoneId: milestone.id,
              arquivar: arquivada ? 'false' : 'true',
            }}
          />
        )}
        {verNaGlobal && (
          <Link
            href={`/projetos/${projetoId}/entregas/milestones/${milestone.id}`}
            className={buttonVariants({ variant: 'outline' })}
          >
            Ver na visão global
          </Link>
        )}
      </div>
    ) : undefined

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={trilhasDoProjeto(
          projeto,
          contexto,
          cliente,
          { rotulo: 'Entregas', href: rotas.entregas },
          { rotulo: milestone.titulo },
        )}
        titulo={milestone.titulo}
        contexto={milestone.descricao || 'Sem descrição.'}
        situacao={arquivada ? <BadgeDeEstado tom="neutro">Arquivada</BadgeDeEstado> : undefined}
        acoes={acoes}
      />

      <DetalheDaMilestone
        milestone={milestone}
        podeGerenciar={podeGerenciar}
        hrefConfiguracao={hrefConfiguracao}
        cliente={cliente}
      />

      <AbasDaMilestone
        rotas={{
          issues: rotas.milestone(milestone.id),
          homologacao: rotas.milestone(milestone.id, 'homologacao'),
        }}
        ativa={filtros.aba}
      />

      {filtros.aba === 'homologacao' ? (
        <HomologacaoDaMilestone
          hrefAmbientes={admin ? `/projetos/${projetoId}/configuracao#ambientes` : null}
        />
      ) : (
        <div className="space-y-4">
          <AvisoDeIntegracao
            situacao={dados.situacao}
            sincronizadoEm={dados.sincronizadoEm}
            hrefConfiguracao={hrefConfiguracao ? `${hrefConfiguracao}#repositorios` : null}
          />
          <form method="get" className="flex flex-col gap-3 md:flex-row md:items-end">
            <input type="hidden" name="aba" value="issues" />
            <div className="space-y-1">
              <label
                htmlFor="filtro-milestone-estado"
                className="block text-sm font-medium text-text-primary"
              >
                Situação
              </label>
              <select
                id="filtro-milestone-estado"
                name="estado"
                defaultValue={filtros.estado}
                className={CLASSE_CAMPO}
              >
                <option value="todas">Todas</option>
                <option value="abertas">Abertas</option>
                <option value="fechadas">Fechadas</option>
              </select>
            </div>
            <div className="space-y-1">
              <label
                htmlFor="filtro-milestone-repositorio"
                className="block text-sm font-medium text-text-primary"
              >
                Repositório
              </label>
              <select
                id="filtro-milestone-repositorio"
                name="repositorio"
                defaultValue={filtros.repositorioId ?? ''}
                className={CLASSE_CAMPO}
              >
                <option value="">Todos</option>
                {milestone.repositorios.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.nomeCompleto}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit">Filtrar</Button>
          </form>
          <IssuesDaMilestone
            projetoId={projetoId}
            milestoneId={milestone.id}
            rotas={rotas}
            issues={milestone.issues}
            podeGerenciar={podeGerenciar}
            comFiltros={filtros.estado !== 'todas' || filtros.repositorioId !== null}
          />
          {podeGerenciar && milestone.repositorios.length === 0 && (
            <EstadoVazio
              tipo="nao-configurado"
              titulo="Nenhum repositório GitHub vinculado a este projeto."
              descricao="Vincule repositórios para adicionar issues a esta milestone."
              acao={
                <Link
                  href={`/projetos/${projetoId}/configuracao#repositorios`}
                  className="text-sm text-text-link hover:underline"
                >
                  Vincular repositórios
                </Link>
              }
            />
          )}
          {podeGerenciar && milestone.repositorios.length > 0 && candidatas && (
            <AdicionarIssues
              projetoId={projetoId}
              milestoneId={milestone.id}
              busca={buscaIssue}
              candidatas={candidatas.issues}
              total={candidatas.total}
            />
          )}
        </div>
      )}
    </div>
  )
}
