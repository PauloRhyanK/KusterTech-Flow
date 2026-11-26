import type { ReactNode } from 'react'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { QuadroDeMetrica } from '@/lib/ui/quadro-de-metrica'
import { CLASSE_DO_CARTAO, TituloDeSecao } from '@/lib/ui/titulo-de-secao'
import {
  apresentarMaquina,
  avisosDoBeszel,
  formatarTaxa,
  type ContainerNoBeszel,
  type DetalheNoBeszel,
  type PontoNoBeszel,
} from '@/modules/beszel/model'
import {
  LIMITES_DA_OFICINA,
  diaEHora,
  formatarBytes,
  idadeCurta,
  pontosDoGrafico,
} from '@/modules/oficina/model'
import { FaixaDeAtencao } from './faixa-de-atencao'
import { CABECALHO, CABECALHO_NUMERICO, CELULA, CELULA_NUMERICA } from './tabela-da-maquina'

export interface PainelDoBeszelProps {
  detalhe: DetalheNoBeszel
  agora: Date
  // Endereço para abrir o Beszel no navegador (BESZEL_LINK); sem ele, nada de link.
  link: string | null
  // Conteúdo da página que segue o painel: no fim da coluna principal e da lateral.
  principal?: ReactNode
  lateral?: ReactNode
}

const decimal = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const pct = (n: number) => `${Math.round(n)}%`

function Quadro({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={rotulo} className={`${CLASSE_DO_CARTAO} min-w-0 p-4`}>
      {children}
    </div>
  )
}

// `antiga`: a máquina não responde; a nota diz de quando é o valor.
function Cpu({ d, antiga }: { d: DetalheNoBeszel; antiga: string | null }) {
  if (d.cpuPct === null) return <QuadroDeMetrica rotulo="CPU" valor={null} />
  const partes: string[] = []
  if (d.carga) partes.push(`Carga ${d.carga.map(decimal).join(' · ')}`)
  if (d.nucleos !== null) partes.push(d.nucleos === 1 ? '1 núcleo' : `${d.nucleos} núcleos`)
  return (
    <QuadroDeMetrica
      rotulo="CPU"
      valor={pct(d.cpuPct)}
      barra={{ pct: d.cpuPct, tom: 'informacao' }}
      nota={antiga ?? (partes.length > 0 ? partes.join(' · ') : undefined)}
    />
  )
}

function Memoria({ d, antiga }: { d: DetalheNoBeszel; antiga: string | null }) {
  const m = d.memoria
  if (!m) return <QuadroDeMetrica rotulo="Memória" valor={null} />
  const uso = m.totalBytes > 0 ? (m.usadaBytes / m.totalBytes) * 100 : 0
  return (
    <QuadroDeMetrica
      rotulo="Memória"
      valor={formatarBytes(m.usadaBytes)}
      complemento={`de ${formatarBytes(m.totalBytes)}`}
      barra={{ pct: uso, tom: uso > LIMITES_DA_OFICINA.memoriaUsoPct ? 'atencao' : 'informacao' }}
      nota={
        antiga ??
        (m.swapTotalBytes > 0
          ? `Swap ${formatarBytes(m.swapUsadaBytes)} de ${formatarBytes(m.swapTotalBytes)}`
          : undefined)
      }
    />
  )
}

function Disco({ d, antiga }: { d: DetalheNoBeszel; antiga: string | null }) {
  const disco = d.disco
  if (!disco) return <QuadroDeMetrica rotulo="Disco" valor={null} />
  const uso = disco.totalBytes > 0 ? (disco.usadoBytes / disco.totalBytes) * 100 : 0
  return (
    <QuadroDeMetrica
      rotulo="Disco"
      valor={formatarBytes(Math.max(0, disco.totalBytes - disco.usadoBytes))}
      complemento={`livres de ${formatarBytes(disco.totalBytes)}`}
      barra={{ pct: uso, tom: uso > LIMITES_DA_OFICINA.discoUsoPct ? 'atencao' : 'informacao' }}
      nota={antiga ?? `${pct(uso)} em uso`}
    />
  )
}

function Rede({ d, antiga }: { d: DetalheNoBeszel; antiga: string | null }) {
  if (!d.rede) return <QuadroDeMetrica rotulo="Rede" valor={null} />
  return (
    <QuadroDeMetrica
      rotulo="Rede"
      valor={formatarTaxa(d.rede.recebendoBytesS)}
      complemento="recebendo"
      nota={antiga ?? `Enviando ${formatarTaxa(d.rede.enviandoBytesS)}`}
      className="[&>p:last-child]:!mt-3.5"
    />
  )
}

const SAUDE: Record<ContainerNoBeszel['saude'], { sufixo: string; tom: 'neutro' | 'erro' }> = {
  sem_checagem: { sufixo: '', tom: 'neutro' },
  iniciando: { sufixo: ' · iniciando', tom: 'neutro' },
  saudavel: { sufixo: ' · saudável', tom: 'neutro' },
  com_falha: { sufixo: ' · com falha', tom: 'erro' },
}

function Containers({
  containers,
  ultimaLeitura,
}: {
  // null: o Beszel não informou os contêineres nesta leitura.
  containers: ContainerNoBeszel[] | null
  // A máquina não responde: a lista é a da última leitura, sem afirmar "No ar".
  ultimaLeitura: boolean
}) {
  if (containers === null) {
    return (
      <section aria-labelledby="titulo-containers-beszel">
        <TituloDeSecao id="titulo-containers-beszel">Contêineres</TituloDeSecao>
        <p className={`${CLASSE_DO_CARTAO} p-4 text-sm text-text-secondary`}>
          O Beszel não informou os contêineres agora.
        </p>
      </section>
    )
  }
  return (
    <section aria-labelledby="titulo-containers-beszel">
      <TituloDeSecao id="titulo-containers-beszel">
        {ultimaLeitura
          ? 'Contêineres · última leitura'
          : `Contêineres · ${containers.length} no ar`}
      </TituloDeSecao>
      {containers.length === 0 ? (
        <p className={`${CLASSE_DO_CARTAO} p-4 text-sm text-text-secondary`}>
          Nenhum contêiner informado pelo Beszel.
        </p>
      ) : (
        <div className={`${CLASSE_DO_CARTAO} overflow-hidden`}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={CABECALHO}>Nome</th>
                <th className={CABECALHO_NUMERICO}>CPU</th>
                <th className={CABECALHO_NUMERICO}>Memória</th>
                <th className={`${CABECALHO} hidden sm:table-cell`}>Desde</th>
                <th className={CABECALHO}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c) => {
                const saude = SAUDE[c.saude]
                return (
                  <tr key={c.nome}>
                    <td className={`${CELULA} font-mono text-[12.5px] [overflow-wrap:anywhere]`}>
                      {c.nome}
                    </td>
                    <td className={CELULA_NUMERICA}>
                      {c.cpuPct === null ? '—' : `${decimal(Math.round(c.cpuPct * 10) / 10)}%`}
                    </td>
                    <td className={CELULA_NUMERICA}>
                      {c.memoriaBytes === null ? '—' : formatarBytes(c.memoriaBytes)}
                    </td>
                    <td className={`${CELULA} hidden whitespace-nowrap sm:table-cell`}>
                      {c.desde ?? '—'}
                    </td>
                    <td className={CELULA}>
                      {ultimaLeitura ? (
                        <BadgeDeEstado tom="neutro" className="whitespace-nowrap">
                          Sem resposta
                        </BadgeDeEstado>
                      ) : (
                        <BadgeDeEstado tom={saude.tom} className="whitespace-nowrap">
                          {`No ar${saude.sufixo}`}
                        </BadgeDeEstado>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

interface Serie {
  rotulo: string
  valores: number[]
  atual: string
  cor: string
}

function Historico({
  historico,
  d,
  agora,
}: {
  historico: PontoNoBeszel[]
  d: DetalheNoBeszel
  agora: Date
}) {
  const serie = (
    rotulo: string,
    ler: (p: PontoNoBeszel) => number | null,
    atual: (v: number) => string,
    cor: string,
  ): Serie | null => {
    const valores = historico.map(ler).filter((v): v is number => v !== null)
    return valores.length === 0 ? null : { rotulo, valores, atual: atual(valores.at(-1)!), cor }
  }
  const discoAcima = d.discoPct !== null && d.discoPct > LIMITES_DA_OFICINA.discoUsoPct
  const series = [
    serie('CPU', (p) => p.cpuPct, pct, 'stroke-action-primary'),
    serie('Memória', (p) => p.memPct, pct, 'stroke-action-primary'),
    serie('Disco', (p) => p.discoPct, pct, discoAcima ? 'stroke-atencao' : 'stroke-action-primary'),
    serie('Rede ↓', (p) => p.recebendoBytesS, formatarTaxa, 'stroke-action-primary'),
  ].filter((s): s is Serie => s !== null)

  const inicio = historico[0] ? diaEHora(historico[0].em, agora) : null
  return (
    <section aria-labelledby="titulo-historico-beszel">
      <TituloDeSecao id="titulo-historico-beszel">Últimas 24 horas</TituloDeSecao>
      {series.length === 0 ? (
        <p className={`${CLASSE_DO_CARTAO} p-4 text-sm text-text-secondary`}>
          Sem histórico ainda.
        </p>
      ) : (
        <div className={`${CLASSE_DO_CARTAO} grid gap-3.5 p-4`}>
          {series.map((s) => (
            <div
              key={s.rotulo}
              className="grid grid-cols-[70px_minmax(0,1fr)_64px] items-center gap-2.5 text-[12.5px]"
            >
              <span className="text-text-secondary">{s.rotulo}</span>
              <svg
                viewBox="0 0 300 34"
                preserveAspectRatio="none"
                className="block h-[34px] w-full"
                aria-hidden="true"
              >
                <polyline
                  points={pontosDoGrafico(s.valores, 300, 34)}
                  fill="none"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  className={s.cor}
                />
              </svg>
              <span className="text-right font-[600] tabular-nums text-text-primary">
                {s.atual}
              </span>
            </div>
          ))}
          {inicio && (
            <div className="flex justify-between pl-[80px] pr-[74px] text-[11px] text-text-tertiary">
              <span>{`${inicio.dia} ${inicio.hora}`}</span>
              <span>agora</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// Painel de uma máquina lida pelo Beszel (D82). Recebe o detalhe pronto: não lê rede nem banco.
export function PainelDoBeszel({ detalhe, agora, link, principal, lateral }: PainelDoBeszelProps) {
  const { tom, texto } = apresentarMaquina(detalhe, agora)
  const antiga =
    tom === 'sem_resposta' ? `Última leitura, há ${idadeCurta(detalhe.lidaEm, agora)}` : null
  const ligada =
    detalhe.ligadaHaS === null
      ? null
      : idadeCurta(new Date(agora.getTime() - detalhe.ligadaHaS * 1000), agora)

  return (
    <div className="space-y-6">
      <div className="space-y-5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary">
          {ligada && tom !== 'sem_resposta' && <span>{`Ligada há ${ligada} ·`}</span>}
          {tom === 'sem_resposta' ? (
            <BadgeDeEstado tom="atencao">{texto!}</BadgeDeEstado>
          ) : (
            <BadgeDeEstado tom="neutro">{`Leitura de há ${idadeCurta(detalhe.lidaEm, agora)}`}</BadgeDeEstado>
          )}
        </p>
        <FaixaDeAtencao avisos={avisosDoBeszel(detalhe)} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Quadro rotulo="CPU">
            <Cpu d={detalhe} antiga={antiga} />
          </Quadro>
          <Quadro rotulo="Memória">
            <Memoria d={detalhe} antiga={antiga} />
          </Quadro>
          <Quadro rotulo="Disco">
            <Disco d={detalhe} antiga={antiga} />
          </Quadro>
          <Quadro rotulo="Rede">
            <Rede d={detalhe} antiga={antiga} />
          </Quadro>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Containers
            containers={detalhe.containers === null ? null : detalhe.containersDetalhe}
            ultimaLeitura={tom === 'sem_resposta'}
          />
          <Historico historico={detalhe.historico} d={detalhe} agora={agora} />
          {principal}
        </div>
        <aside className="min-w-0 space-y-6">
          <section className={`${CLASSE_DO_CARTAO} space-y-3 p-4`}>
            <dl className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-text-secondary">No Beszel como</dt>
                <dd className="font-mono text-[12.5px] text-text-primary">{detalhe.nome}</dd>
              </div>
            </dl>
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm text-text-link hover:underline"
              >
                Abrir no Beszel ↗
              </a>
            )}
          </section>
          {lateral}
        </aside>
      </div>
    </div>
  )
}
