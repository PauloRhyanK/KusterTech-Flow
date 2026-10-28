import Link from 'next/link'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import {
  apresentarEstadoDoAlerta,
  apresentarSeveridade,
  vezesRecebido,
} from '@/modules/infra/model'
import type { AlertaDetalhado } from '@/modules/infra/queries'
import { AcoesDoAlerta } from './acoes-do-alerta'

export interface DetalheDoAlertaProps {
  alerta: AlertaDetalhado
  podeGerenciar: boolean
}

const SECAO = 'space-y-3 rounded-padrao border border-border bg-surface p-4'
const TITULO_DA_SECAO = 'text-[15px] font-[600] text-text-primary'
const ROTULOS_DO_HISTORICO = {
  CRIADO: 'Criado',
  RECONHECIDO: 'Reconhecido',
  RESOLVIDO: 'Resolvido',
  REABERTO: 'Reaberto',
} as const

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
      <dt className="text-text-secondary">{rotulo}</dt>
      <dd className="text-text-primary">{children}</dd>
    </div>
  )
}

function textoDaResolucao(alerta: AlertaDetalhado): string | null {
  if (!alerta.resolucao) return null
  const quando = formatarDataHora(alerta.resolucao.em)
  return alerta.resolucao.por
    ? `Resolução registrada por ${alerta.resolucao.por} em ${quando}.`
    : `Resolvido pela fonte em ${quando}.`
}

export function DetalheDoAlerta({ alerta, podeGerenciar }: DetalheDoAlertaProps) {
  const estado = apresentarEstadoDoAlerta(alerta.estado)
  const severidade = apresentarSeveridade(alerta.severidade)
  const resolucao = textoDaResolucao(alerta)
  const aguardaFonte = alerta.origem === 'WEBHOOK' && alerta.estado !== 'RESOLVIDO_NA_ORIGEM'

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        <section className={SECAO}>
          <div className="flex flex-wrap items-center gap-1.5">
            <BadgeDeEstado tom={severidade.tom}>{severidade.texto}</BadgeDeEstado>
            <BadgeDeEstado tom={estado.tom}>{estado.texto}</BadgeDeEstado>
          </div>
          {alerta.estado === 'RECONHECIDO' && (
            <p className="text-sm text-text-secondary">
              O alerta foi reconhecido, mas continua ativo na origem.
            </p>
          )}
          {resolucao && <p className="text-sm text-text-secondary">{resolucao}</p>}
          {aguardaFonte && (
            <p className="text-sm text-text-secondary">
              Este alerta será resolvido quando a fonte informar a resolução.
            </p>
          )}
          {podeGerenciar && (
            <AcoesDoAlerta
              alertaId={alerta.id}
              podeReconhecer={alerta.estado === 'ATIVO'}
              podeRegistrarResolucao={alerta.podeRegistrarResolucao}
            />
          )}
        </section>

        <section className={SECAO}>
          <h2 className={TITULO_DA_SECAO}>Detalhe</h2>
          {alerta.detalhe ? (
            <p className="whitespace-pre-wrap break-words text-sm text-text-primary">
              {alerta.detalhe}
            </p>
          ) : (
            <p className="text-sm text-text-secondary">Sem detalhe.</p>
          )}
        </section>

        <section className={SECAO}>
          <h2 className={TITULO_DA_SECAO}>Histórico</h2>
          <ol aria-label="Histórico do alerta" className="divide-y divide-border">
            {alerta.historico.map((h, i) => (
              <li
                key={`${h.tipo}-${i}`}
                className="flex flex-wrap justify-between gap-2 py-2 text-sm"
              >
                <span className="text-text-primary">
                  {ROTULOS_DO_HISTORICO[h.tipo]} · {h.autor ?? 'Sistema'}
                </span>
                <span className="text-text-secondary">{formatarDataHora(h.em)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="min-w-0 space-y-6">
        <section className={SECAO}>
          <h2 className={TITULO_DA_SECAO}>Ocorrências</h2>
          <dl className="space-y-2">
            <Dado rotulo="Origem">{alerta.origemTexto}</Dado>
            <Dado rotulo="Primeira ocorrência">
              {formatarDataHora(alerta.primeiraOcorrenciaEm)}
            </Dado>
            <Dado rotulo="Última ocorrência">{formatarDataHora(alerta.ultimaOcorrenciaEm)}</Dado>
            <Dado rotulo="Recebimentos">{vezesRecebido(alerta.ocorrencias)}</Dado>
            {alerta.reconhecido && (
              <Dado rotulo="Reconhecido por">
                {alerta.reconhecido.por} · {formatarDataHora(alerta.reconhecido.em)}
              </Dado>
            )}
          </dl>
        </section>

        <section className={SECAO}>
          <h2 className={TITULO_DA_SECAO}>Recurso</h2>
          {alerta.recurso ? (
            <Link
              href={`/infraestrutura/recursos/${alerta.recurso.id}`}
              className="text-sm text-text-link hover:underline"
            >
              {alerta.recurso.nome}
            </Link>
          ) : (
            <p className="text-sm text-text-secondary">Sem recurso associado.</p>
          )}
        </section>

        <section className={SECAO}>
          <h2 className={TITULO_DA_SECAO}>Projetos potencialmente afetados</h2>
          {alerta.projetosAfetados.length === 0 ? (
            <p className="text-sm text-text-secondary">Nenhum projeto associado.</p>
          ) : (
            <ul aria-label="Projetos potencialmente afetados" className="space-y-1.5 text-sm">
              {alerta.projetosAfetados.map((p) => (
                <li key={p.id}>
                  <Link href={`/projetos/${p.id}/saude`} className="text-text-link hover:underline">
                    {p.nome}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-text-secondary">O impacto nos projetos não está confirmado.</p>
        </section>
      </aside>
    </div>
  )
}
