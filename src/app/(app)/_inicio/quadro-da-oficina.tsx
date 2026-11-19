import Link from 'next/link'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { QuadroDeMetrica } from '@/lib/ui/quadro-de-metrica'
import type { Inicio } from '@/modules/inicio/queries'
import { LIMITES_DA_OFICINA, formatarBytes, leituraVelha } from '@/modules/oficina/model'
import { CLASSE_DO_CARTAO, CLASSE_DO_LINK, TituloDeSecao } from './titulo-de-secao'

export interface QuadroDaOficinaProps {
  oficina: Inicio['oficina']
  agora: Date
}

function Par({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border py-[7px] text-[13px]">
      <dt className="text-text-secondary">{rotulo}</dt>
      <dd className="text-text-primary">{children}</dd>
    </div>
  )
}

function Disco({ oficina, agora }: { oficina: NonNullable<Inicio['oficina']>; agora: Date }) {
  const amostra = oficina.leitura.amostra
  const livre = amostra?.discoLivreBytes
  if (!amostra || livre === undefined) {
    return <QuadroDeMetrica rotulo="Disco" valor={null} />
  }
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

// Renderiza nada sem leitura da máquina local (pasta da oficina não configurada).
export function QuadroDaOficina({ oficina, agora }: QuadroDaOficinaProps) {
  if (oficina === null) return null
  const limpeza = oficina.leitura.limpezas[0]

  return (
    <section aria-labelledby="titulo-oficina">
      <TituloDeSecao id="titulo-oficina">Oficina</TituloDeSecao>
      <div className={`${CLASSE_DO_CARTAO} p-4`}>
        <Disco oficina={oficina} agora={agora} />
        {limpeza ? (
          <dl className="mt-4">
            <Par rotulo="Última limpeza">{formatarDataHora(new Date(limpeza.em))}</Par>
            {limpeza.ok && <Par rotulo="Liberou">{formatarBytes(limpeza.liberadoBytes)}</Par>}
            <Par rotulo="Resultado">
              {limpeza.ok ? (
                <BadgeDeEstado tom="neutro">Concluída</BadgeDeEstado>
              ) : (
                <BadgeDeEstado tom="erro">Falhou</BadgeDeEstado>
              )}
            </Par>
          </dl>
        ) : (
          <p className="mt-4 border-t border-border pt-2 text-[13px] text-text-secondary">
            Nenhuma limpeza registrada.
          </p>
        )}
        {oficina.hrefDaMaquina && (
          <div className="mt-3">
            <Link href={oficina.hrefDaMaquina} className={CLASSE_DO_LINK}>
              Ver a máquina
            </Link>
          </div>
        )}
      </div>
    </section>
  )
}
