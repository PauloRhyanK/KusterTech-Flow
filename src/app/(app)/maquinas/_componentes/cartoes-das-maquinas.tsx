import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { PontoDaMaquina } from '@/lib/ui/ponto-da-maquina'
import { CLASSE_DO_CARTAO } from '@/lib/ui/titulo-de-secao'
import { apresentarMaquina, formatarTaxa, ordenarMaquinas } from '@/modules/beszel/model'
import type { ResumoDoBeszel } from '@/modules/beszel/queries'
import { LIMITES_DA_OFICINA, idadeCurta } from '@/modules/oficina/model'

export interface CartoesDasMaquinasProps {
  resumo: ResumoDoBeszel
  agora: Date
}

type Maquina = ResumoDoBeszel['maquinas'][number]

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`)

export function ligadaHa(m: Maquina, agora: Date): string | null {
  return m.ligadaHaS === null
    ? null
    : `ligada há ${idadeCurta(new Date(agora.getTime() - m.ligadaHaS * 1000), agora)}`
}

function Medida({
  rotulo,
  valor,
  limite,
}: {
  rotulo: string
  valor: number | null
  limite: number | null
}) {
  const acima = valor !== null && limite !== null && valor > limite
  const largura = valor === null ? 0 : Math.min(100, Math.max(0, Math.round(valor)))
  return (
    <div className="mt-[7px] grid grid-cols-[56px_minmax(0,1fr)_44px] items-center gap-2 text-[12.5px]">
      <span className="text-text-secondary">{rotulo}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
        <span
          className={`block h-full rounded-full ${acima ? 'bg-atencao' : 'bg-action-primary'}`}
          style={{ width: `${largura}%` }}
        />
      </span>
      <span
        className={`text-right font-[600] tabular-nums ${acima ? 'text-atencao' : 'text-text-primary'}`}
      >
        {pct(valor)}
      </span>
    </div>
  )
}

function Cartao({ m, agora, ordem }: { m: Maquina; agora: Date; ordem: number }) {
  const { tom, texto } = apresentarMaquina(m, agora)
  const semResposta = tom === 'sem_resposta'
  const conteudo: ReactNode = (
    <>
      <div className="mb-3 flex items-center gap-2">
        <PontoDaMaquina tom={tom} />
        <span className="truncate text-[15px] font-[600] text-text-primary">{m.nome}</span>
        <span className="ml-auto whitespace-nowrap text-[11.5px] text-text-tertiary">
          {semResposta ? '—' : ligadaHa(m, agora)}
        </span>
      </div>
      {semResposta ? (
        <>
          <p className="pb-1.5 pt-3">
            <BadgeDeEstado tom="atencao">{texto!}</BadgeDeEstado>
          </p>
          <p className="text-[12.5px] text-text-tertiary">
            {`Última leitura: CPU ${pct(m.cpuPct)} · memória ${pct(m.memPct)} · disco ${pct(m.discoPct)}`}
          </p>
        </>
      ) : (
        <>
          <Medida rotulo="CPU" valor={m.cpuPct} limite={null} />
          <Medida rotulo="Memória" valor={m.memPct} limite={LIMITES_DA_OFICINA.memoriaUsoPct} />
          <Medida rotulo="Disco" valor={m.discoPct} limite={LIMITES_DA_OFICINA.discoUsoPct} />
          <div className="mt-3 flex justify-between border-t border-border pt-2.5 text-[12px] text-text-secondary">
            <span>
              {m.containers === null
                ? '— contêineres'
                : m.containers === 1
                  ? '1 contêiner'
                  : `${m.containers} contêineres`}
            </span>
            {m.redeBytesS !== null && <span>{`rede ${formatarTaxa(m.redeBytesS)}`}</span>}
          </div>
        </>
      )}
      {m.recursoId === null && (
        <p className="mt-2.5">
          <BadgeDeEstado tom="neutro">Fora do cadastro</BadgeDeEstado>
        </p>
      )}
    </>
  )
  // No celular, as máquinas que pedem atenção vêm primeiro; no desktop, a ordem do cadastro.
  const estilo = { '--ordem': ordem } as CSSProperties
  const classe = `${CLASSE_DO_CARTAO} order-[var(--ordem)] block min-w-0 px-4 py-3.5 lg:order-none`
  return m.recursoId ? (
    <Link
      href={`/maquinas/${m.recursoId}`}
      className={`${classe} hover:border-border-strong`}
      style={estilo}
    >
      {conteudo}
    </Link>
  ) : (
    <div className={classe} style={estilo}>
      {conteudo}
    </div>
  )
}

// Página Máquinas: um cartão por máquina lida pelo Beszel. Só com a leitura em dia.
export function CartoesDasMaquinas({ resumo, agora }: CartoesDasMaquinasProps) {
  if (resumo.situacao !== 'ok' || resumo.maquinas.length === 0) return null
  const ordemNoCelular = new Map(
    ordenarMaquinas(resumo.maquinas, null, agora, 'atencao').map((m, i) => [m.sistemaId, i]),
  )
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {resumo.maquinas.map((m) => (
        <Cartao
          key={m.sistemaId}
          m={m}
          agora={agora}
          ordem={ordemNoCelular.get(m.sistemaId) ?? 0}
        />
      ))}
    </div>
  )
}
