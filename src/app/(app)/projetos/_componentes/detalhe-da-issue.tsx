import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado, type TomDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import type { IssueDetalhada } from '@/modules/github/queries'

type Pr = IssueDetalhada['pullRequests'][number]

const CHECKS: Record<Pr['checks'], { texto: string; tom: TomDeEstado }> = {
  SUCESSO: { texto: 'Sucesso', tom: 'sucesso' },
  FALHA: { texto: 'Falha', tom: 'erro' },
  PENDENTE: { texto: 'Pendente', tom: 'execucao' },
  SEM_CHECKS: { texto: 'Sem checks', tom: 'neutro' },
}

const ESTADO_DO_PR: Record<Pr['estado'], string> = {
  ABERTO: 'Aberto',
  FECHADO: 'Fechado',
  MERGEADO: 'Mergeado',
}

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-text-secondary">{rotulo}</dt>
      <dd className="min-w-0 break-words text-right text-text-primary">{children}</dd>
    </div>
  )
}

export interface DetalheDaIssueProps {
  issue: IssueDetalhada
  modo: 'global' | 'cliente'
  lateral: React.ReactNode
}

// No modo cliente os dados técnicos internos ficam de fora (decisão 8 do Incremento 3).
export function DetalheDaIssue({ issue, modo, lateral }: DetalheDaIssueProps) {
  const global = modo === 'global'

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        <section className="rounded-padrao border border-border bg-surface p-6">
          {issue.corpo ? (
            <p className="whitespace-pre-wrap break-words text-sm text-text-primary">
              {issue.corpo}
            </p>
          ) : (
            <p className="text-sm text-text-secondary">Sem descrição.</p>
          )}
        </section>
        <EstadoVazio
          tipo="nao-configurado"
          titulo="A timeline de homologação chega no Incremento 5a."
          descricao="Aqui ficará o histórico de testes e decisões desta issue."
        />
      </div>

      <aside className="min-w-0 space-y-6">
        <section className="space-y-3 rounded-padrao border border-border bg-surface p-4">
          <h2 className="text-[15px] font-[600] text-text-primary">GitHub</h2>
          <dl className="space-y-2">
            <Dado rotulo="Situação">
              {issue.estado === 'ABERTA' ? (
                <BadgeDeEstado tom="informacao">Aberta</BadgeDeEstado>
              ) : (
                <BadgeDeEstado tom="neutro">Fechada</BadgeDeEstado>
              )}
            </Dado>
            <Dado rotulo="Repositório">{issue.repositorio}</Dado>
            {global && (
              <>
                <Dado rotulo="Autor">{issue.autor ?? '—'}</Dado>
                <Dado rotulo="Responsáveis">
                  {issue.responsaveis.length > 0 ? issue.responsaveis.join(', ') : '—'}
                </Dado>
                <Dado rotulo="Rótulos">
                  {issue.rotulos.length > 0 ? issue.rotulos.join(', ') : '—'}
                </Dado>
              </>
            )}
            <Dado rotulo="Criada">{formatarDataHora(issue.criadaNoGitHub)}</Dado>
            <Dado rotulo="Atualizada">{formatarDataHora(issue.atualizadaNoGitHub)}</Dado>
            {issue.fechadaNoGitHub && (
              <Dado rotulo="Fechada em">{formatarDataHora(issue.fechadaNoGitHub)}</Dado>
            )}
          </dl>
          {global && (
            <a
              href={issue.urlHtml}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-text-link hover:underline"
            >
              Abrir no GitHub
            </a>
          )}
        </section>

        {lateral}

        {global && (
          <section className="space-y-3 rounded-padrao border border-border bg-surface p-4">
            <h2 className="text-[15px] font-[600] text-text-primary">Pull requests</h2>
            {issue.pullRequests.length === 0 ? (
              <p className="text-sm text-text-secondary">
                Nenhum pull request referencia esta issue.
              </p>
            ) : (
              <ul className="space-y-3">
                {issue.pullRequests.map((pr) => (
                  <li key={pr.numero} className="space-y-1 text-sm">
                    <a
                      href={pr.urlHtml}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-link hover:underline"
                    >
                      #{pr.numero} {pr.titulo}
                    </a>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-text-secondary">{ESTADO_DO_PR[pr.estado]}</span>
                      <BadgeDeEstado tom={CHECKS[pr.checks].tom}>
                        {CHECKS[pr.checks].texto}
                      </BadgeDeEstado>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-[15px] font-[600] text-text-primary">Versão e ambiente</h2>
          <EstadoVazio
            tipo="sem-evidencia"
            titulo="Sem evidência de versão ou ambiente."
            descricao="Presença em DEV, QA e PROD chega no Incremento 4."
          />
        </section>
      </aside>
    </div>
  )
}
