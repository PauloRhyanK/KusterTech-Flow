import Link from 'next/link'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { cn } from '@/lib/utils'
import type { EstadoIntegracao } from '@/modules/github/model'
import type { PendenciaDeHomologacao, ResumoApresentado } from '@/modules/homologacao/queries'
import { buttonVariants } from '@/components/ui/button'
import type { obterEntregasParaResumo } from '@/modules/entregas/queries'
import {
  calcularChecklist,
  rotasDoProjeto,
  type ContagensDoProjeto,
  type Contexto,
} from '@/modules/projetos/model'
import type { resumoDeSaude } from '@/modules/infra/model'
import type { ProjetoResumo } from '@/modules/projetos/service'
import { ChecklistDeConfiguracao } from './checklist-de-configuracao'
import { ListaDeMilestones } from './lista-de-milestones'
import { PendenciasDeHomologacao } from './pendencias-de-homologacao'
import { ResumoDeSaude } from './resumo-de-saude'

export interface ResumoDoProjetoProps {
  projeto: ProjetoResumo
  contagens: ContagensDoProjeto
  entregas: Awaited<ReturnType<typeof obterEntregasParaResumo>>
  estadoGitHub?: EstadoIntegracao
  homologacao?: ReadonlyMap<string, ResumoApresentado>
  pendencias?: readonly PendenciaDeHomologacao[]
  saude?: ReturnType<typeof resumoDeSaude>
  contexto: Contexto
  podeGerenciar: boolean
  cliente?: { id: string; nome: string }
  className?: string
}

export function ResumoDoProjeto({
  projeto,
  contagens,
  entregas,
  estadoGitHub = 'nao-configurada',
  homologacao,
  pendencias = [],
  saude,
  contexto,
  podeGerenciar,
  cliente,
  className,
}: ResumoDoProjetoProps) {
  const nomeDoCliente =
    cliente?.nome ??
    (contexto.tipo === 'cliente'
      ? (projeto.clientes.find((c) => c.id === contexto.clienteId)?.nome ?? '')
      : '')

  const rotas = rotasDoProjeto(projeto.id, contexto)
  const vazio =
    contexto.tipo === 'global'
      ? {
          titulo: 'Nenhuma milestone criada.',
          descricao: 'Crie a primeira milestone em Entregas.',
        }
      : {
          titulo: 'Nenhuma milestone associada a este cliente.',
          descricao: 'Quando uma milestone for associada, ela aparece aqui.',
        }

  return (
    <div className={cn('space-y-8', className)}>
      {/* 1. Próximas ações */}
      <section className="space-y-3">
        <h2 className="text-[18px] font-[600] leading-[1.3] text-text-primary">Próximas ações</h2>
        {contexto.tipo === 'global' ? (
          <>
            <ChecklistDeConfiguracao
              itens={calcularChecklist(
                contagens,
                podeGerenciar ? `/projetos/${projeto.id}/configuracao` : null,
                estadoGitHub,
                podeGerenciar ? rotas.entregas : null,
              )}
            />
            <h3 className="text-[15px] font-[600] text-text-primary">Homologações pendentes</h3>
            <PendenciasDeHomologacao
              pendencias={pendencias}
              contexto="cliente"
              vazio={{
                titulo: 'Nenhuma homologação pendente.',
                descricao: 'Issues entram em homologação quando a presença em QA é confirmada.',
              }}
            />
          </>
        ) : (
          <PendenciasDeHomologacao
            pendencias={pendencias}
            contexto={null}
            vazio={{
              titulo: 'Nenhuma ação pendente para este cliente.',
              descricao: 'Issues entram em homologação quando a presença em QA é confirmada.',
            }}
          />
        )}
      </section>

      {/* 2. Entregas */}
      <section className="space-y-3">
        <h2 className="text-[18px] font-[600] leading-[1.3] text-text-primary">Entregas</h2>
        <ListaDeMilestones
          rotas={rotas}
          milestones={entregas.milestones}
          homologacao={homologacao}
          rotulo="Milestones ativas"
          vazio={vazio}
        />
        <Link href={rotas.entregas} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          Ver todas as entregas
        </Link>
      </section>

      {/* 3. Indicadores */}
      <section className="space-y-3">
        <h2 className="text-[18px] font-[600] leading-[1.3] text-text-primary">Indicadores</h2>
        <ul
          role="list"
          aria-label="Indicadores do projeto"
          className="space-y-1 rounded-lg border border-border bg-surface p-4 text-sm text-text-primary"
        >
          <li>Milestones ativas: {entregas.totalAtivas}</li>
          <li>Issues abertas em milestones: {entregas.issuesAbertasEmMilestones}</li>
        </ul>
      </section>

      {/* 4. Saúde (só visão global, só com infraestrutura.ler) */}
      {contexto.tipo === 'global' && saude && (
        <section className="space-y-3">
          <h2 className="text-[18px] font-[600] leading-[1.3] text-text-primary">Saúde</h2>
          <ResumoDeSaude projetoId={projeto.id} saude={saude} />
        </section>
      )}

      {/* 5. Clientes */}
      <section className="space-y-3">
        <h2 className="text-[18px] font-[600] leading-[1.3] text-text-primary">Clientes</h2>
        {contexto.tipo === 'global' ? (
          projeto.clientes.length > 0 ? (
            <ul role="list" aria-label="Clientes associados" className="space-y-2">
              {projeto.clientes.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface p-3"
                >
                  <Link
                    href={`/clientes/${c.id}/projetos/${projeto.id}`}
                    className="text-sm font-medium text-text-link hover:underline"
                  >
                    {c.nome}
                  </Link>
                  {c.arquivadoEm && <BadgeDeEstado tom="neutro">Arquivado</BadgeDeEstado>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-sm text-text-secondary">Nenhum cliente associado.</p>
            </div>
          )
        ) : (
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-sm text-text-secondary">
              Você está vendo este projeto no contexto de {nomeDoCliente}.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
