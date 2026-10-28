import type { ReactNode } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { apresentarEstadoDaExecucao, apresentarStatusDeSeed } from '@/modules/desenvolvimento/model'
import type {
  ExecucaoResumida,
  GrupoDeProjeto,
  GrupoDeSeed,
} from '@/modules/desenvolvimento/queries'

export interface ExecucoesAgrupadasProps {
  grupos: readonly GrupoDeProjeto[]
  projetos: readonly { id: string; nome: string }[]
  projetoId: string | null
}

const ESTADO_DO_PR: Record<string, string> = {
  ABERTO: 'Aberto',
  FECHADO: 'Fechado',
  MERGEADO: 'Mergeado',
}

const CLASSE_CAMPO =
  'h-8 w-full max-w-full rounded-compacto border border-border bg-surface px-2 sm:w-auto sm:max-w-[16rem] text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

function plural(n: number): string {
  return n === 1 ? '1 execução' : `${n} execuções`
}

function Execucao({ execucao }: { execucao: ExecucaoResumida }) {
  const estado = apresentarEstadoDaExecucao(execucao.estado)
  const quem = [execucao.papel, execucao.agente].filter((p) => p !== null).join(' · ')
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-2 text-[13px]">
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium text-text-primary">
          {execucao.runId}
          {quem && <span className="font-normal text-text-secondary"> · {quem}</span>}
        </p>
        <p className="text-text-secondary">{execucao.motivo}</p>
        {execucao.pr && (
          <p className="text-text-secondary">
            PR #{execucao.pr.numero} · {ESTADO_DO_PR[execucao.pr.estado] ?? execucao.pr.estado}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <BadgeDeEstado tom={estado.tom}>{estado.texto}</BadgeDeEstado>
        <Link
          href={`/desenvolvimento/execucoes/${execucao.id}`}
          className="font-medium text-text-link hover:underline"
        >
          Abrir execução
        </Link>
      </div>
    </li>
  )
}

function ListaDeExecucoes({
  execucoes,
  rotulo,
}: {
  execucoes: readonly ExecucaoResumida[]
  rotulo: string
}) {
  return (
    <ul aria-label={rotulo} className="divide-y divide-border border-t border-border">
      {execucoes.map((e) => (
        <Execucao key={e.id} execucao={e} />
      ))}
    </ul>
  )
}

function Seed({ seed }: { seed: GrupoDeSeed }) {
  const status = seed.status ? apresentarStatusDeSeed(seed.status) : null
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px] [&::-webkit-details-marker]:hidden">
        <span className="font-medium text-text-primary">
          {seed.seedId}
          {seed.titulo && ` · ${seed.titulo}`}
        </span>
        {status && <BadgeDeEstado tom={status.tom}>{status.texto}</BadgeDeEstado>}
        {seed.planoNome && <span className="text-text-secondary">Plano: {seed.planoNome}</span>}
        <span className="text-text-secondary">{plural(seed.execucoes.length)}</span>
        {seed.motivoDeEspera && <span className="text-atencao">{seed.motivoDeEspera}</span>}
      </summary>
      {seed.execucoes.length === 0 ? (
        <p className="border-t border-border px-4 py-2 text-[13px] text-text-secondary">
          Sem execução registrada.
        </p>
      ) : (
        <ListaDeExecucoes execucoes={seed.execucoes} rotulo={`Execuções de ${seed.seedId}`} />
      )}
    </details>
  )
}

function Moldura({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-padrao border border-border bg-surface">
      {children}
    </div>
  )
}

export function ExecucoesAgrupadas({ grupos, projetos, projetoId }: ExecucoesAgrupadasProps) {
  return (
    <section aria-label="Execuções por projeto e issue" className="space-y-6">
      <form method="GET" action="/desenvolvimento" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="visao" value="execucoes" />
        <div className="space-y-1">
          <label htmlFor="filtro-projeto" className="block text-xs font-medium text-text-secondary">
            Projeto
          </label>
          <select
            id="filtro-projeto"
            name="projeto"
            defaultValue={projetoId ?? ''}
            className={CLASSE_CAMPO}
          >
            <option value="">Todos</option>
            {projetos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
      </form>

      {grupos.length === 0 ? (
        <EstadoVazio
          tipo="nenhum-registro"
          titulo="Nenhuma execução do Warren encontrada."
          descricao="As execuções aparecem quando um repositório vinculado tem .seeds/issues.jsonl ou PRs do Warren."
        />
      ) : (
        grupos.map((grupo) => (
          <div key={grupo.projeto.id} className="space-y-2">
            <h2 className="text-sm font-[650] text-text-primary">{grupo.projeto.nome}</h2>
            <Moldura>
              {grupo.seeds.map((seed) => (
                <Seed key={`${seed.repositorio}/${seed.seedId}`} seed={seed} />
              ))}
              {grupo.semSeed.length > 0 && (
                <div>
                  <p className="px-4 py-2 text-[13px] font-medium text-text-primary">
                    Execuções sem seed identificada
                  </p>
                  <ListaDeExecucoes
                    execucoes={grupo.semSeed}
                    rotulo={`Execuções sem seed de ${grupo.projeto.nome}`}
                  />
                </div>
              )}
              {grupo.seeds.length === 0 && grupo.semSeed.length === 0 && (
                <p className="px-4 py-2 text-[13px] text-text-secondary">
                  Nenhuma seed encontrada.
                </p>
              )}
            </Moldura>
          </div>
        ))
      )}
    </section>
  )
}
