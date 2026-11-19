import type { ReactNode } from 'react'
import Link from 'next/link'
import { formatarCusto, formatarDataHora } from '@/lib/data'
import { BadgeDeEstado, type TomDeEstado } from '@/lib/ui/badge-de-estado'
import { apresentarEstadoDaExecucao, apresentarStatusDeSeed } from '@/modules/desenvolvimento/model'
import type { ExecucaoDetalhada } from '@/modules/desenvolvimento/queries'
import { AvisosDasFontes } from './fila-de-desenvolvimento'
import { LinhaDoTempoDaExecucao } from './linha-do-tempo-da-execucao'

export interface DetalheDaExecucaoProps {
  execucao: ExecucaoDetalhada
}

type Pr = NonNullable<ExecucaoDetalhada['pullRequest']>

const CHECKS: Record<Pr['checks'], { texto: string; tom: TomDeEstado }> = {
  SUCESSO: { texto: 'Sucesso', tom: 'sucesso' },
  FALHA: { texto: 'Falha', tom: 'erro' },
  PENDENTE: { texto: 'Pendente', tom: 'execucao' },
  SEM_CHECKS: { texto: 'Sem checks', tom: 'neutro' },
}

const ESTADO_DO_PR: Record<Pr['estado'], { texto: string; tom: TomDeEstado }> = {
  ABERTO: { texto: 'Aberto', tom: 'informacao' },
  FECHADO: { texto: 'Fechado', tom: 'neutro' },
  MERGEADO: { texto: 'Mergeado', tom: 'neutro' },
}

const FONTES: Record<ExecucaoDetalhada['fonte'], string> = {
  seeds: 'Seeds',
  'pull-request': 'PR',
  'seeds-e-pull-request': 'Seeds e PR',
}

export const AVISO_DE_EXECUCAO_CONCLUIDA =
  'Execução concluída não significa PR aprovada, CI verde nem issue fechada.'

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section
      aria-label={titulo}
      className="space-y-2 rounded-padrao border border-border bg-surface p-4"
    >
      <h2 className="text-sm font-[650] text-text-primary">{titulo}</h2>
      {children}
    </section>
  )
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-text-secondary">{rotulo}</dt>
      <dd className="min-w-0 break-words text-right text-text-primary">{children}</dd>
    </div>
  )
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="text-sm text-text-secondary">{children}</p>
}

export function DetalheDaExecucao({ execucao }: DetalheDaExecucaoProps) {
  const estado = apresentarEstadoDaExecucao(execucao.estado)
  const { seed, pullRequest: pr } = execucao

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        <AvisosDasFontes
          fontes={{
            github: 'conectada',
            githubSincronizadoEm: null,
            repositorios: [execucao.repositorio.leitura],
          }}
        />
        <Bloco titulo="Estado atual">
          <div className="flex flex-wrap items-center gap-2">
            <BadgeDeEstado tom={estado.tom}>{estado.texto}</BadgeDeEstado>
            <span className="text-sm text-text-primary">{execucao.motivo}</span>
          </div>
          {execucao.estado === 'CONCLUIDA' && (
            <p className="text-sm text-text-secondary">{AVISO_DE_EXECUCAO_CONCLUIDA}</p>
          )}
        </Bloco>
        <Bloco titulo="Linha do tempo">
          <LinhaDoTempoDaExecucao eventos={execucao.linhaDoTempo} />
        </Bloco>
        <Bloco titulo="Falhas">
          <Vazio>As fontes lidas não informam falhas desta execução.</Vazio>
        </Bloco>
        <Bloco titulo="Logs">
          <Vazio>O Warren não disponibiliza logs às fontes lidas pela Central.</Vazio>
        </Bloco>
      </div>

      <aside aria-label="Fontes da execução" className="min-w-0 space-y-4">
        <Bloco titulo="Execução">
          <dl className="space-y-1.5">
            <Dado rotulo="Run">{execucao.runId}</Dado>
            <Dado rotulo="Papel">{execucao.papel ?? 'Sem dados'}</Dado>
            <Dado rotulo="Agente">{execucao.agente ?? 'Sem dados'}</Dado>
            <Dado rotulo="Custo">
              {execucao.custoUsd ? formatarCusto(execucao.custoUsd) : 'Sem dados'}
            </Dado>
            <Dado rotulo="Início">
              {execucao.iniciadaEm
                ? `Registrada no Seeds em ${formatarDataHora(execucao.iniciadaEm)}`
                : 'Sem dados'}
            </Dado>
            <Dado rotulo="Fontes">{FONTES[execucao.fonte]}</Dado>
          </dl>
        </Bloco>

        <Bloco titulo="Seed">
          {seed && seed.status ? (
            <dl className="space-y-1.5">
              <Dado rotulo="Id">{seed.seedId}</Dado>
              <Dado rotulo="Título">{seed.titulo ?? 'Sem dados'}</Dado>
              <Dado rotulo="Status">
                <BadgeDeEstado tom={apresentarStatusDeSeed(seed.status).tom}>
                  {apresentarStatusDeSeed(seed.status).texto}
                </BadgeDeEstado>
              </Dado>
              <Dado rotulo="Plano">{seed.planoNome ?? 'Sem dados'}</Dado>
            </dl>
          ) : (
            <Vazio>{seed ? `${seed.seedId}: ` : ''}Seed não encontrada no .seeds.</Vazio>
          )}
        </Bloco>

        <Bloco titulo="Pull request">
          {pr ? (
            <>
              <dl className="space-y-1.5">
                <Dado rotulo="PR">
                  #{pr.numero} · {pr.titulo}
                </Dado>
                <Dado rotulo="Estado">
                  <BadgeDeEstado tom={ESTADO_DO_PR[pr.estado].tom}>
                    {ESTADO_DO_PR[pr.estado].texto}
                  </BadgeDeEstado>
                </Dado>
                <Dado rotulo="Checks">
                  <BadgeDeEstado tom={CHECKS[pr.checks].tom}>
                    {CHECKS[pr.checks].texto}
                  </BadgeDeEstado>
                </Dado>
                <Dado rotulo="Branch">{pr.branch}</Dado>
              </dl>
              <a
                href={pr.urlHtml}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm font-medium text-text-link hover:underline"
              >
                Abrir no GitHub
              </a>
            </>
          ) : (
            <Vazio>Nenhuma PR desta execução.</Vazio>
          )}
        </Bloco>

        <Bloco titulo="Issue no GitHub">
          {execucao.issuesDoGitHub.length === 0 ? (
            <Vazio>A PR não referencia issues do GitHub.</Vazio>
          ) : (
            <ul className="space-y-1.5">
              {execucao.issuesDoGitHub.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  {i.href ? (
                    <Link href={i.href} className="font-medium text-text-link hover:underline">
                      #{i.numero} · {i.titulo}
                    </Link>
                  ) : (
                    <span className="text-text-primary">
                      #{i.numero} · {i.titulo}
                    </span>
                  )}
                  <BadgeDeEstado tom={i.estado === 'ABERTA' ? 'informacao' : 'neutro'}>
                    {i.estado === 'ABERTA' ? 'Aberta' : 'Fechada'}
                  </BadgeDeEstado>
                </li>
              ))}
            </ul>
          )}
        </Bloco>
      </aside>
    </div>
  )
}
