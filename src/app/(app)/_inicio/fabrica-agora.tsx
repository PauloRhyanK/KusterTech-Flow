import Link from 'next/link'
import { BadgeDeEstado, type TomDeEstado } from '@/lib/ui/badge-de-estado'
import { minutosDeAtraso } from '@/modules/fabrica/model'
import type { Inicio, PlanoNoInicio } from '@/modules/inicio/queries'
import { formatarBytes } from '@/modules/oficina/model'
import { FaixaDeRaias } from './faixa-de-raias'
import { CLASSE_DO_CARTAO, CLASSE_DO_LINK, TituloDeSecao } from '@/lib/ui/titulo-de-secao'

export interface FabricaAgoraProps {
  fabrica: Inicio['fabrica']
  // A leitura do retrato falhou: não dá para dizer que a Fábrica nunca enviou.
  falhou: boolean
  agora: Date
}

const ESTADO_DO_PLANO: Record<PlanoNoInicio['estado'], { texto: string; tom: TomDeEstado }> = {
  ativo: { texto: 'Ativo', tom: 'execucao' },
  admitindo: { texto: 'Admitindo', tom: 'informacao' },
  pausado: { texto: 'Pausado', tom: 'atencao' },
  aguardando: { texto: 'Aguardando', tom: 'neutro' },
  concluido: { texto: 'Concluído', tom: 'neutro' },
  removido: { texto: 'Removido', tom: 'neutro' },
}

function estadoDoPlano(plano: PlanoNoInicio) {
  if (plano.decisoes > 0 && plano.estado !== 'pausado') {
    return { texto: 'Aguarda decisão', tom: 'atencao' as const }
  }
  return ESTADO_DO_PLANO[plano.estado]
}

function detalheDoPlano(plano: PlanoNoInicio): string {
  const partes: string[] = []
  if (plano.indiceDaFase !== null) {
    partes.push(`Fase ${plano.indiceDaFase} de ${plano.totalDeFases}`)
  }
  const { raias } = plano
  if (raias.total === 0) {
    partes.push('Sem raias planejadas')
  } else {
    partes.push(`${raias.concluidas} de ${raias.total} raias concluídas`)
    if (raias.executando > 0) partes.push(`${raias.executando} executando`)
    if (raias.falharam > 0) {
      partes.push(raias.falharam === 1 ? '1 falhou' : `${raias.falharam} falharam`)
    }
  }
  return partes.join(' · ')
}

function idadeDoRetrato(recebidoEm: Date, agora: Date): string {
  const minutos = minutosDeAtraso(recebidoEm, agora)
  return minutos === 0 ? 'retrato de há menos de 1 min' : `retrato de há ${minutos} min`
}

export function FabricaAgora({ fabrica, falhou, agora }: FabricaAgoraProps) {
  return (
    <section aria-labelledby="titulo-fabrica-agora">
      <TituloDeSecao
        id="titulo-fabrica-agora"
        complemento={
          fabrica && (
            <span
              className={
                fabrica.desatualizado
                  ? 'text-[13px] font-medium text-atencao'
                  : 'text-[13px] text-text-tertiary'
              }
            >
              {idadeDoRetrato(fabrica.recebidoEm, agora)}
            </span>
          )
        }
      >
        Fábrica agora
      </TituloDeSecao>

      <div className={CLASSE_DO_CARTAO}>
        {fabrica === null ? (
          <div className="space-y-1 px-4 py-3 text-sm">
            {falhou ? (
              <p role="status" className="text-atencao">
                Não foi possível ler o retrato da Fábrica agora.
              </p>
            ) : (
              <>
                <p className="text-text-secondary">A Fábrica ainda não enviou dados.</p>
                <Link href="/configuracoes/fabrica" className={CLASSE_DO_LINK}>
                  Configurar o envio
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            {fabrica.planos.length === 0 ? (
              <p className="px-4 py-3 text-sm text-text-secondary">Nenhum plano em curso.</p>
            ) : (
              <ul aria-label="Planos em curso" className="divide-y divide-border">
                {fabrica.planos.map((plano) => {
                  const estado = estadoDoPlano(plano)
                  return (
                    <li
                      key={plano.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:flex-nowrap"
                    >
                      <div className="order-last min-w-0 basis-full sm:order-none sm:basis-auto sm:flex-1">
                        <p className="text-sm font-medium text-text-primary">
                          {plano.nomeDoProjeto ?? plano.repo} · {plano.feature}
                        </p>
                        <p className="text-[13px] text-text-secondary">{detalheDoPlano(plano)}</p>
                        {plano.raias.total > 0 && <FaixaDeRaias raias={plano.raias} />}
                      </div>
                      <BadgeDeEstado tom={estado.tom} className="shrink-0">
                        {estado.texto}
                      </BadgeDeEstado>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-3">
              <p className="min-w-0 flex-1 text-[13px] text-text-secondary">
                Vagas: {fabrica.vagas.ocupadas} de {fabrica.vagas.efetivas} ocupadas · memória
                disponível{' '}
                {fabrica.vagas.memDisponivelMb === null
                  ? 'sem medição'
                  : formatarBytes(fabrica.vagas.memDisponivelMb * 1024 * 1024)}
              </p>
              <Link href="/fabrica" className={CLASSE_DO_LINK}>
                Abrir a Fábrica
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
