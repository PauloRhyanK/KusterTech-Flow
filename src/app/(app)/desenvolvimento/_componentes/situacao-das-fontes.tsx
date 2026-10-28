import type { EstadoExecucao } from '@prisma/client'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { formatarDataHora } from '@/lib/data'
import { apresentarEstado } from '@/modules/github/model'
import type {
  LeituraWarrenDoRepositorio,
  SituacaoDasFontes as Fontes,
} from '@/modules/desenvolvimento/queries'

export interface SituacaoDasFontesProps {
  fontes: Fontes
}

const CONTAGENS: readonly { estado: EstadoExecucao; rotulo: string }[] = [
  { estado: 'NA_FILA', rotulo: 'Na fila' },
  { estado: 'AGUARDANDO_CAPACIDADE', rotulo: 'Aguardando capacidade' },
  { estado: 'AGUARDANDO_DEPENDENCIA', rotulo: 'Aguardando dependência' },
  { estado: 'INTERVENCAO_NECESSARIA', rotulo: 'Intervenção necessária' },
  { estado: 'EXECUTANDO', rotulo: 'Executando' },
  { estado: 'SEM_DADOS', rotulo: 'Sem dados' },
  { estado: 'CONCLUIDA', rotulo: 'Concluídas' },
]

function linhasIgnoradas(n: number): string {
  return n === 1
    ? '1 linha ignorada por formato inválido.'
    : `${n} linhas ignoradas por formato inválido.`
}

function LeituraDoRepositorio({ leitura }: { leitura: LeituraWarrenDoRepositorio }) {
  const lidoEm = leitura.lidoEm ? formatarDataHora(leitura.lidoEm) : null
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-[13px]">
      <span className="font-medium text-text-primary">{leitura.repositorio}</span>
      {leitura.situacao === 'falha' ? (
        <>
          <span data-tom="erro" className="text-erro">
            {leitura.falhaMotivo ?? 'Falha ao ler os dados do Warren.'}
          </span>
          {lidoEm && <span className="text-text-secondary">Últimos dados lidos em {lidoEm}</span>}
        </>
      ) : leitura.situacao === 'nao-lido' ? (
        <span className="text-text-secondary">Ainda não lido</span>
      ) : leitura.situacao === 'sem-seeds' ? (
        <span className="text-text-secondary">Sem .seeds/issues.jsonl</span>
      ) : (
        <>
          <span className="text-text-secondary">Lido em {lidoEm}</span>
          {leitura.situacao === 'desatualizado' && (
            <BadgeDeEstado tom="atencao">Desatualizado</BadgeDeEstado>
          )}
        </>
      )}
      {leitura.linhasInvalidas > 0 && (
        <span data-tom="atencao" className="text-atencao">
          {linhasIgnoradas(leitura.linhasInvalidas)}
        </span>
      )}
    </li>
  )
}

export function SituacaoDasFontes({ fontes }: SituacaoDasFontesProps) {
  const github = apresentarEstado(fontes.github)
  const contagens = CONTAGENS.filter((c) => fontes.execucoesPorEstado[c.estado] > 0).map(
    (c) => `${c.rotulo} ${fontes.execucoesPorEstado[c.estado]}`,
  )

  return (
    <section
      aria-label="Situação das fontes"
      className="space-y-4 rounded-padrao border border-border bg-surface p-4"
    >
      <h2 className="text-sm font-[650] text-text-primary">Situação das fontes</h2>
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span className="font-medium text-text-primary">GitHub</span>
        <BadgeDeEstado tom={github.tom}>{github.texto}</BadgeDeEstado>
        {fontes.githubSincronizadoEm && (
          <span className="text-text-secondary">
            Sincronizado em {formatarDataHora(fontes.githubSincronizadoEm)}
          </span>
        )}
      </div>
      <div>
        <p className="text-[13px] font-medium text-text-primary">Warren (.seeds e PRs)</p>
        {fontes.repositorios.length === 0 ? (
          <p className="text-[13px] text-text-secondary">Nenhum repositório vinculado.</p>
        ) : (
          <ul aria-label="Leitura do Warren por repositório" className="divide-y divide-border">
            {fontes.repositorios.map((l) => (
              <LeituraDoRepositorio key={l.repositorio} leitura={l} />
            ))}
          </ul>
        )}
        {contagens.length > 0 && (
          <p className="mt-1 text-[13px] text-text-secondary">{contagens.join(' · ')}</p>
        )}
      </div>
      <div
        role="group"
        aria-label="Capacidade"
        className="flex flex-wrap items-center gap-3 text-[13px]"
      >
        <span className="font-medium text-text-primary">Capacidade</span>
        <BadgeDeEstado tom="neutro">Sem dados</BadgeDeEstado>
        <span className="text-text-secondary">
          O Warren não informa ocupação nem limites às fontes lidas pela Central.
        </span>
      </div>
    </section>
  )
}
