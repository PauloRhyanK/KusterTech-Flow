import Link from 'next/link'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { PontoDaMaquina } from '@/lib/ui/ponto-da-maquina'
import { QuadroDeMetrica } from '@/lib/ui/quadro-de-metrica'
import { CLASSE_DO_CARTAO, CLASSE_DO_LINK, TituloDeSecao } from '@/lib/ui/titulo-de-secao'
import { apresentarMaquina } from '@/modules/beszel/model'
import type { Inicio } from '@/modules/inicio/queries'
import {
  LIMITES_DA_OFICINA,
  formatarBytes,
  idadeCurta,
  leituraVelha,
  type LeituraDaMaquina,
} from '@/modules/oficina/model'

export interface QuadroDasMaquinasProps {
  maquinas: Inicio['maquinas']
  agora: Date
}

type Maquinas = NonNullable<Inicio['maquinas']>

const GRADE = 'grid grid-cols-[14px_minmax(0,1fr)_46px_46px_46px] items-center gap-2'

function Pct({ valor, limite }: { valor: number | null; limite: number | null }) {
  if (valor === null) return <span className="text-right text-text-tertiary">—</span>
  const acima = limite !== null && valor > limite
  return (
    <span
      className={`text-right font-[550] tabular-nums ${acima ? 'text-atencao' : 'text-text-primary'}`}
    >
      {`${Math.round(valor)}%`}
    </span>
  )
}

// Sem o Beszel, a oficina segue pelos arquivos: só o disco.
function DiscoDaOficina({ leitura, agora }: { leitura: LeituraDaMaquina; agora: Date }) {
  const amostra = leitura.amostra
  const livre = amostra?.discoLivreBytes
  if (!amostra || livre === undefined) return <QuadroDeMetrica rotulo="Disco" valor={null} />
  if (leituraVelha(new Date(amostra.em), agora)) {
    return (
      <QuadroDeMetrica
        rotulo="Disco"
        valor={null}
        nota={`Sem dados recentes · leitura de ${formatarDataHora(new Date(amostra.em))}`}
      />
    )
  }
  const uso = amostra.discoUsoPct
  return (
    <QuadroDeMetrica
      rotulo="Disco"
      valor={formatarBytes(livre)}
      complemento={
        amostra.discoTotalBytes === undefined
          ? 'livres'
          : `livres de ${formatarBytes(amostra.discoTotalBytes)}`
      }
      barra={
        uso === null
          ? undefined
          : { pct: uso, tom: uso > LIMITES_DA_OFICINA.discoUsoPct ? 'atencao' : 'informacao' }
      }
      nota={uso === null ? undefined : `${uso}% em uso`}
    />
  )
}

function Linhas({ beszel, agora }: { beszel: Maquinas['beszel']; agora: Date }) {
  if (beszel === 'falha' || beszel.situacao === 'sem_resposta') {
    return (
      <p className="px-3.5 py-3">
        <BadgeDeEstado tom="atencao">Beszel sem resposta</BadgeDeEstado>
      </p>
    )
  }
  if (beszel.situacao === 'recusado') {
    return (
      <p className="px-3.5 py-3">
        <BadgeDeEstado tom="atencao">Beszel recusou o acesso</BadgeDeEstado>
      </p>
    )
  }
  return (
    <>
      <div
        className={`${GRADE} px-3.5 pb-1.5 pt-2.5 text-[11px] text-text-tertiary`}
        aria-hidden="true"
      >
        <span />
        <span />
        <span className="text-right">CPU</span>
        <span className="text-right">Mem.</span>
        <span className="text-right">Disco</span>
      </div>
      <ul>
        {beszel.maquinas.map((m) => {
          const { tom, texto } = apresentarMaquina(m, agora)
          return (
            <li
              key={m.sistemaId}
              className={`${GRADE} border-t border-border px-3.5 py-2 text-[13px] first:border-t-0`}
            >
              <PontoDaMaquina tom={tom} />
              {m.recursoId ? (
                <Link
                  href={`/maquinas/${m.recursoId}`}
                  className="truncate text-text-primary hover:underline"
                >
                  {m.nome}
                </Link>
              ) : (
                <span className="truncate text-text-secondary">{m.nome}</span>
              )}
              {tom === 'sem_resposta' ? (
                <span className="col-span-3 text-right text-[12px] text-text-tertiary">
                  {texto!.replace('Sem resposta', 'sem resposta')}
                </span>
              ) : (
                <>
                  <Pct valor={m.cpuPct} limite={null} />
                  <Pct valor={m.memPct} limite={LIMITES_DA_OFICINA.memoriaUsoPct} />
                  <Pct valor={m.discoPct} limite={LIMITES_DA_OFICINA.discoUsoPct} />
                </>
              )}
            </li>
          )
        })}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t border-border px-3.5 py-2 text-[12.5px] text-text-tertiary">
        <span>{`Beszel · leitura de há ${idadeCurta(beszel.lidaEm ?? agora, agora)}`}</span>
        <Link href="/maquinas" className={CLASSE_DO_LINK}>
          Ver máquinas
        </Link>
      </div>
    </>
  )
}

// Início: uma linha por máquina lida pelo Beszel. Sem o Beszel configurado, cai para o disco da
// oficina pelos arquivos; sem nenhuma das duas fontes, não renderiza.
export function QuadroDasMaquinas({ maquinas, agora }: QuadroDasMaquinasProps) {
  if (maquinas === null) return null
  const { beszel, oficina } = maquinas
  const semBeszel = beszel !== 'falha' && beszel.situacao === 'nao_configurado'
  if (semBeszel && oficina === null) return null

  return (
    <section aria-labelledby="titulo-maquinas">
      <TituloDeSecao id="titulo-maquinas">Máquinas</TituloDeSecao>
      {semBeszel ? (
        <div className={`${CLASSE_DO_CARTAO} p-4`}>
          <DiscoDaOficina leitura={oficina!.leitura} agora={agora} />
          {oficina!.hrefDaMaquina && (
            <div className="mt-3">
              <Link href={oficina!.hrefDaMaquina} className={CLASSE_DO_LINK}>
                Ver a máquina
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className={CLASSE_DO_CARTAO}>
          <Linhas beszel={beszel} agora={agora} />
        </div>
      )}
    </section>
  )
}
