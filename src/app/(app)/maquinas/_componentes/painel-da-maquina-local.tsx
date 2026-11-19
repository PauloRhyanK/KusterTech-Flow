import type { ReactNode } from 'react'
import { CLASSE_DO_CARTAO } from '@/lib/ui/titulo-de-secao'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { QuadroDeMetrica } from '@/lib/ui/quadro-de-metrica'
import type { Amostra, Limpeza } from '@/modules/oficina/contrato'
import {
  LIMITES_DA_OFICINA,
  avisosDaMaquina,
  diaEHora,
  formatarBytes,
  idadeCurta,
  leituraVelha,
  type LeituraDaMaquina,
} from '@/modules/oficina/model'
import { ContainersDaMaquina } from './containers-da-maquina'
import { ParaOndeVaiODisco } from './disco-por-dono'
import { FaixaDeAtencao } from './faixa-de-atencao'
import { HistoricoDaMaquina } from './historico-da-maquina'
import { LimpezasDaMaquina } from './limpezas-da-maquina'
import { ServicosDaMaquina, type EstadoDaFabrica } from './servicos-da-maquina'

export interface PainelDaMaquinaLocalProps {
  leitura: LeituraDaMaquina
  ramMinimaMb: number | null
  agora: Date
  fabrica?: EstadoDaFabrica | null
  // Conteúdo da página que segue o painel: no fim da coluna principal e da lateral.
  principal?: ReactNode
  lateral?: ReactNode
}

const MB = 1024 * 1024

function decimal(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function mb(valor: number): string {
  return valor === 0 ? '0' : formatarBytes(valor * MB)
}

function Quadro({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={rotulo} className={`${CLASSE_DO_CARTAO} min-w-0 p-4`}>
      {children}
    </div>
  )
}

function Cpu({ amostra }: { amostra: Amostra | null }) {
  const uso = amostra?.cpuUsoPct ?? null
  const carga = amostra?.carga1 ?? null
  if (uso === null) {
    // Scripts antigos não medem o uso: fica só a carga.
    return (
      <QuadroDeMetrica
        rotulo="CPU"
        valor={carga === null ? null : decimal(carga)}
        complemento="de carga"
      />
    )
  }
  return (
    <QuadroDeMetrica
      rotulo="CPU"
      valor={`${Math.round(uso)}%`}
      barra={{ pct: uso, tom: 'informacao' }}
      nota={carga === null ? undefined : `Carga ${decimal(carga)}`}
    />
  )
}

function Memoria({ amostra, apertada }: { amostra: Amostra | null; apertada: boolean }) {
  if (!amostra) return <QuadroDeMetrica rotulo="Memória" valor={null} />
  const usada = Math.max(0, amostra.memTotalMb - amostra.memDisponivelMb)
  return (
    <QuadroDeMetrica
      rotulo="Memória"
      valor={formatarBytes(usada * MB)}
      complemento={`de ${formatarBytes(amostra.memTotalMb * MB)}`}
      barra={{
        pct: amostra.memTotalMb > 0 ? (usada / amostra.memTotalMb) * 100 : 0,
        tom: apertada ? 'atencao' : 'informacao',
      }}
      nota={`Disponível ${mb(amostra.memDisponivelMb)} · swap ${mb(amostra.swapUsadaMb)}`}
    />
  )
}

function Disco({ amostra }: { amostra: Amostra | null }) {
  const uso = amostra?.discoUsoPct ?? null
  const livre = amostra?.discoLivreBytes
  const barra =
    uso === null
      ? undefined
      : {
          pct: uso,
          tom:
            uso > LIMITES_DA_OFICINA.discoUsoPct ? ('atencao' as const) : ('informacao' as const),
        }
  if (livre === undefined) {
    return (
      <QuadroDeMetrica
        rotulo="Disco"
        valor={uso === null ? null : `${uso}%`}
        complemento="em uso"
        barra={barra}
      />
    )
  }
  return (
    <QuadroDeMetrica
      rotulo="Disco"
      valor={formatarBytes(livre)}
      complemento={
        amostra?.discoTotalBytes === undefined
          ? 'livres'
          : `livres de ${formatarBytes(amostra.discoTotalBytes)}`
      }
      barra={barra}
      nota={uso === null ? undefined : `${uso}% em uso`}
    />
  )
}

function UltimaLimpeza({ limpeza, agora }: { limpeza: Limpeza | undefined; agora: Date }) {
  if (!limpeza) return <QuadroDeMetrica rotulo="Última limpeza" valor={null} />
  const { dia, hora } = diaEHora(new Date(limpeza.em), agora)
  return (
    <QuadroDeMetrica
      rotulo="Última limpeza"
      valor={dia}
      complemento={hora}
      nota={limpeza.ok ? `Liberou ${formatarBytes(limpeza.liberadoBytes)} · concluída` : 'Falhou'}
      className="[&>p:last-child]:!mt-3.5"
    />
  )
}

function Situacao({ leitura, agora }: { leitura: LeituraDaMaquina; agora: Date }) {
  const { amostra, retrato } = leitura
  const em = amostra ? new Date(amostra.em) : null
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary">
      {retrato && <span>Ligada há {idadeCurta(new Date(retrato.ligadaDesde), agora)} ·</span>}
      {em === null ? (
        <BadgeDeEstado tom="neutro">Sem dados</BadgeDeEstado>
      ) : leituraVelha(em, agora) ? (
        <BadgeDeEstado tom="neutro">{`Sem dados recentes · leitura de há ${idadeCurta(em, agora)}`}</BadgeDeEstado>
      ) : (
        <BadgeDeEstado tom="neutro">{`Leitura de há ${idadeCurta(em, agora)}`}</BadgeDeEstado>
      )}
    </p>
  )
}

// Painel da máquina em que o próprio Flow roda. Recebe a leitura pronta: não lê arquivo nem banco.
export function PainelDaMaquinaLocal({
  leitura,
  ramMinimaMb,
  agora,
  fabrica = null,
  principal,
  lateral,
}: PainelDaMaquinaLocalProps) {
  const { amostra } = leitura
  const avisos = avisosDaMaquina(leitura, ramMinimaMb, agora)
  const apertada = amostra !== null && ramMinimaMb !== null && amostra.memDisponivelMb < ramMinimaMb

  return (
    <div className="space-y-6">
      <div className="space-y-5">
        <Situacao leitura={leitura} agora={agora} />
        <FaixaDeAtencao avisos={avisos} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Quadro rotulo="CPU">
            <Cpu amostra={amostra} />
          </Quadro>
          <Quadro rotulo="Memória">
            <Memoria amostra={amostra} apertada={apertada} />
          </Quadro>
          <Quadro rotulo="Disco">
            <Disco amostra={amostra} />
          </Quadro>
          <Quadro rotulo="Última limpeza">
            <UltimaLimpeza limpeza={leitura.limpezas[0]} agora={agora} />
          </Quadro>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <ServicosDaMaquina retrato={leitura.retrato} fabrica={fabrica} />
          <ContainersDaMaquina containers={leitura.retrato?.containers ?? null} agora={agora} />
          <HistoricoDaMaquina historico={leitura.historico} memoriaApertada={apertada} />
          <LimpezasDaMaquina limpezas={leitura.limpezas} agora={agora} />
          {principal}
        </div>
        <aside className="min-w-0 space-y-6">
          <ParaOndeVaiODisco
            disco={leitura.discoPorDono}
            totalBytes={amostra?.discoTotalBytes ?? null}
            livreBytes={amostra?.discoLivreBytes ?? null}
          />
          {lateral}
        </aside>
      </div>

      {leitura.linhasIgnoradas > 0 && (
        <p className="text-[12.5px] text-text-tertiary">
          {leitura.linhasIgnoradas === 1
            ? '1 linha ignorada'
            : `${leitura.linhasIgnoradas} linhas ignoradas`}
        </p>
      )}
    </div>
  )
}
